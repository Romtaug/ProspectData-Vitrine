/**
 * FAQ Loader — charge la FAQ depuis :
 *   1. Un Google Sheet partagé publiquement (PRINCIPAL, pour les clients)
 *      Format : https://docs.google.com/spreadsheets/d/SHEET_ID/edit?usp=sharing
 *      Colonnes attendues : thème, question, réponse
 *
 *   2. Un fichier JSON auto-hébergé (SECONDAIRE, pour la démo embarquée)
 *      Format : https://votre-deploy.netlify.app/data/faq.json
 *      Structure : { "faq": [{ "theme": "...", "question": "...", "answer": "...", "url": "..." }] }
 *      Domaines autorisés : *.netlify.app, supportai.fr (configurable via FAQ_SELF_HOST_DOMAINS)
 *
 * Sécurité : whitelist stricte des domaines pour éviter le SSRF.
 *
 * Output : array normalisé [{ id, title, content, category, url }]
 */

// ── Config ──────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

// Domaines autorisés pour les fichiers JSON auto-hébergés (pour la démo embarquée).
// Ajoutables via env var FAQ_SELF_HOST_DOMAINS="domain1.com,domain2.com"
const DEFAULT_SELF_HOST_DOMAINS = [
  "netlify.app",
  "supportai.fr",
  "vercel.app",
];

function getSelfHostDomains() {
  const extra = (process.env.FAQ_SELF_HOST_DOMAINS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_SELF_HOST_DOMAINS, ...extra]);
}

// ── Cache ───────────────────────────────────────────────────────────────────
const CACHE = new Map();
const CACHE_MAX_ENTRIES = 50;

// ── Détection format ───────────────────────────────────────────────────────

function detectSource(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`URL invalide : ${rawUrl}`);
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  // 1. Google Sheets
  if (host === "docs.google.com") return { type: "google-sheets", parsed };

  // 2. JSON auto-hébergé sur un domaine de confiance
  if (path.endsWith(".json")) {
    const allowed = getSelfHostDomains();
    const isAllowed = [...allowed].some((h) => host === h || host.endsWith("." + h));
    if (isAllowed) return { type: "self-host-json", parsed };
    throw new Error(
      `Domaine non autorisé pour JSON : ${host}. ` +
      `Domaines autorisés : ${[...allowed].join(", ")}. ` +
      `Pour ajouter un domaine, utilise l'env var FAQ_SELF_HOST_DOMAINS.`
    );
  }

  throw new Error(
    `URL non acceptée : ${rawUrl}. ` +
    `Format attendu : Google Sheet (https://docs.google.com/spreadsheets/...) ` +
    `ou JSON auto-hébergé (https://*.netlify.app/.../faq.json).`
  );
}

// ── Google Sheets ───────────────────────────────────────────────────────────

function extractSheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}
function extractGid(url) {
  const m = String(url).match(/[#&?]gid=(\d+)/);
  return m ? m[1] : "0";
}
function buildSheetExportUrl(rawUrl) {
  const sheetId = extractSheetId(rawUrl);
  if (!sheetId) {
    throw new Error("Impossible d'extraire l'ID du Google Sheet.");
  }
  const gid = extractGid(rawUrl);
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

async function fetchSheetCsv(rawUrl) {
  const exportUrl = buildSheetExportUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(exportUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/csv, */*" },
    });
    if (!res.ok) {
      throw new Error(
        `Téléchargement Google Sheets échoué (HTTP ${res.status}). ` +
        `Vérifie le partage : "Tout le monde avec le lien" → "Lecteur".`
      );
    }
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      throw new Error(
        "Le sheet n'est pas accessible publiquement. " +
        "Active le partage : Partager → Tout le monde avec le lien → Lecteur."
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_SIZE_BYTES) {
      throw new Error(`Sheet trop volumineux : ${buffer.length} octets`);
    }
    return buffer.toString("utf-8").replace(/^\uFEFF/, "");
  } finally {
    clearTimeout(timeout);
  }
}

// ── JSON auto-hébergé ───────────────────────────────────────────────────────

async function fetchSelfHostJson(rawUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(rawUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/json, */*" },
    });
    if (!res.ok) {
      throw new Error(`Téléchargement JSON échoué (HTTP ${res.status}) sur ${rawUrl}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_SIZE_BYTES) {
      throw new Error(`Fichier trop volumineux : ${buffer.length} octets`);
    }
    return buffer.toString("utf-8").replace(/^\uFEFF/, "");
  } finally {
    clearTimeout(timeout);
  }
}

// ── Parsing CSV (pour Google Sheets) ───────────────────────────────────────

function splitCsvLines(text) {
  const lines = []; let buf = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQ = !inQ;
    if (c === "\n" && !inQ) { lines.push(buf); buf = ""; }
    else buf += c;
  }
  if (buf) lines.push(buf);
  return lines;
}
function parseCsvLine(line) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

const THEME_KEYS = new Set(["theme","themes","categorie","category","rubrique","section"]);
const QUESTION_KEYS = new Set(["question","questions","title","titre","sujet"]);
const ANSWER_KEYS = new Set(["reponse","reponses","answer","answers","content","contenu","texte"]);
const URL_KEYS = new Set(["url","urls","lien","link","links","source","page","article"]);

function findColumnIndex(headers, keys) {
  return headers.findIndex((h) => keys.has(h));
}

function parseSheetCsv(text) {
  const rawLines = splitCsvLines(text).map((l) => l.replace(/\r$/, ""));
  if (rawLines.length < 2) {
    throw new Error("Sheet vide. Ajoute au moins une ligne de données après les en-têtes.");
  }
  const headers = parseCsvLine(rawLines[0]).map(normalizeHeader);
  const themeIdx = findColumnIndex(headers, THEME_KEYS);
  const questionIdx = findColumnIndex(headers, QUESTION_KEYS);
  const answerIdx = findColumnIndex(headers, ANSWER_KEYS);
  const urlIdx = findColumnIndex(headers, URL_KEYS);
  if (questionIdx === -1 || answerIdx === -1) {
    throw new Error(
      `Colonnes manquantes. Le sheet doit avoir au minimum 2 colonnes : "question", "réponse" ` +
      `(plus 2 colonnes optionnelles : "thème" et "url"). ` +
      `En-têtes détectés : ${headers.length ? headers.join(", ") : "(aucun)"}.`
    );
  }
  const articles = [];
  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const theme = themeIdx !== -1 ? String(cols[themeIdx] || "").trim() : "";
    const question = String(cols[questionIdx] || "").trim();
    const answer = String(cols[answerIdx] || "").trim();
    const url = urlIdx !== -1 ? String(cols[urlIdx] || "").trim() : "";
    if (!question || !answer || answer.length < 5) continue;
    // On valide l'URL : doit commencer par http/https ou être vide
    const validUrl = url && /^https?:\/\//i.test(url) ? url : null;
    articles.push({
      id: articles.length, title: question, content: answer,
      category: theme, url: validUrl,
    });
  }
  if (articles.length === 0) {
    throw new Error("Aucune ligne valide. Vérifie que les colonnes question et réponse sont remplies.");
  }
  return articles;
}

// ── Parsing JSON (pour démo embarquée) ─────────────────────────────────────

function normalizeJsonRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[String(k).trim().toLowerCase().replace(/\s+/g, "_")] = v;
  }
  return out;
}

function parseFaqJson(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch { throw new Error("JSON invalide : impossible de parser le contenu."); }

  let arr;
  if (Array.isArray(obj)) arr = obj;
  else if (Array.isArray(obj?.faq)) arr = obj.faq;
  else if (Array.isArray(obj?.items)) arr = obj.items;
  else throw new Error("JSON FAQ : structure inconnue (attendu : array ou {faq:[...]})");

  const articles = arr
    .map(normalizeJsonRow)
    .map((row) => ({
      title: String(row.question || row.title || "").trim(),
      content: String(row.answer || row.reponse || row.content || "").trim(),
      category: String(row.theme || row.category || row.categorie || "").trim(),
      url: row.url || row.lien || row.link || null,
    }))
    .filter((a) => a.title && a.content && a.content.length >= 5)
    .map((a, i) => ({
      id: i, title: a.title, content: a.content, category: a.category, url: a.url || null,
    }));

  if (articles.length === 0) {
    throw new Error("JSON chargé mais 0 entrée valide. Vérifie les champs question + answer (ou reponse).");
  }
  return articles;
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function loadFaq(overrideUrl) {
  const url = (overrideUrl && typeof overrideUrl === "string" && overrideUrl.trim())
    ? overrideUrl.trim()
    : process.env.FAQ_URL;

  if (!url) {
    throw new Error(
      "Aucune URL fournie. Soit passe data-faq-url dans le snippet, " +
      "soit configure FAQ_URL dans les variables d'environnement Netlify."
    );
  }

  const now = Date.now();
  const cached = CACHE.get(url);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.articles;

  const source = detectSource(url);
  console.log(`[faq-loader] téléchargement (${source.type}) : ${url.slice(0, 80)}...`);

  let articles;
  if (source.type === "google-sheets") {
    const csv = await fetchSheetCsv(url);
    articles = parseSheetCsv(csv);
  } else if (source.type === "self-host-json") {
    const json = await fetchSelfHostJson(url);
    articles = parseFaqJson(json);
  }

  console.log(`[faq-loader] ${articles.length} articles chargés`);

  if (CACHE.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = CACHE.keys().next().value;
    if (oldestKey) CACHE.delete(oldestKey);
  }
  CACHE.set(url, { articles, fetchedAt: now });
  return articles;
}

module.exports = { loadFaq };
