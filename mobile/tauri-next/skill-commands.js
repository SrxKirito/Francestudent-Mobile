"use strict";
// Commandes « /skill » dans la barre de saisie (version Tauri uniquement).
// - taper "/" au début du message ouvre la liste des skills activés du compte ;
// - choisir un skill écrit « /nom » en bleu dans la saisie et dans la bulle envoyée ;
// - à l'envoi, une consigne est ajoutée au message pour imposer le skill au modèle
//   (l'API de chat n'a pas de champ dédié : voir tauriSkillPrefix).
(function () {
  const CACHE_MS = 60000;
  const MAX_SKILLS = 2000;

  // ---------- Fonctions pures ----------

  function normalize(value) {
    return String(value == null ? "" : value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function isEnabled(skill) {
    return !!skill && skill.enabled !== false && skill.disabled !== true;
  }

  // Nom tapable au clavier : minuscules, sans accents, espaces -> "-".
  function skillSlug(skill) {
    const base = normalize(skill && (skill.name || skill.id)).replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
    return base || "skill";
  }

  // Texte entier = un seul mot commençant par "/" -> renvoie la recherche (peut être ""), sinon null.
  function skillQuery(text) {
    const match = /^\/([^\s/]*)$/.exec(String(text == null ? "" : text));
    return match ? match[1] : null;
  }

  // Commande « /slug » en début de message, suivie d'un espace ou de la fin du texte.
  function parseSkillCommand(text, skills) {
    const value = String(text == null ? "" : text);
    const match = /^(\s*)\/([^\s/]+)(?=\s|$)/.exec(value);
    if (!match || !Array.isArray(skills)) return null;
    const wanted = normalize(match[2]);
    for (const skill of skills) {
      if (skillSlug(skill) === wanted) {
 const start = match[1].length;
        return { skill, slug: skillSlug(skill), start, end: start + 1 + match[2].length };
      }
    }
    return null;
  }

  function filterSkills(skills, query) {
    const q = normalize(query);
    const rows = (Array.isArray(skills) ? skills : []).map((skill) => ({ skill, slug: skillSlug(skill) }));
    const kept = rows.filter((row) => !q || row.slug.includes(q) || normalize(`${row.skill.name || ""} ${row.skill.description || ""}`).includes(q));
    if (!q) return kept;
    return kept.filter((row) => row.slug.startsWith(q)).concat(kept.filter((row) => !row.slug.startsWith(q)));
  }

  function skillPromptPrefix(skill, slug) {
    const name = String((skill && (skill.name || skill.id)) || slug);
    const id = skill && skill.id ? `, id : ${skill.id}` : "";
    return `[Skill imposé par l'utilisateur : « ${name} » (commande /${slug}${id}). Tu dois utiliser ce skill — ses instructions et ses ressources — pour traiter la demande ci-dessous, même si elle semble réalisable sans lui. Si le skill est introuvable ou inutilisable, dis-le clairement avant de répondre autrement.]\n\n`;
  }

  // ---------- Chargement des skills ----------

  let skills = [];
  let loadedAt = 0;
  let loading = null;
  let lastError = "";

  async function fetchAllSkills() {
    const all = [];
    const seen = new Set();
    const cursors = new Set();
    let after = "";
    for (;;) {
      const query = new URLSearchParams({ limit: "100" });
      if (after) query.set("after", after);
      const page = await settingsApi("/skills?" + query);
      if (!page || !Array.isArray(page.data)) throw new Error("Réponse de skills invalide.");
      for (const item of page.data) {
        if (item && typeof item.id === "string" && !seen.has(item.id)) { seen.add(item.id); all.push(item); }
      }
      if (!page.has_more) break;
      const next = String(page.last_id || (page.data.length ? page.data[page.data.length - 1].id : "") || "");
      if (!next || cursors.has(next) || all.length >= MAX_SKILLS) throw new Error("Pagination des skills invalide ou trop longue.");
      cursors.add(next);
      after = next;
    }
    return all;
  }

  function ensureSkills() {
    if (loadedAt && Date.now() - loadedAt < CACHE_MS) return Promise.resolve(skills);
    if (loading) return loading;
    const request = fetchAllSkills().then((list) => {
      skills = list.filter(isEnabled);
      loadedAt = Date.now();
      lastError = "";
      return skills;
    }, (error) => {
      lastError = (error && error.message) || "erreur inconnue";
      throw error;
    });
    loading = request;
    const clear = () => { if (loading === request) loading = null; };
    request.then(clear, clear);
    return request;
  }

  // Consigne ajoutée au message envoyé (le texte affiché reste inchangé).
  function tauriSkillPrefix(text) {
    const parsed = parseSkillCommand(text, skills);
    return parsed ? skillPromptPrefix(parsed.skill, parsed.slug) : "";
  }

  // ---------- Bulles de messages ----------

  function styleBubble(bubble) {
    const node = bubble && bubble.firstChild;
    if (!node || node.nodeType !== 3 || (bubble.querySelector && bubble.querySelector(".skill-command"))) return;
    const value = String(node.nodeValue || "");
    const parsed = parseSkillCommand(value, skills);
    if (!parsed) return;
    const command = document.createElement("span");
    command.className = "skill-command";
    command.textContent = value.slice(parsed.start, parsed.end);
    const parts = [];
    if (parsed.start) parts.push(document.createTextNode(value.slice(0, parsed.start)));
    parts.push(command);
    if (parsed.end < value.length) parts.push(document.createTextNode(value.slice(parsed.end)));
    parts.forEach((part) => bubble.insertBefore(part, node));
    bubble.removeChild(node);
  }

  function restyleBubbles() {
    const bubbles = document.querySelectorAll ? document.querySelectorAll("#messages .message.user .bubble") : [];
    Array.prototype.forEach.call(bubbles, styleBubble);
  }

  function wrapAppendMessage() {
    if (typeof appendMessage !== "function" || appendMessage.tauriSkills) return;
    const original = appendMessage;
    const wrapped = function (role, content, index, animate) {
      const bubble = original.apply(this, arguments);
      if (role === "user" && typeof content === "string" && /^\s*\//.test(content)) {
 styleBubble(bubble);
        if (!loadedAt) ensureSkills().then(restyleBubbles, () => {});
      }
      return bubble;
    };
    wrapped.tauriSkills = true;
    appendMessage = wrapped; // eslint-disable-line no-global-assign
  }

  // ---------- Barre de saisie ----------

  function mount() {
    const prompt = document.getElementById("prompt");
    const composer = document.getElementById("composer");
    if (!prompt || !composer || prompt.tauriSkillCommands) return;
    prompt.tauriSkillCommands = true;

    const menu = document.createElement("div");
    menu.id = "skill-menu";
    menu.className = "skill-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "Skills disponibles");
    menu.hidden = true;
    document.body.appendChild(menu);

    const mirror = document.createElement("div");
    mirror.className = "prompt-highlight";
    mirror.setAttribute("aria-hidden", "true");
    prompt.parentNode.insertBefore(mirror, prompt.nextSibling);
    prompt.setAttribute("aria-controls", "skill-menu");
    prompt.setAttribute("aria-expanded", "false");

    let rows = [];
    let active = 0;
    let dismissed = null;
    let sessionLoaded = false;

    // -- Surlignage bleu de la commande dans le textarea --
    function px(value) { return `${Math.max(0, value)}px`; }

    function placeMirror() {
      const style = window.getComputedStyle(prompt);
      ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "wordSpacing", "textTransform", "textIndent", "textAlign", "tabSize",
 "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing"]
        .forEach((name) => { mirror.style[name] = style[name]; });
      const borders = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
      const scrollbar = prompt.offsetWidth - prompt.clientWidth - borders;
      const parent = mirror.offsetParent || document.body;
      const parentBox = parent.getBoundingClientRect();
      const box = prompt.getBoundingClientRect();
      mirror.style.left = px(box.left - parentBox.left - (parent.clientLeft || 0) + (parent.scrollLeft || 0));
      mirror.style.top = px(box.top - parentBox.top - (parent.clientTop || 0) + (parent.scrollTop || 0));
      mirror.style.width = px(prompt.offsetWidth - Math.max(0, scrollbar));
      mirror.style.height = px(prompt.offsetHeight);
      mirror.scrollTop = prompt.scrollTop;
    }

    function syncHighlight() {
      const text = prompt.value;
      const parsed = parseSkillCommand(text, skills);
      if (!parsed) {
 mirror.replaceChildren();
 prompt.removeAttribute("data-skill-active");
 return;
      }
      const command = document.createElement("span");
      command.className = "skill-command";
      command.textContent = text.slice(parsed.start, parsed.end);
      mirror.replaceChildren(
        document.createTextNode(text.slice(0, parsed.start)),
        command,
 document.createTextNode(text.slice(parsed.end) + (text.endsWith("\n") ? " " : ""))
      );
      prompt.setAttribute("data-skill-active", "true");
      placeMirror();
    }

    // Réaffectations par script (prompt.value = "") : resynchroniser sans événement.
    if (typeof HTMLTextAreaElement !== "undefined") {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (descriptor && descriptor.get && descriptor.set) {
        Object.defineProperty(prompt, "value", {
   configurable: true,
          get() { return descriptor.get.call(this); },
          set(next) { descriptor.set.call(this, next); syncHighlight(); renderMenu(false); }
 });
      }
    }

    // -- Menu --
    function hideMenu() {
      menu.hidden = true;
      rows = [];
      sessionLoaded = false;
      prompt.setAttribute("aria-expanded", "false");
      prompt.removeAttribute("aria-activedescendant");
    }

    function placeMenu() {
      const box = (composer.getBoundingClientRect && composer.getBoundingClientRect()) || prompt.getBoundingClientRect();
      menu.style.left = px(box.left);
      menu.style.width = px(box.width);
      menu.style.bottom = px((window.innerHeight || 0) - box.top + 8);
    }

    function status(text) {
      const row = document.createElement("div");
      row.className = "skill-menu-status";
      row.textContent = text;
      return row;
    }

    function setActive(next) {
      if (!rows.length) return;
      active = (next + rows.length) % rows.length;
      Array.prototype.forEach.call(menu.children, (child, index) => {
        const on = index === active;
 child.className = on ? "skill-menu-item is-active" : "skill-menu-item";
 child.setAttribute("aria-selected", String(on));
        if (on) {
          prompt.setAttribute("aria-activedescendant", child.id);
          if (child.scrollIntoView) child.scrollIntoView({ block: "nearest" });
 }
      });
    }

    function choose(index) {
      const row = rows[index];
      if (!row) return;
      hideMenu();
      prompt.value = `/${row.slug} `;
      if (prompt.focus) prompt.focus();
      if (prompt.setSelectionRange) prompt.setSelectionRange(prompt.value.length, prompt.value.length);
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function renderMenu(allowLoad) {
      const text = prompt.value;
      const query = skillQuery(text);
      if (query === null || dismissed === text) { if (!menu.hidden) hideMenu(); return; }
      if (allowLoad === false && menu.hidden) return;
      if (allowLoad !== false && !sessionLoaded) {
        sessionLoaded = true;
 ensureSkills().then(() => { syncHighlight(); restyleBubbles(); renderMenu(false); }, () => renderMenu(false));
      }
      menu.hidden = false;
      prompt.setAttribute("aria-expanded", "true");
      rows = filterSkills(skills, query);
      menu.replaceChildren();
      if (!rows.length) {
 if (loading && !skills.length) menu.appendChild(status("Chargement des skills…"));
        else if (lastError && !skills.length) menu.appendChild(status("Impossible de charger les skills : " + lastError));
        else if (!skills.length) menu.appendChild(status("Aucun skill activé sur ton compte."));
        else menu.appendChild(status(`Aucun skill ne correspond à « ${query} ».`));
      }
      rows.forEach((row, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.id = "skill-menu-item-" + index;
        item.className = "skill-menu-item";
        item.setAttribute("role", "option");
        const name = document.createElement("span");
        name.className = "skill-menu-name skill-command";
 name.textContent = "/" + row.slug;
        const description = document.createElement("span");
        description.className = "skill-menu-description";
        description.textContent = String(row.skill.description || row.skill.name || "");
        item.append(name, description);
        item.addEventListener("mousedown", (event) => event.preventDefault());
 item.addEventListener("click", () => choose(index));
        menu.appendChild(item);
      });
      placeMenu();
      setActive(Math.min(active, Math.max(0, rows.length - 1)));
    }

    prompt.addEventListener("input", () => {
      if (dismissed !== null && dismissed !== prompt.value) dismissed = null;
      active = 0;
      syncHighlight();
      renderMenu(true);
      // Texte collé du type « /skill question » : charger quand même les skills pour reconnaître la commande.
      if (/^\s*\//.test(prompt.value) && !loadedAt && !loading) ensureSkills().then(() => { syncHighlight(); restyleBubbles(); }, () => {});
    });
    prompt.addEventListener("scroll", () => { mirror.scrollTop = prompt.scrollTop; });

    // Capture sur le formulaire : passe avant l'écouteur d'envoi (Entrée) de app.js.
    composer.addEventListener("keydown", (event) => {
      if (event.target !== prompt || menu.hidden || !rows.length || event.isComposing) return;
      if (event.key === "ArrowDown") setActive(active + 1);
      else if (event.key === "ArrowUp") setActive(active - 1);
      else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") choose(active);
      else if (event.key === "Escape") { dismissed = prompt.value; hideMenu(); }
      else return;
      event.preventDefault();
      event.stopPropagation();
    }, true);

    document.addEventListener("pointerdown", (event) => {
      if (menu.hidden || event.target === prompt || menu.contains(event.target)) return;
      dismissed = prompt.value;
      hideMenu();
    }, true);
    window.addEventListener("resize", () => { if (!menu.hidden) placeMenu(); syncHighlight(); });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => syncHighlight()).observe(prompt);
  }

  globalThis.tauriSkillPrefix = tauriSkillPrefix;
  globalThis.TauriSkillCommands = { skillSlug, skillQuery, parseSkillCommand, filterSkills, skillPromptPrefix, isEnabled, ensureSkills, styleBubble };

  if (typeof document !== "undefined") {
    wrapAppendMessage();
    mount();
  }
})();
