/* =============================================================================
   Assistant ProspectData - chatbot autonome, sans serveur et sans cle API
   -----------------------------------------------------------------------------
   Il repond en cherchant la meilleure entree de data/faq-prospectdata.json.
   Aucun appel reseau, aucune cle a proteger : il fonctionne sur GitHub Pages,
   sur Netlify, sur Streamlit, et meme en ouvrant le fichier en local.

   Amelioration optionnelle : si tu deploies un jour un vrai backend IA, pose
   window.PD_CHAT_API = "/api/chat" AVANT ce script. Le bot appellera l'API en
   priorite et retombera automatiquement sur la FAQ locale en cas d'echec.
   ========================================================================== */
(function () {
  "use strict";

  var CFG = {
    faqUrl: "data/faq-prospectdata.json",
    email: "romtaug+prospectdata@gmail.com",
    title: "Assistant ProspectData",
    welcome:
      "Bonjour. Posez votre question sur les CRM de prospection, je reponds a partir de la documentation du site.",
    suggestions: [
      "Je ne connais pas mes codes APE",
      "Comment il se met a jour tout seul ?",
      "Combien ca coute ?",
      "Y a-t-il une limite de volume ?"
    ],
    minScore: 1.6
  };

  var FAQ = [];
  var history = [];
  var open = false;
  var loaded = false;

  /* ---------- recherche locale ------------------------------------------- */

  var STOP = {};
  ("le la les un une des du de d a au aux et ou est sont ce cet cette ça ca " +
   "je tu il elle on nous vous ils que qui quoi quel quelle mon ma mes votre " +
   "vos pour par sur avec sans dans en y a-t-il il-y-a plus moins tres bien " +
   "comment combien pourquoi quand est-ce que qu ne pas si mais donc alors " +
   "the of to and").split(" ").forEach(function (w) { STOP[w] = 1; });

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(s) {
    return norm(s).split(" ").filter(function (w) {
      return w.length > 2 && !STOP[w];
    });
  }

  function score(queryTokens, entry) {
    var q = norm(entry.question), a = norm(entry.answer), t = norm(entry.theme);
    var s = 0;
    for (var i = 0; i < queryTokens.length; i++) {
      var w = queryTokens[i];
      if (t.indexOf(w) !== -1) s += 1.2;
      if (q.indexOf(w) !== -1) s += 2.2;
      else if (a.indexOf(w) !== -1) s += 0.9;
    }
    return queryTokens.length ? s / Math.sqrt(queryTokens.length) : 0;
  }

  function answerLocally(question) {
    var qt = tokens(question);
    if (!qt.length || !FAQ.length) return null;
    var best = null, bestScore = 0;
    for (var i = 0; i < FAQ.length; i++) {
      var sc = score(qt, FAQ[i]);
      if (sc > bestScore) { bestScore = sc; best = FAQ[i]; }
    }
    return bestScore >= CFG.minScore ? best.answer : null;
  }

  var FALLBACK =
    "Je n'ai pas la reponse dans ma documentation. Ecrivez directement a " +
    CFG.email + ", la reponse arrive sous 24 h.";

  /* ---------- interface --------------------------------------------------- */

  var css = [
    "#pdc-btn{position:fixed;right:20px;bottom:20px;z-index:9998;width:58px;height:58px;border-radius:50%;",
    "border:none;cursor:pointer;background:var(--wine);box-shadow:0 10px 26px -8px rgba(22,26,35,.5);",
    "display:flex;align-items:center;justify-content:center;transition:transform .18s ease,background .2s ease}",
    "#pdc-btn:hover{transform:translateY(-2px) scale(1.04);background:var(--wine-dark)}",
    "#pdc-btn svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
    "#pdc-panel{position:fixed;right:20px;bottom:88px;z-index:9999;width:376px;max-width:calc(100vw - 32px);",
    "height:520px;max-height:calc(100vh - 130px);background:var(--white);border:1px solid var(--line);",
    "border-radius:16px;box-shadow:0 26px 60px -22px rgba(22,26,35,.45);display:none;flex-direction:column;overflow:hidden}",
    "#pdc-panel.on{display:flex}",
    "#pdc-head{background:var(--ink);color:#fff;padding:15px 17px;display:flex;align-items:center;gap:11px;flex-shrink:0}",
    "#pdc-head img{height:22px;width:auto;display:block}",
    "#pdc-head b{font-family:'Syne',sans-serif;font-weight:700;font-size:15px;letter-spacing:-.02em}",
    "#pdc-head span{font-size:11.5px;color:#9AA1AA;display:block;margin-top:1px}",
    "#pdc-x{margin-left:auto;background:none;border:none;color:#9AA1AA;font-size:24px;line-height:1;cursor:pointer;padding:0 2px}",
    "#pdc-x:hover{color:#fff}",
    "#pdc-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:11px;background:var(--paper)}",
    ".pdc-m{max-width:88%;padding:11px 14px;border-radius:13px;font-size:14.5px;line-height:1.55;white-space:pre-wrap}",
    ".pdc-bot{background:var(--white);border:1px solid var(--line);color:var(--ink);align-self:flex-start;border-bottom-left-radius:4px}",
    ".pdc-me{background:var(--wine);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}",
    "#pdc-sug{display:flex;flex-wrap:wrap;gap:7px;padding:0 16px 12px;background:var(--paper)}",
    "#pdc-sug button{font-family:inherit;font-size:12.5px;background:var(--white);border:1px solid var(--line);",
    "color:var(--slate);padding:7px 11px;border-radius:99px;cursor:pointer;transition:border-color .15s,color .15s}",
    "#pdc-sug button:hover{border-color:var(--wine);color:var(--wine)}",
    "#pdc-form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line);background:var(--white);flex-shrink:0}",
    "#pdc-in{flex:1;font-family:inherit;font-size:14.5px;padding:11px 13px;border:1px solid var(--line);",
    "border-radius:10px;outline:none;color:var(--ink);background:var(--white);min-width:0}",
    "#pdc-in:focus{border-color:var(--wine)}",
    "#pdc-send{background:var(--ink);color:#fff;border:none;border-radius:10px;padding:0 15px;cursor:pointer;",
    "font-family:'Syne',sans-serif;font-weight:700;font-size:14px}",
    "#pdc-send:hover{background:var(--wine)}",
    "#pdc-foot{font-size:11px;color:var(--slate-2);text-align:center;padding:0 12px 10px;background:var(--white)}",
    "#pdc-foot a{color:var(--wine)}",
    "@media (max-width:520px){#pdc-panel{right:12px;left:12px;width:auto;bottom:82px;height:calc(100vh - 120px)}",
    "#pdc-btn{right:14px;bottom:14px}}",
    "@media (prefers-reduced-motion:reduce){#pdc-btn{transition:none}#pdc-btn:hover{transform:none}}"
  ].join("");

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  var panel, log, input, sugBox;

  function build() {
    var style = el("style"); style.textContent = css;
    document.head.appendChild(style);

    var btn = el("button", { id: "pdc-btn", "aria-label": "Ouvrir l'assistant ProspectData" });
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/></svg>';
    btn.addEventListener("click", toggle);
    document.body.appendChild(btn);

    panel = el("div", { id: "pdc-panel", role: "dialog", "aria-label": CFG.title, "aria-modal": "false" });

    var head = el("div", { id: "pdc-head" });
    var mark = el("img", { src: "assets/logo-mark.png", alt: "" });
    var txt = el("div");
    txt.appendChild(el("b", null, CFG.title));
    txt.appendChild(el("span", null, "Reponses issues du site, pas d'attente"));
    var x = el("button", { id: "pdc-x", "aria-label": "Fermer l'assistant" }, "\u00d7");
    x.addEventListener("click", toggle);
    head.appendChild(mark); head.appendChild(txt); head.appendChild(x);

    log = el("div", { id: "pdc-log", role: "log", "aria-live": "polite" });
    sugBox = el("div", { id: "pdc-sug" });

    var form = el("form", { id: "pdc-form" });
    input = el("input", {
      id: "pdc-in", type: "text", autocomplete: "off",
      placeholder: "Votre question", "aria-label": "Votre question"
    });
    var send = el("button", { id: "pdc-send", type: "submit" }, "Envoyer");
    form.appendChild(input); form.appendChild(send);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = input.value.trim();
      if (v) { input.value = ""; ask(v); }
    });

    var foot = el("div", { id: "pdc-foot" });
    foot.innerHTML = 'Une question hors documentation ? <a href="mailto:' + CFG.email + '">Ecrivez-moi</a>';

    panel.appendChild(head); panel.appendChild(log);
    panel.appendChild(sugBox); panel.appendChild(form); panel.appendChild(foot);
    document.body.appendChild(panel);

    say(CFG.welcome);
    renderSuggestions();

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && open) toggle();
    });
  }

  function renderSuggestions() {
    sugBox.textContent = "";
    CFG.suggestions.forEach(function (q) {
      var b = el("button", { type: "button" }, q);
      b.addEventListener("click", function () { ask(q); });
      sugBox.appendChild(b);
    });
  }

  function say(text, mine) {
    var m = el("div", { class: "pdc-m " + (mine ? "pdc-me" : "pdc-bot") }, text);
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  function toggle() {
    open = !open;
    panel.classList.toggle("on", open);
    if (open) {
      loadFaq();
      setTimeout(function () { input.focus(); }, 60);
    }
  }

  function loadFaq() {
    if (loaded) return;
    loaded = true;
    // Build Streamlit : la FAQ est deja injectee, aucun fetch relatif ne
    // fonctionnerait depuis l'iframe.
    if (Array.isArray(window.PD_FAQ) && window.PD_FAQ.length) {
      FAQ = window.PD_FAQ;
      return;
    }
    if (!window.fetch) return;
    fetch(CFG.faqUrl)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (d) { if (Array.isArray(d)) FAQ = d; })
      .catch(function () { /* la FAQ reste vide, le bot renvoie vers l'email */ });
  }

  function ask(question) {
    say(question, true);
    history.push({ role: "user", content: question });
    sugBox.style.display = "none";

    var pending = say("...");

    function finish(text) {
      pending.textContent = text;
      history.push({ role: "assistant", content: text });
      log.scrollTop = log.scrollHeight;
    }

    var local = answerLocally(question);

    if (window.PD_CHAT_API && window.fetch) {
      fetch(window.PD_CHAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-10), faqUrl: CFG.faqUrl })
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          finish((d && d.reply) ? d.reply : (local || FALLBACK));
        })
        .catch(function () { finish(local || FALLBACK); });
      return;
    }

    setTimeout(function () { finish(local || FALLBACK); }, 260);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
