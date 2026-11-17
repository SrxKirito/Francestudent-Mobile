"use strict";

// Project shares are server-owned; the dialog never invents local permissions.
const originalProjectEditorForShares = openProjectEditor;
const projectSharesState = { panel: null, toggle: null, status: null, list: null, input: null, submit: null, generation: 0, request: 0, projectId: null };

function shareProjectRoute(id) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Identifiant de projet invalide.");
  return "/projects/" + encodeURIComponent(id) + "/shares";
}

function shareCurrent(generation, id, session) {
  return generation === projectSharesState.generation && id === projectSharesState.projectId && session === store.session && Boolean(session);
}

async function refreshProjectShares() {
  const { projectId: id, generation } = projectSharesState, session = store.session;
  if (!id || !session) return;
  const request = ++projectSharesState.request;
  projectSharesState.status.textContent = "Chargement des accès…";
  try {
    const users = await settingsApi(shareProjectRoute(id));
    if (!shareCurrent(generation, id, session) || request !== projectSharesState.request) return;
    if (!Array.isArray(users)) throw new Error("Liste des accès invalide.");
    projectSharesState.list.replaceChildren();
    for (const user of users) {
      const row = document.createElement("div"); row.className = "project-share-row";
      const label = document.createElement("span");
      label.textContent = (typeof user.userEmail === "string" && user.userEmail ? user.userEmail : "Utilisateur") + (user.owner === true ? " · Propriétaire" : user.permission === "Write" ? " · Écriture" : user.permission === "View" ? " · Lecture" : "");
      row.append(label);
      if (user.owner !== true && Number.isInteger(user.userId) && user.userId >= -2147483648 && user.userId <= 2147483647) {
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Retirer";
        remove.onclick = async () => {
          if (!confirm("Retirer cet accès au projet ?")) return;
          remove.disabled = true;
          try {
            await settingsApi(shareProjectRoute(id) + "/" + encodeURIComponent(user.userId), { method: "DELETE" });
            if (shareCurrent(generation, id, session)) { projectSharesState.request++; row.remove(); projectSharesState.status.textContent = "Accès retiré."; }
          } catch (error) { if (shareCurrent(generation, id, session)) projectSharesState.status.textContent = "Suppression impossible : " + (error?.message || error); }
          finally { remove.disabled = false; }
        };
        row.append(remove);
      }
      projectSharesState.list.append(row);
    }
    projectSharesState.status.textContent = users.length ? "" : "Aucun accès partagé.";
  } catch (error) { if (shareCurrent(generation, id, session) && request === projectSharesState.request) projectSharesState.status.textContent = "Chargement impossible : " + (error?.message || error); }
}

async function createProjectShare() {
  const { projectId: id, generation, input, submit } = projectSharesState, session = store.session;
  const userEmail = input.value.trim();
  if (!id || !session || !userEmail || submit.disabled) return;
  submit.disabled = true; projectSharesState.status.textContent = "Partage en cours…";
  try {
    await settingsApi(shareProjectRoute(id), { method: "POST", body: JSON.stringify({ userEmail }) });
    if (!shareCurrent(generation, id, session)) return;
    input.value = "";
    await refreshProjectShares();
  } catch (error) { if (shareCurrent(generation, id, session)) projectSharesState.status.textContent = "Partage impossible : " + (error?.message || error); }
  finally { submit.disabled = false; }
}

function ensureProjectSharePanel() {
  if (projectSharesState.panel) return;
  const editor = document.getElementById("project-editor"), form = document.getElementById("project-form");
  if (!editor || !form) return;
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "settings-btn project-share-toggle"; toggle.textContent = "Gérer les accès"; toggle.setAttribute("aria-expanded", "false");
  const panel = document.createElement("section"); panel.className = "project-share-panel"; panel.hidden = true; panel.setAttribute("aria-label", "Accès au projet");
  const input = document.createElement("input"); input.type = "email"; input.className = "settings-input"; input.placeholder = "Adresse e-mail"; input.setAttribute("aria-label", "Adresse e-mail à partager");
  const submit = document.createElement("button"); submit.type = "button"; submit.className = "settings-btn"; submit.textContent = "Partager";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const list = document.createElement("div");
  panel.append(input, submit, status, list); form.after(toggle, panel);
  Object.assign(projectSharesState, { toggle, panel, input, submit, status, list });
  toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden)); if (!panel.hidden) void refreshProjectShares(); };
  submit.onclick = () => { void createProjectShare(); };
  editor.addEventListener("close", () => { projectSharesState.generation++; panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); input.value = ""; list.replaceChildren(); status.textContent = ""; });
}

openProjectEditor = function(project) {
  projectSharesState.generation++;
  projectSharesState.projectId = project?.id || null;
  originalProjectEditorForShares(project);
  ensureProjectSharePanel();
  if (!projectSharesState.panel) return;
  projectSharesState.panel.hidden = true;
  projectSharesState.toggle.hidden = !projectSharesState.projectId;
  projectSharesState.toggle.setAttribute("aria-expanded", "false");
  projectSharesState.input.value = ""; projectSharesState.list.replaceChildren(); projectSharesState.status.textContent = "";
};
