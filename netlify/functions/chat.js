/* =========================================================================
   FAQ Chatbot — Netlify Function (Gemini cascade + retries + retrieval)

   POST /.netlify/functions/chat
   Body : { messages: [{ role: "user"|"assistant", content: string }, ...],
            faqUrl?: string,
            apiKey?: string }

   Pipeline :
     1. CORS dynamique (whitelist via ALLOWED_ORIGINS)
     2. Charge la FAQ depuis faqUrl (body) ou FAQ_URL (env), cache 5 min, SSRF guard
     3. BM25 retrieval : top-K articles pertinents (cache par URL FAQ → multi-tenant safe)
     4. Construit un system prompt strict (pas d'hallucination)
     5. Cascade Gemini (Flash-Lite → Flash → Pro) avec retries
     6. Retour : { reply, model, sources }

   En cas d'échec (clé absente, quota, panne, FAQ inaccessible…) :
     → renvoie 401 / 429 / 503 → le widget bascule en fallback email.

   Clé Gemini : env var GEMINI_API_KEY par défaut. Le widget peut aussi
   transmettre la clé en brut via body.apiKey (mode démo, à éviter en prod).
   ========================================================================= */

const { loadFaq } = require("./_faq-loader");
const { retrieve } = require("./_retrieval");

// ── Config Gemini ───────────────────────────────────────────────────────────
// Cascade : on essaie d'abord le moins cher (flash-lite), puis on remonte
// vers les plus capables si échec/quota. Le premier qui répond gagne.
// Liste à jour avril 2026 — gemini-2.0-* a été retiré le 3 mars / 1er juin 2026.
const MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

const TEMPERATURE = 0.2;
const MAX_OUTPUT_TOKENS = 800;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_RETRIES_PER_MODEL = 1;
const RETRY_BASE_DELAY_MS = 600;

// ── Config retrieval ────────────────────────────────────────────────────────
const TOP_K = 5;

// ── Config message handling ─────────────────────────────────────────────────
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;

// ── CORS ────────────────────────────────────────────────────────────────────
function getAllowedOrigins() {
  const raw = (process.env.ALLOWED_ORIGINS || "*").trim();
  if (raw === "*" || raw === "") return null; // null = autoriser tout (utile en dev)
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin) {
  const allowed = getAllowedOrigins();
  let allow;
  if (allowed === null) {
    allow = origin || "*";
  } else if (allowed.includes(origin)) {
    allow = origin;
  } else {
    allow = allowed[0] || "*";
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function reply(statusCode, body, origin) {
  return {
    statusCode,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ── System prompt builder ───────────────────────────────────────────────────

// Construit la liste de contacts du client en texte humain pour le prompt.
// Limite la taille (anti-injection) et n'expose que les types valides.
function formatContactsForPrompt(contacts) {
  if (!Array.isArray(contacts) || contacts.length === 0) return null;

  const lines = [];
  for (const c of contacts.slice(0, 5)) {
    if (!c || typeof c !== "object") continue;
    const value = String(c.value || c.display || "").trim().slice(0, 200);
    if (!value) continue;
    if (c.type === "mail")      lines.push(`- email : ${value}`);
    else if (c.type === "tel")  lines.push(`- téléphone : ${String(c.display || value).slice(0, 30)}`);
    else if (c.type === "url")  lines.push(`- formulaire en ligne : ${value}`);
  }
  return lines.length ? lines.join("\n") : null;
}

function buildSystemPrompt(contextArticles, clientContacts, tone) {
  const siteName = process.env.BOT_SITE_NAME || "ProspectData";
  const assistantName = process.env.BOT_ASSISTANT_NAME || "l'assistant ProspectData";
  const fallbackEmail = process.env.CONTACT_EMAIL || "romtaug+prospectdata@gmail.com";

  // Directive de ton selon le réglage choisi par le client (défaut : chaleureux).
  const TONE_DIRECTIVES = {
    pro: `Réponds en français, de manière concise (2 à 5 phrases), claire et professionnelle. ` +
         `Vouvoiement (vous), registre courtois et soigné, sans familiarité.`,
    familier: `Réponds en français, de manière concise (2 à 5 phrases), claire et décontractée. ` +
         `Tutoiement (tu), ton direct et accessible, comme un collègue sympa.`,
    chaleureux: `Réponds en français, de manière concise (2 à 5 phrases), claire et chaleureuse. ` +
         `Tutoiement amical mais professionnel.`,
  };
  const toneDirective = TONE_DIRECTIVES[tone] || TONE_DIRECTIVES.chaleureux;

  // Priorité aux contacts envoyés par le widget (multi-tenant).
  // Sinon fallback sur l'email global défini en env var.
  const contactsBlock = formatContactsForPrompt(clientContacts)
    || (fallbackEmail ? `- email : ${fallbackEmail}` : "- (aucune coordonnée disponible)");

  const ctx = contextArticles
    .map(
      (a, i) =>
        `### Article ${i + 1} — ${a.title}\n` +
        (a.category ? `Catégorie : ${a.category}\n` : "") +
        (a.url ? `Source : ${a.url}\n\n` : "\n") +
        a.content
    )
    .join("\n\n---\n\n");

  return (
    `Tu es ${assistantName}, l'assistant officiel de ${siteName}.\n\n` +
    `RÈGLES STRICTES :\n` +
    `1. Tu réponds UNIQUEMENT à partir des extraits de la FAQ ci-dessous.\n` +
    `2. Si la réponse n'est pas dans la FAQ, dis-le clairement et oriente vers l'équipe ` +
      `en utilisant les COORDONNÉES DE CONTACT plus bas (jamais une adresse inventée).\n` +
    `3. ESCALADE HUMAINE — Si le visiteur :\n` +
    `   - exprime de la frustration ou de l'énervement (ex: "ça me saoule", "j'en ai marre", "vraiment nul")\n` +
    `   - demande explicitement à parler à un humain ("je veux un humain", "passez-moi quelqu'un")\n` +
    `   - signale une urgence ("c'est urgent", "tout de suite", "j'ai besoin maintenant")\n` +
    `   - répète sa question parce que tu n'as pas su répondre\n` +
    `   → tu reconnais sa demande avec empathie (1 phrase courte, sincère, sans excès) et tu le ` +
      `redirige IMMÉDIATEMENT vers les coordonnées ci-dessous, en présentant TOUTES les options ` +
      `disponibles sous forme de petite liste à puces. Tu n'essaies pas de résoudre par la FAQ.\n` +
    `4. Tu n'inventes JAMAIS d'informations. En cas de doute, oriente vers l'équipe.\n` +
    `5. Tu ne mentionnes jamais "Gemini", "Google", "IA", "LLM", "modèle". ` +
      `Tu es simplement l'assistant de ${siteName}.\n` +
    `6. ${toneDirective}\n` +
    `7. Si pertinent, tu peux utiliser une liste à puces simples (-) pour clarifier.\n` +
    `8. Tu n'ajoutes JAMAIS de lien ni d'URL dans ta réponse (pas de "En savoir plus", pas d'adresse de page web). Le visiteur reste dans la conversation. Tu ne cites pas non plus les URLs présentes dans les articles de la FAQ.\n` +
    `9. Ne recopie pas les extraits mot à mot : reformule avec tes mots.\n` +
    `10. N'utilise pas de markdown lourd (titres, gras, italique). Texte fluide.\n\n` +
    `## COORDONNÉES DE CONTACT (à utiliser pour orienter le visiteur)\n\n${contactsBlock}\n\n` +
    `## Extraits pertinents de la FAQ\n\n${ctx}`
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

function extractCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

function extractApiError(data) {
  return data?.error?.message || data?.error?.status || data?.error?.code || "";
}

function shouldRetry(status) {
  return [0, 408, 429, 500, 502, 503, 504].includes(status);
}

function backoffDelay(attempt) {
  return RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Appel Gemini ────────────────────────────────────────────────────────────

async function callGemini({ apiKey, model, contents, systemPrompt }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            temperature: TEMPERATURE,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
          ],
        }),
      }
    );

    const rawText = await res.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      return { ok: false, status: res.status, error: extractApiError(data) || rawText || "api_error" };
    }

    const text = extractCandidateText(data);
    if (!text) return { ok: false, status: 503, error: "empty_response" };

    return { ok: true, status: 200, text };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, status: 408, error: "timeout" };
    }
    return { ok: false, status: 0, error: err.message || "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithCascade({ apiKey, contents, systemPrompt }) {
  const errors = [];

  for (const model of MODELS) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      const result = await callGemini({ apiKey, model, contents, systemPrompt });

      if (result.ok && result.text) {
        console.log(`[chat] success model=${model} attempt=${attempt + 1}`);
        return { text: result.text, model };
      }

      errors.push({ model, attempt: attempt + 1, status: result.status, error: result.error });
      console.warn(
        `[chat] failed model=${model} attempt=${attempt + 1} status=${result.status} error=${result.error}`
      );

      if (!shouldRetry(result.status)) break;
      if (attempt < MAX_RETRIES_PER_MODEL) await sleep(backoffDelay(attempt));
    }
  }

  return { error: true, errors };
}

// ── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin || "";

  // Préflight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return reply(405, { error: "method_not_allowed" }, origin);
  }

  // Parse body une seule fois (clé inline + faqUrl + messages tous au même endroit)
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { error: "invalid_json" }, origin);
  }

  // Clé Gemini : priorité au body (mode "clé inline" pour démo), sinon env var
  let inlineApiKey = null;
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    inlineApiKey = body.apiKey.trim().slice(0, 200);
  }
  // La clé inline (data-api-key) arrive VOLONTAIREMENT INCOMPLÈTE depuis le
  // snippet : l'app de configuration retire le préfixe (ex "A") pour que la
  // clé ne soit pas reconnaissable par les scanners de Google dans le code
  // public du client. On recolle ici le préfixe (env var GEMINI_KEY_PREFIX),
  // côté serveur, juste avant d'appeler Gemini. Si la clé reçue commence
  // déjà par "AIza" (cas d'une clé complète collée en direct), on ne touche
  // à rien.
  const KEY_PREFIX = process.env.GEMINI_KEY_PREFIX || "";
  let resolvedInlineKey = inlineApiKey;
  if (resolvedInlineKey && KEY_PREFIX && !resolvedInlineKey.startsWith("AIza")) {
    resolvedInlineKey = KEY_PREFIX + resolvedInlineKey;
  }

  // ── Clé API ───────────────────────────────────────────────────────────────
  // Chatbot mono-client (le bot d'AskData, sur le compte d'AskData) : la clé
  // Gemini vit dans l'env var GEMINI_API_KEY, côté serveur, jamais exposée au
  // navigateur. La clé inline (body.apiKey) reste possible pour un test rapide,
  // mais en production c'est l'env var qui est utilisée.
  const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
  const apiKey = resolvedInlineKey || envKey;
  if (!apiKey) {
    console.error("[chat] Clé Gemini manquante : configurez GEMINI_API_KEY dans les variables d'environnement Netlify.");
    return reply(503, { error: "config_missing" }, origin);
  }

  // Messages + faqUrl + contacts (pour le prompt d'escalade)
  let userMessages = body.messages;
  let clientFaqUrl = null;
  let clientContacts = null;
  if (typeof body.faqUrl === "string" && body.faqUrl.trim()) {
    clientFaqUrl = body.faqUrl.trim();
  }
  if (Array.isArray(body.contacts)) {
    clientContacts = body.contacts;
  }
  const validTones = ["pro", "familier", "chaleureux"];
  const clientTone = validTones.includes(String(body.tone || "").trim().toLowerCase())
    ? String(body.tone).trim().toLowerCase()
    : "chaleureux";
  if (!Array.isArray(userMessages) || userMessages.length === 0) {
    return reply(400, { error: "messages_required" }, origin);
  }
  if (userMessages.length > MAX_HISTORY_MESSAGES) {
    userMessages = userMessages.slice(-MAX_HISTORY_MESSAGES);
  }
  userMessages = userMessages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, MAX_MESSAGE_CHARS),
  }));

  // Dernier message utilisateur (pour le retrieval)
  const lastUser = [...userMessages].reverse().find((m) => m.role === "user");
  if (!lastUser || !lastUser.content.trim()) {
    return reply(400, { error: "empty_message" }, origin);
  }

  // Charge la FAQ (depuis l'URL fournie par le widget, ou env var en fallback)
  let faq;
  try {
    faq = await loadFaq(clientFaqUrl);
  } catch (err) {
    console.error("[chat] FAQ non chargeable :", err.message);
    return reply(503, { error: "faq_unavailable", details: err.message }, origin);
  }

  // BM25 retrieval — on passe l'URL FAQ comme cacheKey pour que chaque tenant
  // ait son propre index. Sans ça, deux clients avec des FAQ de même longueur
  // partageraient l'index → résultats corrompus pour le 2e.
  const cacheKey = clientFaqUrl || process.env.FAQ_URL || "default";
  const topArticles = retrieve(lastUser.content, faq, TOP_K, cacheKey);

  // System prompt + contents
  const systemPrompt = buildSystemPrompt(topArticles, clientContacts, clientTone);
  const contents = toGeminiContents(userMessages);

  // Cascade Gemini
  const result = await generateWithCascade({ apiKey, contents, systemPrompt });

  if (result.error) {
    console.error("[chat] tous les modèles ont échoué", JSON.stringify(result.errors));
    const isAuthOrQuota = result.errors.some((e) => [400, 401, 403, 429].includes(e.status));
    return reply(
      isAuthOrQuota ? 429 : 503,
      {
        error: isAuthOrQuota ? "quota_or_auth" : "unavailable",
        details: result.errors.slice(-5),
      },
      origin
    );
  }

  // Sources : on ne renvoie qu'un échantillon (pour debug / audit). Le widget
  // ne les affiche pas (les liens sont déjà dans le texte du modèle).
  const sources = topArticles
    .filter((a) => a.url)
    .slice(0, 3)
    .map((a) => ({ title: a.title, url: a.url }));

  return reply(
    200,
    {
      reply: result.text.trim(),
      model: result.model,
      sources,
    },
    origin
  );
};
