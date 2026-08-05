/* =========================================================================
   SupportAI - Widget chatbot embarquable
   https://supportai.fr

   Le client colle UNE seule ligne sur son site, avec ses paramètres :
     <script
       src="https://supportai.fr/widget.js"
       data-color="#16A34A"
       data-title="Assistant ACME"
       data-welcome="Bonjour..."
       data-faq-url="https://docs.google.com/spreadsheets/d/SHEET_ID/edit?usp=sharing"
       data-questions="Question 1|Question 2|Question 3"
       data-contact-email="contact@acme.fr"
       data-contact-phone="+33 1 23 45 67 89"
       data-contact-form="https://acme.fr/contact"
       defer></script>

   Tous les attributs data-* sont OPTIONNELS. Si absents, valeurs par défaut.

   Méthodes de contact (utilisées en cas de panne du chatbot) :
     - data-contact-email : ouvre un mailto:
     - data-contact-phone : ouvre un tel: (appel direct sur mobile)
     - data-contact-form  : ouvre une URL de formulaire externe
   Tu peux en activer 1, 2 ou les 3. Si plusieurs sont fournies, le message
   d'erreur affiche toutes les options ("Écris-nous à X ou appelle-nous au Y").
   ========================================================================= */
(function () {
  'use strict';

  // =========================================================================
  // ⚙️  LECTURE DES DATA-ATTRIBUTES DU SCRIPT
  // =========================================================================
  // Le widget récupère sa config directement depuis la balise <script>
  // qui l'a chargé. Pas besoin pour le client de modifier ce fichier.
  // -------------------------------------------------------------------------

  // Retrouve la balise <script> qui a chargé ce widget
  const SCRIPT_TAG = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const src = scripts[i].src || '';
      if (src.indexOf('widget.js') !== -1) return scripts[i];
    }
    return null;
  })();

  const D = SCRIPT_TAG ? SCRIPT_TAG.dataset : {};

  // Calcule une variante 15% plus foncée d'une couleur hex (pour le dégradé)
  function darkenHex(hex, amount) {
    if (!hex || hex.charAt(0) !== '#' || hex.length !== 7) return hex;
    amount = amount || 30;
    const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
    const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
    const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  // URL du service SupportAI : par défaut le domaine d'où le script est servi.
  // (Surchargeable avec data-service-url pour les déploiements custom.)
  const inferredServiceUrl = SCRIPT_TAG && SCRIPT_TAG.src
    ? SCRIPT_TAG.src.replace(/\/widget\.js.*$/, '')
    : 'https://askdata-bi.netlify.app';

  // Quick replies par défaut si le client n'en spécifie pas
  const DEFAULT_QUICK_REPLIES = [
    "C'est quoi AskData ?",
    'Combien ça coûte ?',
    'Mes données sont-elles en sécurité ?'
  ];

  // Parse la liste de questions depuis data-questions="A|B|C"
  // Convention : data-questions="" (chaîne vide) = aucune question affichée
  let parsedQuickReplies;
  if (typeof D.questions === 'string') {
    if (D.questions.trim() === '') {
      parsedQuickReplies = []; // mode silencieux explicite
    } else {
      parsedQuickReplies = D.questions
        .split('|')
        .map(q => q.trim())
        .filter(Boolean);
    }
  } else {
    parsedQuickReplies = DEFAULT_QUICK_REPLIES;
  }

  const brandColor = D.color || '#16A085';

  // -------------------------------------------------------------------------
  // 📞 PARSING DES MÉTHODES DE CONTACT
  // -------------------------------------------------------------------------
  // 3 attributs supportés, dans l'ordre de priorité :
  //   1. data-contact-email  → mailto:
  //   2. data-contact-phone  → tel:
  //   3. data-contact-form   → URL externe (formulaire web)
  //
  // Le client peut en activer 1, 2 ou les 3. Toutes les options valides sont
  // affichées en cas de panne du chatbot. Si AUCUNE n'est fournie, on retombe
  // sur l'email par défaut SupportAI (rétro-compatible avec l'ancien widget).
  // -------------------------------------------------------------------------

  function parseContacts(D) {
    const list = [];

    // Email
    const emailRaw = (D.contactEmail || '').trim();
    if (emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      list.push({ type: 'mail', value: emailRaw, display: emailRaw });
    }

    // Téléphone : on accepte +33..., 0033..., 01 23 45 67 89, etc.
    const phoneRaw = (D.contactPhone || '').trim();
    if (phoneRaw) {
      const cleaned = phoneRaw.replace(/[\s.\-()]/g, '');
      if (/^(\+\d{6,15}|00\d{6,15}|0\d{8,14})$/.test(cleaned)) {
        list.push({ type: 'tel', value: cleaned, display: phoneRaw });
      }
    }

    // Formulaire (URL externe)
    const formRaw = (D.contactForm || '').trim();
    if (formRaw && /^https?:\/\//i.test(formRaw)) {
      list.push({ type: 'url', value: formRaw, display: formRaw });
    }

    // Fallback : aucune option valide → on met l'email SupportAI par défaut
    if (list.length === 0) {
      list.push({
        type: 'mail',
        value: 'romtaug+askdata@gmail.com',
        display: 'romtaug+askdata@gmail.com',
      });
    }

    return list;
  }

  const CONFIG = {
    serviceUrl: D.serviceUrl || inferredServiceUrl,

    botName: D.title || 'Assistant',
    welcomeMessage: D.welcome || "Bonjour 👋 Une question sur AskData ? Je m'appuie sur notre documentation pour vous répondre.",

    // Liste ordonnée des méthodes de contact valides (1 à 3 entrées)
    contacts: parseContacts(D),

    brandColor: brandColor,
    brandColorDark: darkenHex(brandColor, 30),

    headerColorStart: D.headerStart || brandColor,
    headerColorEnd: D.headerEnd || darkenHex(brandColor, 30),

    // URL de la FAQ : passée au backend pour qu'il charge le bon fichier.
    // Si absente, le backend utilise la variable d'env FAQ_URL (mode single-tenant).
    // Une URL relative (commençant par /) est convertie en absolue avec l'origine de la page.
    faqUrl: (function(){
      const u = D.faqUrl;
      if (!u) return null;
      if (u.charAt(0) === '/' && typeof window !== 'undefined' && window.location) {
        return window.location.origin + u;
      }
      return u;
    })(),

    quickReplies: parsedQuickReplies,

    // Clé Gemini en brut (optionnel, mode "clé inline")
    // ⚠️ Si renseignée, la clé est visible côté navigateur - usage démo/test uniquement.
    apiKey: D.apiKey || null,

    // Ton du chatbot : "pro" (vouvoiement), "familier" (tutoiement), "chaleureux" (défaut).
    tone: (function(){
      const t = (D.tone || "").trim().toLowerCase();
      return (t === "pro" || t === "familier" || t === "chaleureux") ? t : "chaleureux";
    })()
  };
  // =========================================================================

  // Évite le double-chargement si le script est inclus deux fois
  if (document.getElementById('fc-chatbot')) return;

  const API_ENDPOINT = CONFIG.serviceUrl.replace(/\/+$/, '') + '/.netlify/functions/chat';

  // ------------------ STYLES ------------------
  const css = `
#fc-chatbot, #fc-chatbot * { box-sizing: border-box; font-family: 'Inter', system-ui, -apple-system, sans-serif; }

#fc-chatbot-toggle {
  position: fixed; bottom: 24px; right: 24px;
  width: 60px; height: 60px; border-radius: 50%;
  background: linear-gradient(135deg, ${CONFIG.brandColor} 0%, ${CONFIG.brandColorDark} 100%);
  border: none; cursor: pointer;
  box-shadow: 0 8px 24px ${hexToRgba(CONFIG.brandColor, 0.4)};
  z-index: 99999;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.2s;
}
#fc-chatbot-toggle:hover { transform: scale(1.08); }
#fc-chatbot-toggle svg { width: 26px; height: 26px; fill: white; transition: transform 0.2s; }
#fc-chatbot-toggle.open svg { transform: rotate(180deg); }
#fc-chatbot-toggle .fc-badge {
  position: absolute; top: -2px; right: -2px;
  background: #16A34A; color: white;
  font-size: 10px; font-weight: 700;
  padding: 2px 6px; border-radius: 100px;
  border: 2px solid white;
}

#fc-chatbot-panel {
  position: fixed; bottom: 96px; right: 24px;
  width: 380px; max-width: calc(100vw - 32px);
  height: 560px; max-height: calc(100vh - 140px);
  background: white; border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  z-index: 99998;
  display: none; flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
}
#fc-chatbot-panel.open {
  display: flex;
  animation: fcSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes fcSlideUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

.fc-header {
  background: linear-gradient(135deg, ${CONFIG.headerColorStart} 0%, ${CONFIG.headerColorEnd} 100%);
  padding: 14px 18px; color: white;
  display: flex; align-items: center; gap: 12px;
}
.fc-avatar {
  width: 38px; height: 38px; border-radius: 50%;
  background: white; display: flex;
  align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.fc-header-info { flex: 1; min-width: 0; }
.fc-header-name { font-size: 14px; font-weight: 700; margin: 0; line-height: 1.2; color: white; }
.fc-header-status { font-size: 11px; opacity: 0.75; margin: 3px 0 0; display: flex; align-items: center; gap: 6px; color: white; }
.fc-status-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #22C55E;
  box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.6);
  animation: fc-pulse 2s ease-out infinite;
}
@keyframes fc-pulse {
  0%   { box-shadow: 0 0 0 0   rgba(34, 197, 94, 0.6); }
  70%  { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0);   }
  100% { box-shadow: 0 0 0 0   rgba(34, 197, 94, 0);   }
}
.fc-close {
  background: none; border: none; color: white;
  cursor: pointer; padding: 6px; border-radius: 8px;
  opacity: 0.7; display: flex;
}
.fc-close:hover { opacity: 1; background: rgba(255, 255, 255, 0.1); }

.fc-messages {
  flex: 1; overflow-y: auto; padding: 18px;
  background: #F9FAFB; display: flex;
  flex-direction: column; gap: 10px;
}
.fc-msg {
  max-width: 85%; padding: 10px 14px;
  border-radius: 16px; font-size: 14px; line-height: 1.5;
  word-wrap: break-word;
}
.fc-msg-bot {
  background: white; color: #1F2937;
  border: 1px solid #E5E7EB;
  align-self: flex-start;
  border-bottom-left-radius: 4px;
}
.fc-msg-bot a {
  color: ${CONFIG.brandColorDark};
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px solid ${hexToRgba(CONFIG.brandColorDark, 0.3)};
  word-break: break-word;
  overflow-wrap: anywhere;
  transition: border-color 0.15s, color 0.15s;
}
.fc-msg-bot a:hover {
  border-bottom-color: ${CONFIG.brandColorDark};
  color: ${CONFIG.brandColor};
}
.fc-msg-user {
  background: linear-gradient(135deg, ${CONFIG.brandColor}, ${CONFIG.brandColorDark});
  color: white; align-self: flex-end;
  border-bottom-right-radius: 4px;
}
.fc-msg-error {
  background: #FEF2F2; color: #991B1B;
  border: 1px solid #FECACA;
  align-self: stretch; max-width: 100%;
  font-size: 13px;
}
.fc-msg-error a { color: #991B1B; font-weight: 700; text-decoration: underline; }

.fc-typing {
  display: flex; gap: 4px;
  padding: 12px 14px; background: white;
  border: 1px solid #E5E7EB;
  border-radius: 16px; border-bottom-left-radius: 4px;
  align-self: flex-start; width: fit-content;
}
.fc-typing span {
  width: 7px; height: 7px;
  background: #9CA3AF; border-radius: 50%;
  animation: fcBounce 1.8s ease-in-out infinite both;
}
.fc-typing span:nth-child(2) { animation-delay: 0.25s; }
.fc-typing span:nth-child(3) { animation-delay: 0.5s; }
@keyframes fcBounce {
  0%, 80%, 100% { transform: scale(0.85); opacity: 0.5; }
  40%           { transform: scale(1);    opacity: 1;   }
}

.fc-quick {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 0 18px 8px; background: #F9FAFB;
}
.fc-quick button {
  background: white; border: 1px solid #E5E7EB;
  color: #4B5563; padding: 6px 12px;
  border-radius: 100px; font-size: 12px;
  cursor: pointer; transition: all 0.2s;
  font-family: inherit;
}
.fc-quick button:hover {
  background: ${hexToRgba(CONFIG.brandColor, 0.08)};
  border-color: ${CONFIG.brandColor};
  color: ${CONFIG.brandColorDark};
}

.fc-input-area {
  padding: 12px 14px;
  background: white; border-top: 1px solid #E5E7EB;
  display: flex; gap: 8px; align-items: flex-end;
}
.fc-input {
  flex: 1; border: 1px solid #D1D5DB;
  border-radius: 12px; padding: 9px 12px;
  font-size: 14px; resize: none;
  max-height: 100px; min-height: 40px;
  outline: none; font-family: inherit;
  line-height: 1.4; color: #1F2937;
  background: white;
}
.fc-input:focus {
  border-color: ${CONFIG.brandColor};
  box-shadow: 0 0 0 3px ${hexToRgba(CONFIG.brandColor, 0.12)};
}
.fc-send {
  background: linear-gradient(135deg, ${CONFIG.brandColor}, ${CONFIG.brandColorDark});
  border: none; width: 40px; height: 40px;
  border-radius: 50%; cursor: pointer;
  flex-shrink: 0; display: flex;
  align-items: center; justify-content: center;
  transition: transform 0.2s;
}
.fc-send:hover:not(:disabled) { transform: scale(1.05); }
.fc-send:disabled { opacity: 0.4; cursor: not-allowed; }
.fc-send svg { width: 18px; height: 18px; fill: white; }

.fc-footer {
  font-size: 10px; color: #9CA3AF;
  text-align: center; padding: 6px 0 8px;
  background: white;
}
.fc-footer a { color: #6B7280; text-decoration: none; }
.fc-footer a:hover { text-decoration: underline; }

@media (max-width: 480px) {
  #fc-chatbot-panel {
    right: 8px; left: 8px; width: auto;
    max-width: none; bottom: 86px;
  }
  #fc-chatbot-toggle { right: 16px; bottom: 16px; }
}
`;

  // Charge la police Outfit si pas déjà dispo
  if (!document.querySelector('link[href*="Inter"]')) {
    const fontLink = document.createElement('link');
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ------------------ HTML ------------------
  const container = document.createElement('div');
  container.id = 'fc-chatbot';
  container.innerHTML = `
    <button id="fc-chatbot-toggle" aria-label="Ouvrir le chat">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
      <span class="fc-badge" id="fc-badge">1</span>
    </button>
    <div id="fc-chatbot-panel" role="dialog" aria-label="Chat">
      <div class="fc-header">
        <div class="fc-avatar">🤖</div>
        <div class="fc-header-info">
          <p class="fc-header-name">${escapeHtml(CONFIG.botName)}</p>
          <p class="fc-header-status"><span class="fc-status-dot"></span>En ligne · réponse instantanée · 24h/24 7j/7</p>
        </div>
        <button class="fc-close" aria-label="Fermer le chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
        </button>
      </div>
      <div class="fc-messages" id="fc-messages"></div>
      <div class="fc-quick" id="fc-quick"></div>
      <div class="fc-input-area">
        <textarea class="fc-input" id="fc-input" placeholder="Pose ta question..." rows="1" aria-label="Tapez votre message"></textarea>
        <button class="fc-send" id="fc-send" aria-label="Envoyer le message">
          <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </div>
      <div class="fc-footer">Assistant IA · <a href="${escapeAttr(buildContactHref(CONFIG.contacts[0]))}"${CONFIG.contacts[0].type === 'url' ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(footerLabel(CONFIG.contacts[0]))}</a></div>
    </div>
  `;
  document.body.appendChild(container);

  // ------------------ STATE ------------------
  const messages = [];
  let isOpen = false;
  let isLoading = false;
  let hasFailed = false;
  let hasShownWelcome = false;

  const toggle    = document.getElementById('fc-chatbot-toggle');
  const panel     = document.getElementById('fc-chatbot-panel');
  const closeBtn  = container.querySelector('.fc-close');
  const messagesEl = document.getElementById('fc-messages');
  const quickEl   = document.getElementById('fc-quick');
  const input     = document.getElementById('fc-input');
  const sendBtn   = document.getElementById('fc-send');
  const badge     = document.getElementById('fc-badge');

  // ------------------ HELPERS ------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]
    ));
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // ------------------ HELPERS DE CONTACT ------------------
  // Construit l'attribut href approprié selon le type de contact
  function buildContactHref(contact) {
    if (!contact) return '#';
    if (contact.type === 'tel') return 'tel:' + contact.value;
    if (contact.type === 'url') return contact.value;
    // mail (par défaut)
    const subject = encodeURIComponent('Question depuis le chat');
    return 'mailto:' + contact.value + '?subject=' + subject;
  }

  // Texte du lien dans le footer du panel (toujours court, 1 ligne)
  function footerLabel(contact) {
    if (!contact) return 'Nous contacter';
    if (contact.type === 'tel') return 'Nous appeler';
    if (contact.type === 'url') return 'Nous contacter';
    return 'Nous écrire directement';
  }

  // Verbe + valeur affichée dans le message d'erreur de fallback
  // (ex: "Écris-nous à <a>contact@acme.fr</a>")
  function errorPhrase(contact) {
    const href = escapeAttr(buildContactHref(contact));
    const display = escapeHtml(contact.display);
    const target = contact.type === 'url' ? ' target="_blank" rel="noopener noreferrer"' : '';
    const link = `<a href="${href}"${target}>${display}</a>`;
    if (contact.type === 'tel') return `appelle-nous au ${link}`;
    if (contact.type === 'url') return `contacte-nous via ${link}`;
    return `écris-nous à ${link}`;
  }

  // Combine plusieurs options de contact en une seule phrase humaine
  // 1 option  → "Écris-nous à X"
  // 2 options → "Écris-nous à X ou appelle-nous au Y"
  // 3 options → "Écris-nous à X, appelle-nous au Y ou contacte-nous via Z"
  function buildErrorMessage(contacts) {
    if (!contacts || contacts.length === 0) return '';
    const phrases = contacts.map(errorPhrase);
    // Capitalise la première lettre de la première phrase
    phrases[0] = phrases[0].charAt(0).toUpperCase() + phrases[0].slice(1);
    if (phrases.length === 1) return phrases[0];
    if (phrases.length === 2) return phrases[0] + ' ou ' + phrases[1];
    return phrases.slice(0, -1).join(', ') + ' ou ' + phrases[phrases.length - 1];
  }

  function hexToRgba(hex, alpha) {
    const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return `rgba(0,0,0,${alpha})`;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
  }

  // Convertit le markdown minimal du bot (liens + sauts de ligne) en HTML safe
  function renderBotText(text) {
    // 1. Échappe d'abord tout
    let safe = escapeHtml(text);

    // 2. Convertit les liens markdown [label](url) - uniquement http/https
    //    Marqueur temporaire pour ne pas se faire repasser dessus à l'étape 3.
    safe = safe.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, url) => `\x00MD\x01${url}\x01${label}\x02`
    );

    // 3. Auto-linkify les URLs brutes (http:// ou https://) qui ne sont pas
    //    déjà dans un marqueur markdown. La regex évite de remanger les URLs
    //    déjà transformées (qui ont des \x00...\x02 autour).
    safe = safe.replace(
      /(^|[\s(])(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/g,
      (_, prefix, url) => `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    );

    // 4. Restaure les liens markdown en vrais <a>
    safe = safe.replace(
      /\x00MD\x01(https?:\/\/[^\x01]+)\x01([^\x02]+)\x02/g,
      (_, url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );

    // 5. Sauts de ligne
    safe = safe.replace(/\n/g, '<br>');
    return safe;
  }

  function addMessage(role, text, isError) {
    const msg = document.createElement('div');
    msg.className = 'fc-msg fc-msg-' + (isError ? 'error' : role);
    if (role === 'bot' && !isError) {
      msg.innerHTML = renderBotText(text);
    } else if (isError) {
      msg.innerHTML = text; // déjà HTML safe (construit par showFallbackError)
    } else {
      msg.textContent = text;
    }
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    if (document.getElementById('fc-typing')) return;
    const t = document.createElement('div');
    t.className = 'fc-typing';
    t.id = 'fc-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(t);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const t = document.getElementById('fc-typing');
    if (t) t.remove();
  }

  function renderQuickReplies(replies) {
    quickEl.innerHTML = '';
    if (!replies || hasFailed) return;
    replies.forEach(r => {
      const btn = document.createElement('button');
      btn.textContent = r;
      btn.onclick = () => { input.value = r; sendMessage(); };
      quickEl.appendChild(btn);
    });
  }

  function showFallbackError() {
    hasFailed = true;
    quickEl.innerHTML = '';
    const message = buildErrorMessage(CONFIG.contacts);
    addMessage(
      'error',
      `😕 Le chat est temporairement indisponible.<br><br>` +
      `${message} - réponse sous 24h ouvrées.`,
      true
    );
    sendBtn.disabled = true;
    input.disabled = true;
    // Placeholder adapté à la principale méthode dispo
    const primary = CONFIG.contacts[0];
    if (primary.type === 'tel')      input.placeholder = "Chat indisponible - utilise le téléphone";
    else if (primary.type === 'url') input.placeholder = "Chat indisponible - utilise le formulaire";
    else                              input.placeholder = "Chat indisponible - utilise l'email";
  }

  function openPanel() {
    isOpen = true;
    panel.classList.add('open');
    toggle.classList.add('open');
    if (badge) badge.style.display = 'none';

    if (!hasShownWelcome) {
      addMessage('bot', CONFIG.welcomeMessage);
      renderQuickReplies(CONFIG.quickReplies);
      hasShownWelcome = true;
    }

    setTimeout(() => input.focus(), 100);
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('open');
    toggle.classList.remove('open');
  }

  toggle.addEventListener('click', () => isOpen ? closePanel() : openPanel());
  closeBtn.addEventListener('click', closePanel);

  // ------------------ ENVOI MESSAGE ------------------
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isLoading || hasFailed) return;

    quickEl.innerHTML = '';
    addMessage('user', text);
    messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    isLoading = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
          messages,
          faqUrl: CONFIG.faqUrl,
          contacts: CONFIG.contacts,
          tone: CONFIG.tone,
          ...(CONFIG.apiKey ? { apiKey: CONFIG.apiKey } : {})
        })
      });

      hideTyping();

      // Codes "plus de crédit / API down / config absente" => fallback email
      if ([401, 402, 429, 500, 502, 503, 504].includes(res.status)) {
        showFallbackError();
        return;
      }

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();
      if (!data.reply) {
        showFallbackError();
        return;
      }

      addMessage('bot', data.reply);
      messages.push({ role: 'assistant', content: data.reply });
    } catch (err) {
      hideTyping();
      console.error('[FAQ chatbot]', err);
      showFallbackError();
    } finally {
      isLoading = false;
      sendBtn.disabled = hasFailed;
      if (!hasFailed) input.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });
})();
