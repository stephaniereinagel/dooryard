// Homestead Ops — app.js
// Single-file ES module app. Uses Supabase Auth + owner-scoped RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { marked } from "https://esm.sh/marked@12";

const CONFIG = window.HOMESTEAD_OPS_CONFIG || {};
const SUPABASE_URL = String(CONFIG.supabaseUrl || "").trim();
const SUPABASE_ANON_KEY = String(CONFIG.supabaseAnonKey || "").trim();
const DEFAULT_WORKSPACE_NAME = CONFIG.defaultWorkspaceName || "Homestead";
const LINKS = CONFIG.links || {};

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("Homestead Ops: Supabase URL / anon key not set in app-config.js");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const state = {
  session: null,
  user: null,
  workspace: null,    // { id, owner_user_id, name }
  membership: null,   // { role, display_name }
  availableWorkspaces: [], // [{ id, name, owner_user_id, role, display_name }]
  whiteboard: [],
  backlog: [],
  logs: [],           // most-recent first
  members: [],        // [{ user_id, role, display_name }]
  currentView: "today",
  referenceDoc: "shift-playbook",
  referenceCache: {}
};

const ACTIVE_WORKSPACE_KEY = "dooryard.activeWorkspaceId";

// ====================================================
// UI REFS
// ====================================================

const $ = (id) => document.getElementById(id);
const ui = {
  authGate: $("auth-gate"),
  app: $("app"),
  authEmail: $("auth-email"),
  authPassword: $("auth-password"),
  authSignin: $("auth-signin-btn"),
  authSignup: $("auth-signup-btn"),
  authMagic: $("auth-magic-link-btn"),
  authStatus: $("auth-status"),
  workspaceLabel: $("workspace-label"),
  userChip: $("user-chip"),
  workspaceErrorBanner: $("workspace-error-banner"),
  workspaceErrorDetail: $("workspace-error-detail"),
  retryWorkspaceBtn: $("retry-workspace-btn"),
  signoutBtn: $("signout-btn"),
  todayTitle: $("today-title"),
  todaySubtitle: $("today-subtitle"),
  todayWhiteboard: $("today-whiteboard"),
  todayBacklog: $("today-backlog"),
  daySpecificTitle: $("day-specific-title"),
  daySpecificBody: $("day-specific-body"),
  dayPanel: $("day-specific-panel"),
  linkGardenCoach: $("link-garden-coach"),
  linkFacebook: $("link-facebook"),
  eggChicken: $("egg-chicken"),
  eggDuck: $("egg-duck"),
  logHoursStart: $("log-hours-start"),
  logHoursEnd: $("log-hours-end"),
  logWeather: $("log-weather"),
  logFocus: $("log-focus"),
  logFinished: $("log-finished"),
  logPartial: $("log-partial"),
  logFlags: $("log-flags"),
  logSupplies: $("log-supplies"),
  logAnimals: $("log-animals"),
  logGarden: $("log-garden"),
  logQuestions: $("log-questions"),
  logNext: $("log-next"),
  logStandOpen: $("log-stand-open"),
  logFbPosted: $("log-fb-posted"),
  logStandInventory: $("log-stand-inventory"),
  saveLogBtn: $("save-log-btn"),
  saveLogStatus: $("save-log-status"),
  fridayOnly: document.querySelector(".friday-only"),
  whiteboardList: $("whiteboard-list"),
  addWhiteboardBtn: $("add-whiteboard-btn"),
  whiteboardDialog: $("whiteboard-dialog"),
  whiteboardForm: $("whiteboard-form"),
  whiteboardDialogTitle: $("whiteboard-dialog-title"),
  whiteboardId: $("whiteboard-id"),
  whiteboardText: $("whiteboard-text"),
  whiteboardPinned: $("whiteboard-pinned"),
  whiteboardCancel: $("whiteboard-cancel"),
  backlogList: $("backlog-list"),
  addBacklogBtn: $("add-backlog-btn"),
  backlogDialog: $("backlog-dialog"),
  backlogForm: $("backlog-form"),
  backlogDialogTitle: $("backlog-dialog-title"),
  backlogId: $("backlog-id"),
  backlogTitle: $("backlog-title"),
  backlogCategory: $("backlog-category"),
  backlogZone: $("backlog-zone"),
  backlogNotes: $("backlog-notes"),
  backlogStatus: $("backlog-status"),
  backlogCancel: $("backlog-cancel"),
  backlogCategoryFilter: $("backlog-category-filter"),
  backlogZoneFilter: $("backlog-zone-filter"),
  backlogStatusFilter: $("backlog-status-filter"),
  seasonalContent: $("seasonal-content"),
  logList: $("log-list"),
  exportLogsBtn: $("export-logs-btn"),
  logFilterFrom: $("log-filter-from"),
  logFilterTo: $("log-filter-to"),
  logFilterApply: $("log-filter-apply"),
  logFilterClear: $("log-filter-clear"),
  logViewDialog: $("log-view-dialog"),
  logViewContent: $("log-view-content"),
  logViewClose: $("log-view-close"),
  referenceContent: $("reference-content"),
  workspaceNameInput: $("workspace-name-input"),
  saveWorkspaceBtn: $("save-workspace-btn"),
  myUserId: $("my-user-id"),
  inviteUserId: $("invite-user-id"),
  inviteDisplayName: $("invite-display-name"),
  inviteRole: $("invite-role"),
  inviteBtn: $("invite-btn"),
  inviteStatus: $("invite-status"),
  memberList: $("member-list"),
  workspaceSwitcher: $("workspace-switcher"),
  workspaceSwitcherWrap: $("workspace-switcher-wrap"),
  tabbar: $("tabbar")
};

// ====================================================
// UTILITIES
// ====================================================

function dayOfWeekShort(d = new Date()) {
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.style.color = kind === "error" ? "var(--danger)" : kind === "ok" ? "var(--accent)" : "var(--ink-soft)";
}

function showAppShell(signedIn) {
  ui.authGate.hidden = signedIn;
  ui.app.hidden = !signedIn;
}

function showError(prefix, err) {
  const msg = err?.message || err?.error_description || String(err) || "Unknown error";
  console.error(prefix, err);
  alert(`${prefix}\n\n${msg}`);
}

// Wrap a Supabase response. Returns data on success, or throws with a useful message.
function unwrap(resp, what) {
  if (resp.error) {
    const err = new Error(`${what} failed: ${resp.error.message}`);
    err.original = resp.error;
    throw err;
  }
  return resp.data;
}

// ====================================================
// AUTH
// ====================================================

async function handleAuthSession() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session || null;
  state.user = state.session?.user || null;
  if (state.user) {
    setStatus(ui.authStatus, "Loading workspace…");
    await onSignedIn();
  } else {
    showAppShell(false);
    setStatus(ui.authStatus, "Sign in to continue.");
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  state.session = session;
  state.user = session?.user || null;
  if (state.user) {
    onSignedIn();
  } else {
    showAppShell(false);
    setStatus(ui.authStatus, "Signed out.");
  }
});

async function signIn() {
  const email = ui.authEmail.value.trim();
  const password = ui.authPassword.value;
  if (!email || !password) {
    setStatus(ui.authStatus, "Enter email + password.", "error");
    return;
  }
  setStatus(ui.authStatus, "Signing in…");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) setStatus(ui.authStatus, error.message, "error");
}

async function signUp() {
  const email = ui.authEmail.value.trim();
  const password = ui.authPassword.value;
  if (!email || !password) {
    setStatus(ui.authStatus, "Enter email + password.", "error");
    return;
  }
  setStatus(ui.authStatus, "Creating account…");
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) setStatus(ui.authStatus, error.message, "error");
  else setStatus(ui.authStatus, "Check your email to confirm (if confirmations are enabled), then sign in.", "ok");
}

async function sendMagicLink() {
  const email = ui.authEmail.value.trim();
  if (!email) {
    setStatus(ui.authStatus, "Enter email.", "error");
    return;
  }
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    setStatus(ui.authStatus, "Magic link won't redirect from localhost. Use email+password on local dev.", "error");
    return;
  }
  setStatus(ui.authStatus, "Sending magic link…");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  if (error) setStatus(ui.authStatus, error.message, "error");
  else setStatus(ui.authStatus, "Link sent — check your inbox.", "ok");
}

async function signOut() {
  await supabase.auth.signOut();
}

// ====================================================
// WORKSPACE BOOTSTRAP
// ====================================================

async function onSignedIn() {
  showAppShell(true);
  ui.userChip.textContent = state.user.email || "Signed in";
  ui.myUserId.textContent = state.user.id;
  hideWorkspaceError();

  try {
    await ensureWorkspace();
  } catch (err) {
    console.error("ensureWorkspace threw:", err);
    const who = await runWhoami();
    const detail = who
      ? `${err?.message || err}.  Server says uid=${who.uid || "null"}, role=${who.role || "null"}.`
      : (err?.message || String(err));
    showWorkspaceError(detail);
    return;
  }

  if (!state.workspace) {
    showWorkspaceError("Workspace lookup returned no data. Check the browser console for details.");
    return;
  }

  try {
    await Promise.all([
      loadWhiteboard(),
      loadBacklog(),
      loadLogs(),
      loadMembers()
    ]);

    ui.workspaceLabel.textContent = state.workspace.name;
    ui.workspaceNameInput.value = state.workspace.name;

    renderToday();
    renderWhiteboard();
    renderBacklog();
    renderLogs();
    renderMembers();
    renderWorkspaceSwitcher();
    renderReference(state.referenceDoc);
    loadSeasonalInBacklog();
  } catch (err) {
    console.error("Data load failed:", err);
    showWorkspaceError(err?.message || String(err));
  }
}

function showWorkspaceError(detail) {
  if (!ui.workspaceErrorBanner) return;
  ui.workspaceErrorDetail.textContent = detail || "See browser console for details.";
  ui.workspaceErrorBanner.hidden = false;
}

async function runWhoami() {
  try {
    const { data, error } = await supabase.rpc("whoami");
    if (error) {
      console.warn("whoami rpc error:", error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    console.log("[whoami]", row, "client user.id=", state.user?.id);
    return row;
  } catch (e) {
    console.warn("whoami threw:", e);
    return null;
  }
}

function hideWorkspaceError() {
  if (ui.workspaceErrorBanner) ui.workspaceErrorBanner.hidden = true;
}

async function ensureWorkspace() {
  console.log("[ensureWorkspace] start for user", state.user?.id);

  // Step 1: try to find existing memberships (fast path for returning users
  // and for non-owner members like Silas / Daniel).
  const mResp = await supabase
    .from("workspace_members")
    .select("workspace_id, role, display_name, created_at, workspaces:workspace_id(id, name, owner_user_id)")
    .eq("user_id", state.user.id);
  console.log("[ensureWorkspace] memberships:", mResp);
  const memberships = unwrap(mResp, "Load workspace memberships");

  const joined = (memberships || []).filter(x => x.workspaces);
  if (joined.length > 0) {
    state.availableWorkspaces = joined.map(m => ({
      id: m.workspaces.id,
      name: m.workspaces.name,
      owner_user_id: m.workspaces.owner_user_id,
      role: m.role,
      display_name: m.display_name,
      joined_at: m.created_at
    }));

    // Selection order:
    //   1. A previously-chosen workspace remembered in localStorage (if still accessible).
    //   2. A workspace the user was INVITED to (owner_user_id !== their user id).
    //   3. Most recently joined workspace.
    //   4. First membership as a final fallback.
    const stored = safeGetItem(ACTIVE_WORKSPACE_KEY);
    let pick = stored && state.availableWorkspaces.find(w => w.id === stored);
    if (!pick) {
      const invited = state.availableWorkspaces.filter(w => w.owner_user_id !== state.user.id);
      const pool = invited.length ? invited : state.availableWorkspaces;
      pool.sort((a, b) => (b.joined_at || "").localeCompare(a.joined_at || ""));
      pick = pool[0];
    }

    state.workspace = {
      id: pick.id,
      name: pick.name,
      owner_user_id: pick.owner_user_id
    };
    state.membership = { role: pick.role, display_name: pick.display_name };
    safeSetItem(ACTIVE_WORKSPACE_KEY, pick.id);
    console.log("[ensureWorkspace] using workspace", state.workspace,
                "of", state.availableWorkspaces.length, "accessible");
    return;
  }

  // Step 2: no membership found → call the bootstrap RPC. This runs server-side
  // as SECURITY DEFINER and creates the workspace + admin membership atomically,
  // sidestepping per-row RLS on the initial INSERT (policies still protect all
  // subsequent reads/writes).
  const bResp = await supabase.rpc("bootstrap_workspace", { p_name: DEFAULT_WORKSPACE_NAME });
  console.log("[ensureWorkspace] bootstrap:", bResp);
  const rows = unwrap(bResp, "Bootstrap workspace");
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    throw new Error("bootstrap_workspace returned no rows");
  }
  state.workspace = {
    id: row.id,
    name: row.name,
    owner_user_id: row.owner_user_id
  };
  state.membership = { role: "admin", display_name: state.user.email };
  state.availableWorkspaces = [{
    id: row.id,
    name: row.name,
    owner_user_id: row.owner_user_id,
    role: "admin",
    display_name: state.user.email,
    joined_at: new Date().toISOString()
  }];
  safeSetItem(ACTIVE_WORKSPACE_KEY, row.id);
  console.log("[ensureWorkspace] bootstrapped workspace", state.workspace);
}

function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

async function switchWorkspace(workspaceId) {
  const target = state.availableWorkspaces.find(w => w.id === workspaceId);
  if (!target || !state.workspace || target.id === state.workspace.id) return;
  safeSetItem(ACTIVE_WORKSPACE_KEY, target.id);
  state.workspace = {
    id: target.id,
    name: target.name,
    owner_user_id: target.owner_user_id
  };
  state.membership = { role: target.role, display_name: target.display_name };

  try {
    await Promise.all([loadWhiteboard(), loadBacklog(), loadLogs(), loadMembers()]);
    ui.workspaceLabel.textContent = state.workspace.name;
    ui.workspaceNameInput.value = state.workspace.name;
    renderToday();
    renderWhiteboard();
    renderBacklog();
    renderLogs();
    renderMembers();
    renderWorkspaceSwitcher();
  } catch (err) {
    showError("Couldn't load the selected workspace.", err);
  }
}

function renderWorkspaceSwitcher() {
  if (!ui.workspaceSwitcher || !ui.workspaceSwitcherWrap) return;
  const list = state.availableWorkspaces || [];
  if (list.length <= 1) {
    ui.workspaceSwitcherWrap.hidden = true;
    return;
  }
  ui.workspaceSwitcherWrap.hidden = false;
  ui.workspaceSwitcher.innerHTML = list.map(w => {
    const label = (w.owner_user_id === state.user?.id)
      ? `${w.name} (your workspace)`
      : `${w.name}`;
    return `<option value="${escapeHtml(w.id)}">${escapeHtml(label)}</option>`;
  }).join("");
  ui.workspaceSwitcher.value = state.workspace.id;
}

async function saveWorkspaceName() {
  const newName = ui.workspaceNameInput.value.trim();
  if (!newName || !state.workspace) return;
  const { error } = await supabase
    .from("workspaces")
    .update({ name: newName })
    .eq("id", state.workspace.id);
  if (error) return alert("Error: " + error.message);
  state.workspace.name = newName;
  ui.workspaceLabel.textContent = newName;
}

// ====================================================
// MEMBERS
// ====================================================

async function loadMembers() {
  if (!state.workspace) return;
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, display_name")
    .eq("workspace_id", state.workspace.id);
  if (error) {
    console.error(error);
    return;
  }
  state.members = data || [];
}

function renderMembers() {
  const ul = ui.memberList;
  if (!ul) return;
  ul.innerHTML = "";
  if (!state.members.length) {
    const li = document.createElement("li");
    li.textContent = "Just you.";
    ul.appendChild(li);
    return;
  }
  state.members.forEach(m => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${escapeHtml(m.display_name || m.user_id)}</span>
      <span class="role-badge">${escapeHtml(m.role)}</span>
    `;
    ul.appendChild(li);
  });
}

async function addMember() {
  const userId = ui.inviteUserId.value.trim();
  const displayName = ui.inviteDisplayName.value.trim();
  const role = ui.inviteRole.value;
  if (!userId) {
    setStatus(ui.inviteStatus, "Enter a user ID.", "error");
    return;
  }
  setStatus(ui.inviteStatus, "Adding…");
  const { error } = await supabase.from("workspace_members").insert({
    workspace_id: state.workspace.id,
    user_id: userId,
    role,
    display_name: displayName || null
  });
  if (error) return setStatus(ui.inviteStatus, error.message, "error");
  setStatus(ui.inviteStatus, "Added.", "ok");
  ui.inviteUserId.value = "";
  ui.inviteDisplayName.value = "";
  await loadMembers();
  renderMembers();
}

// ====================================================
// WHITEBOARD
// ====================================================

async function loadWhiteboard() {
  const { data, error } = await supabase
    .from("whiteboard_items")
    .select("*")
    .eq("workspace_id", state.workspace.id)
    .order("pinned", { ascending: false })
    .order("rank", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return; }
  state.whiteboard = data || [];
}

function renderWhiteboard() {
  renderWhiteboardList(ui.whiteboardList, false);
  renderWhiteboardList(ui.todayWhiteboard, true);
}

function renderWhiteboardList(el, compact) {
  el.innerHTML = "";
  const items = compact
    ? state.whiteboard.filter(i => !i.done).slice(0, 5)
    : state.whiteboard;
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = compact ? "No priorities set." : "Nothing on the board. Add what's urgent this week.";
    el.appendChild(li);
    return;
  }
  items.forEach(item => {
    const li = document.createElement("li");
    li.className = "whiteboard-item" + (item.pinned ? " pinned" : "") + (item.done ? " done" : "");
    const actions = compact
      ? ""
      : `<div class="actions">
          <button class="mini-btn" data-action="toggle-done" data-id="${item.id}">${item.done ? "↺" : "✓"}</button>
          <button class="mini-btn" data-action="toggle-pin" data-id="${item.id}">${item.pinned ? "📌" : "📍"}</button>
          <button class="mini-btn" data-action="edit" data-id="${item.id}">✎</button>
          <button class="mini-btn" data-action="delete" data-id="${item.id}">✕</button>
        </div>`;
    li.innerHTML = `
      ${item.pinned ? '<span class="pin-indicator">📌</span>' : ""}
      <span class="text">${escapeHtml(item.text)}</span>
      ${actions}
    `;
    el.appendChild(li);
  });
  if (!compact) {
    el.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", onWhiteboardAction);
    });
  }
}

async function onWhiteboardAction(e) {
  const id = e.currentTarget.dataset.id;
  const action = e.currentTarget.dataset.action;
  const item = state.whiteboard.find(i => i.id === id);
  if (!item) return;

  try {
    if (action === "toggle-done") {
      unwrap(await supabase.from("whiteboard_items").update({ done: !item.done }).eq("id", id), "Update priority");
    } else if (action === "toggle-pin") {
      unwrap(await supabase.from("whiteboard_items").update({ pinned: !item.pinned }).eq("id", id), "Update priority");
    } else if (action === "delete") {
      if (!confirm("Remove this priority?")) return;
      unwrap(await supabase.from("whiteboard_items").delete().eq("id", id), "Delete priority");
    } else if (action === "edit") {
      openWhiteboardDialog(item);
      return;
    }
    await loadWhiteboard();
    renderWhiteboard();
  } catch (err) {
    showError("Could not update the priority.", err);
  }
}

function openWhiteboardDialog(item) {
  ui.whiteboardDialogTitle.textContent = item ? "Edit priority" : "Add priority";
  ui.whiteboardId.value = item?.id || "";
  ui.whiteboardText.value = item?.text || "";
  ui.whiteboardPinned.checked = !!item?.pinned;
  ui.whiteboardDialog.showModal();
}

async function saveWhiteboard(e) {
  e.preventDefault();
  if (!state.workspace) {
    return showError("No workspace loaded.", new Error("Sign out and back in, then try again."));
  }
  const id = ui.whiteboardId.value;
  const text = ui.whiteboardText.value.trim();
  if (!text) {
    alert("Please enter some text for the priority.");
    return;
  }
  const payload = { text, pinned: ui.whiteboardPinned.checked };
  try {
    if (id) {
      unwrap(await supabase.from("whiteboard_items").update(payload).eq("id", id), "Save priority");
    } else {
      unwrap(await supabase.from("whiteboard_items").insert({
        ...payload,
        workspace_id: state.workspace.id,
        created_by: state.user.id
      }).select().single(), "Save priority");
    }
    ui.whiteboardDialog.close();
    await loadWhiteboard();
    renderWhiteboard();
  } catch (err) {
    showError("Could not save the priority.", err);
  }
}

// ====================================================
// BACKLOG
// ====================================================

async function loadBacklog() {
  const { data, error } = await supabase
    .from("backlog_items")
    .select("*")
    .eq("workspace_id", state.workspace.id)
    .order("status", { ascending: true })
    .order("rank", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return; }
  state.backlog = data || [];
}

function filterBacklog(items, filters) {
  return items.filter(i => {
    if (filters.category !== "all" && i.category !== filters.category) return false;
    if (filters.zone !== "all" && (i.zone || "") !== filters.zone) return false;
    if (filters.status === "open") { if (i.status !== "open") return false; }
    else if (filters.status === "done") { if (i.status !== "done") return false; }
    else if (filters.status === "open_in_progress") { if (i.status === "done") return false; }
    return true;
  });
}

function currentBacklogFilters() {
  return {
    category: ui.backlogCategoryFilter.value,
    zone: ui.backlogZoneFilter.value,
    status: ui.backlogStatusFilter.value
  };
}

function renderBacklog() {
  renderBacklogList(ui.backlogList, currentBacklogFilters(), false);
  renderBacklogList(ui.todayBacklog, { category: "all", zone: "all", status: "open_in_progress" }, true);
}

function renderBacklogList(el, filters, compact) {
  el.innerHTML = "";
  const items = filterBacklog(state.backlog, filters);
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = compact ? "Nothing queued." : "No items match these filters.";
    el.appendChild(li);
    return;
  }
  const topN = compact ? items.slice(0, 5) : items;
  topN.forEach(item => {
    const li = document.createElement("li");
    li.className = "backlog-item" + (item.status === "done" ? " done" : "");
    const zoneLabel = item.zone ? `<span class="badge zone-${escapeHtml(item.zone)}">${escapeHtml(item.zone)}</span>` : "";
    const actions = compact
      ? ""
      : `<div class="actions">
          <button class="mini-btn" data-action="status" data-id="${item.id}">${nextStatusLabel(item.status)}</button>
          <button class="mini-btn" data-action="edit" data-id="${item.id}">✎</button>
          <button class="mini-btn" data-action="delete" data-id="${item.id}">✕</button>
        </div>`;
    li.innerHTML = `
      <div class="title">${escapeHtml(item.title)}</div>
      <div class="meta">
        <span class="badge category-${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
        ${zoneLabel}
        <span class="badge status-${escapeHtml(item.status)}">${escapeHtml(item.status.replace("_", " "))}</span>
      </div>
      ${item.notes ? `<div class="notes">${escapeHtml(item.notes)}</div>` : ""}
      ${actions}
    `;
    el.appendChild(li);
  });
  if (!compact) {
    el.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", onBacklogAction));
  }
}

function nextStatusLabel(s) {
  return s === "open" ? "▶ Start" : s === "in_progress" ? "✓ Done" : "↺ Reopen";
}

async function onBacklogAction(e) {
  const id = e.currentTarget.dataset.id;
  const action = e.currentTarget.dataset.action;
  const item = state.backlog.find(i => i.id === id);
  if (!item) return;

  try {
    if (action === "status") {
      const next = item.status === "open" ? "in_progress" : item.status === "in_progress" ? "done" : "open";
      const update = { status: next };
      if (next === "done") {
        update.completed_at = new Date().toISOString();
        update.completed_by = state.user.id;
      } else {
        update.completed_at = null;
        update.completed_by = null;
      }
      unwrap(await supabase.from("backlog_items").update(update).eq("id", id), "Update item");
    } else if (action === "delete") {
      if (!confirm("Remove this backlog item?")) return;
      unwrap(await supabase.from("backlog_items").delete().eq("id", id), "Delete item");
    } else if (action === "edit") {
      openBacklogDialog(item);
      return;
    }
    await loadBacklog();
    renderBacklog();
  } catch (err) {
    showError("Could not update the backlog item.", err);
  }
}

function openBacklogDialog(item) {
  ui.backlogDialogTitle.textContent = item ? "Edit item" : "Add backlog item";
  ui.backlogId.value = item?.id || "";
  ui.backlogTitle.value = item?.title || "";
  ui.backlogCategory.value = item?.category || "maintenance";
  ui.backlogZone.value = item?.zone || "";
  ui.backlogNotes.value = item?.notes || "";
  ui.backlogStatus.value = item?.status || "open";
  ui.backlogDialog.showModal();
}

async function saveBacklog(e) {
  e.preventDefault();
  if (!state.workspace) {
    return showError("No workspace loaded.", new Error("Sign out and back in, then try again."));
  }
  const id = ui.backlogId.value;
  const title = ui.backlogTitle.value.trim();
  if (!title) {
    alert("Please enter a title.");
    return;
  }
  const payload = {
    title,
    category: ui.backlogCategory.value,
    zone: ui.backlogZone.value || null,
    notes: ui.backlogNotes.value.trim() || null,
    status: ui.backlogStatus.value
  };
  try {
    if (id) {
      unwrap(await supabase.from("backlog_items").update(payload).eq("id", id), "Save item");
    } else {
      unwrap(await supabase.from("backlog_items").insert({
        ...payload,
        workspace_id: state.workspace.id,
        created_by: state.user.id
      }).select().single(), "Save item");
    }
    ui.backlogDialog.close();
    await loadBacklog();
    renderBacklog();
  } catch (err) {
    showError("Could not save the backlog item.", err);
  }
}

// ====================================================
// TODAY VIEW
// ====================================================

function renderToday() {
  const day = dayOfWeekShort();
  const dateText = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric"
  });
  ui.todayTitle.textContent = day === "Mon" ? "Monday — Garden focus"
    : day === "Wed" ? "Wednesday — Animals + stand prep"
    : day === "Fri" ? "Friday — Farm stand day"
    : `${day} — Daily coverage`;
  ui.todaySubtitle.textContent = dateText;

  const dayBody = ui.daySpecificBody;
  ui.fridayOnly.hidden = (day !== "Fri");
  if (day === "Mon") {
    ui.daySpecificTitle.textContent = "Monday focus (9:30–11:30)";
    dayBody.innerHTML = `
      <ol>
        <li><strong>Open MyGardenCoach</strong> → follow today's task list in priority order.</li>
        <li>Work through coach tasks until 11:30.</li>
        <li>Time remaining → pull from <em>Backlog</em> (maintenance/garden).</li>
        <li>If something in the coach doesn't match reality (soil too wet, no crop, etc.), log it and skip.</li>
      </ol>
    `;
  } else if (day === "Wed") {
    ui.daySpecificTitle.textContent = "Wednesday focus (9:30–11:30)";
    dayBody.innerHTML = `
      <ul>
        <li><strong>Deep animal task (rotate weekly):</strong>
          <ul>
            <li>Week 1: clean chicken coop (bedding refresh)</li>
            <li>Week 2: clean duck house + scrub duck water buckets</li>
            <li>Week 3: nest boxes + roosts, cobweb down</li>
            <li>Week 4: feed storage audit + pest check</li>
          </ul>
        </li>
        <li><strong>Kitchen/stand prep</strong> when Stephanie needs it.</li>
        <li>Otherwise: check MyGardenCoach, then pull from <em>Backlog</em>.</li>
      </ul>
    `;
  } else if (day === "Fri") {
    ui.daySpecificTitle.textContent = "Friday farm stand (self-serve)";
    dayBody.innerHTML = `
      <ol>
        <li><strong>8:15–9:30</strong> Harvest + pack eggs (check MyGardenCoach for harvest items).</li>
        <li><strong>9:30–10:30</strong> Bake-goods stage + label + price.</li>
        <li><strong>10:30–11:30</strong> Haul to stand, set up, signage.</li>
        <li><strong>11:30–11:45</strong> Open the stand + post to Facebook.</li>
        <li><strong>11:45–12:00</strong> Wrap-up log. Stand is self-serve — you leave at 12.</li>
      </ol>
    `;
  } else {
    ui.daySpecificTitle.textContent = "Daily coverage";
    dayBody.innerHTML = `
      <p>Complete the arrival loop, daily core chores, egg counts, evening coop close check, and wrap-up log so the household has a record for today.</p>
      <p>After daily care is covered, use the priority whiteboard or backlog to choose any extra work.</p>
    `;
  }
}

async function saveShiftLog() {
  if (!state.workspace) return;
  setStatus(ui.saveLogStatus, "Saving…");
  const day = dayOfWeekShort();
  const payload = {
    workspace_id: state.workspace.id,
    assistant_user_id: state.user.id,
    assistant_name: state.membership?.display_name || state.user.email,
    shift_date: todayISO(),
    shift_day: day,
    hours_start: ui.logHoursStart.value || null,
    hours_end: ui.logHoursEnd.value || null,
    weather: ui.logWeather.value || null,
    egg_count_chicken: numOrNull(ui.eggChicken.value),
    egg_count_duck: numOrNull(ui.eggDuck.value),
    data: {
      focus: ui.logFocus.value,
      finished: ui.logFinished.value,
      partial: ui.logPartial.value,
      flags: ui.logFlags.value,
      supplies: ui.logSupplies.value,
      animals: ui.logAnimals.value,
      garden: ui.logGarden.value,
      questions: ui.logQuestions.value,
      next_shift: ui.logNext.value,
      friday: day === "Fri" ? {
        stand_open: ui.logStandOpen.checked,
        fb_posted: ui.logFbPosted.checked,
        stand_inventory: ui.logStandInventory.value
      } : null
    }
  };

  const { error } = await supabase.from("shift_logs").insert(payload);
  if (error) return setStatus(ui.saveLogStatus, error.message, "error");
  setStatus(ui.saveLogStatus, "Saved.", "ok");
  clearLogForm();
  await loadLogs();
  renderLogs();
}

function numOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function clearLogForm() {
  [
    "logFocus","logFinished","logPartial","logFlags",
    "logSupplies","logAnimals","logGarden","logQuestions","logNext","logWeather",
    "logStandInventory"
  ].forEach(k => { if (ui[k]) ui[k].value = ""; });
  ui.eggChicken.value = "";
  ui.eggDuck.value = "";
  ui.logStandOpen.checked = false;
  ui.logFbPosted.checked = false;
  ui.logHoursStart.value = "";
  ui.logHoursEnd.value = "";
  document.querySelectorAll('.checklist input[type="checkbox"]').forEach(cb => { cb.checked = false; });
}

// ====================================================
// LOGS VIEW
// ====================================================

async function loadLogs(filters) {
  let q = supabase
    .from("shift_logs")
    .select("*")
    .eq("workspace_id", state.workspace.id)
    .order("shift_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters?.from) q = q.gte("shift_date", filters.from);
  if (filters?.to) q = q.lte("shift_date", filters.to);
  const { data, error } = await q;
  if (error) { console.error(error); return; }
  state.logs = data || [];
}

function renderLogs() {
  ui.logList.innerHTML = "";
  if (!state.logs.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No logs yet.";
    ui.logList.appendChild(li);
    return;
  }
  state.logs.forEach(log => {
    const li = document.createElement("li");
    li.className = "log-card";
    const d = log.data || {};
    const flags = (d.flags || "").trim();
    const egg = `🥚 ${log.egg_count_chicken ?? 0} / 🦆 ${log.egg_count_duck ?? 0}`;
    li.innerHTML = `
      <div class="head">
        <span class="date">${escapeHtml(formatDate(log.shift_date))} — ${escapeHtml(log.shift_day || "")}</span>
        <span class="small">${escapeHtml(log.assistant_name || "")}</span>
      </div>
      <div class="summary">
        ${egg}
        ${log.weather ? ` · ${escapeHtml(log.weather)}` : ""}
        ${flags ? ` · <strong>⚠ flag:</strong> ${escapeHtml(flags.slice(0, 80))}${flags.length > 80 ? "…" : ""}` : ""}
      </div>
    `;
    li.addEventListener("click", () => openLogView(log));
    ui.logList.appendChild(li);
  });
}

function openLogView(log) {
  const d = log.data || {};
  const rows = [
    ["Date", formatDate(log.shift_date) + " · " + (log.shift_day || "")],
    ["Assistant", log.assistant_name || ""],
    ["Hours", (log.hours_start || "?") + " → " + (log.hours_end || "?")],
    ["Weather", log.weather || "—"],
    ["Eggs", `Chicken ${log.egg_count_chicken ?? 0} · Duck ${log.egg_count_duck ?? 0}`],
    ["Focus", d.focus],
    ["Finished", d.finished],
    ["Partial / follow-up", d.partial],
    ["Flags", d.flags],
    ["Supplies low", d.supplies],
    ["Animal notes", d.animals],
    ["Garden notes", d.garden],
    ["Questions", d.questions],
    ["Next shift", d.next_shift]
  ];
  if (d.friday) {
    rows.push(["Friday — stand open", d.friday.stand_open ? "yes" : "no"]);
    rows.push(["Friday — FB posted", d.friday.fb_posted ? "yes" : "no"]);
    rows.push(["Friday — inventory", d.friday.stand_inventory]);
  }
  ui.logViewContent.innerHTML = `
    <h3>Shift log · ${escapeHtml(formatDate(log.shift_date))}</h3>
    <dl>
      ${rows.filter(r => r[1]).map(r => `
        <dt style="font-weight:600;margin-top:0.6em">${escapeHtml(r[0])}</dt>
        <dd style="margin:0 0 0 0;white-space:pre-wrap">${escapeHtml(r[1])}</dd>
      `).join("")}
    </dl>
  `;
  ui.logViewDialog.showModal();
}

function exportLogsCSV() {
  if (!state.logs.length) return;
  const headers = [
    "shift_date","shift_day","assistant_name","hours_start","hours_end","weather",
    "egg_count_chicken","egg_count_duck",
    "focus","finished","partial","flags","supplies","animals","garden","questions","next_shift",
    "friday_stand_open","friday_fb_posted","friday_stand_inventory"
  ];
  const rows = state.logs.map(l => {
    const d = l.data || {};
    const f = d.friday || {};
    return [
      l.shift_date, l.shift_day, l.assistant_name, l.hours_start, l.hours_end, l.weather,
      l.egg_count_chicken ?? "", l.egg_count_duck ?? "",
      d.focus, d.finished, d.partial, d.flags, d.supplies, d.animals, d.garden, d.questions, d.next_shift,
      f.stand_open === undefined ? "" : (f.stand_open ? "yes" : "no"),
      f.fb_posted === undefined ? "" : (f.fb_posted ? "yes" : "no"),
      f.stand_inventory || ""
    ].map(csvCell).join(",");
  });
  const csv = headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `homestead-ops-logs-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ====================================================
// REFERENCE
// ====================================================

async function renderReference(doc) {
  state.referenceDoc = doc;
  document.querySelectorAll(".ref-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.ref === doc);
  });
  if (!state.referenceCache[doc]) {
    ui.referenceContent.innerHTML = '<p class="small">Loading…</p>';
    try {
      const res = await fetch(`./reference/${doc}.md`);
      const md = await res.text();
      state.referenceCache[doc] = marked.parse(md);
    } catch (e) {
      state.referenceCache[doc] = `<p class="small">Could not load ${escapeHtml(doc)}.md</p>`;
    }
  }
  ui.referenceContent.innerHTML = state.referenceCache[doc];
}

async function loadSeasonalInBacklog() {
  if (!ui.seasonalContent) return;
  try {
    const res = await fetch("./reference/seasonal.md");
    if (!res.ok) throw new Error("missing");
    const md = await res.text();
    ui.seasonalContent.innerHTML = marked.parse(md);
  } catch {
    ui.seasonalContent.innerHTML = '<p class="small">Seasonal reference not available.</p>';
  }
}

// ====================================================
// NAVIGATION
// ====================================================

function switchView(name) {
  state.currentView = name;
  document.querySelectorAll(".view").forEach(v => {
    v.hidden = v.id !== `view-${name}`;
  });
  document.querySelectorAll(".tabbar .tab").forEach(t => {
    t.classList.toggle("active", t.dataset.nav === name);
  });
  window.scrollTo(0, 0);
}

// ====================================================
// EVENT WIRING
// ====================================================

function wire() {
  // Auth
  ui.authSignin.addEventListener("click", signIn);
  ui.authSignup.addEventListener("click", signUp);
  ui.authMagic.addEventListener("click", sendMagicLink);
  ui.signoutBtn.addEventListener("click", signOut);

  // Tabs
  document.querySelectorAll(".tabbar .tab, [data-nav]").forEach(el => {
    el.addEventListener("click", () => switchView(el.dataset.nav));
  });

  // Whiteboard
  ui.addWhiteboardBtn.addEventListener("click", () => openWhiteboardDialog(null));
  ui.whiteboardForm.addEventListener("submit", saveWhiteboard);
  ui.whiteboardCancel.addEventListener("click", () => ui.whiteboardDialog.close());

  // Backlog
  ui.addBacklogBtn.addEventListener("click", () => openBacklogDialog(null));
  ui.backlogForm.addEventListener("submit", saveBacklog);
  ui.backlogCancel.addEventListener("click", () => ui.backlogDialog.close());
  [ui.backlogCategoryFilter, ui.backlogZoneFilter, ui.backlogStatusFilter].forEach(el => {
    el.addEventListener("change", () => renderBacklogList(ui.backlogList, currentBacklogFilters(), false));
  });

  // Logs
  ui.saveLogBtn.addEventListener("click", saveShiftLog);
  ui.exportLogsBtn.addEventListener("click", exportLogsCSV);
  ui.logFilterApply.addEventListener("click", async () => {
    await loadLogs({ from: ui.logFilterFrom.value || null, to: ui.logFilterTo.value || null });
    renderLogs();
  });
  ui.logFilterClear.addEventListener("click", async () => {
    ui.logFilterFrom.value = "";
    ui.logFilterTo.value = "";
    await loadLogs();
    renderLogs();
  });
  ui.logViewClose.addEventListener("click", () => ui.logViewDialog.close());

  // Reference tabs
  document.querySelectorAll(".ref-tab").forEach(b => {
    b.addEventListener("click", () => renderReference(b.dataset.ref));
  });

  // Settings
  ui.saveWorkspaceBtn.addEventListener("click", saveWorkspaceName);
  ui.inviteBtn.addEventListener("click", addMember);
  if (ui.workspaceSwitcher) {
    ui.workspaceSwitcher.addEventListener("change", (e) => switchWorkspace(e.target.value));
  }

  if (ui.retryWorkspaceBtn) {
    ui.retryWorkspaceBtn.addEventListener("click", async () => {
      if (!state.user) return;
      hideWorkspaceError();
      await onSignedIn();
    });
  }

  // Enter in password field = sign in
  ui.authPassword.addEventListener("keypress", (e) => {
    if (e.key === "Enter") signIn();
  });
}

wire();
applyQuickLinks();
handleAuthSession();

// Set quick-link hrefs from config immediately at boot, independent of auth state.
// This avoids href="#" + target="_blank" opening a new tab of this same app.
function applyQuickLinks() {
  if (ui.linkGardenCoach) {
    if (LINKS.myGardenCoach) {
      ui.linkGardenCoach.href = LINKS.myGardenCoach;
    } else {
      ui.linkGardenCoach.removeAttribute("href");
      ui.linkGardenCoach.style.opacity = "0.5";
      ui.linkGardenCoach.title = "Set LINKS.myGardenCoach in app-config.js";
    }
  }
  if (ui.linkFacebook) {
    if (LINKS.farmStandFacebook) {
      ui.linkFacebook.href = LINKS.farmStandFacebook;
      ui.linkFacebook.hidden = false;
    } else {
      ui.linkFacebook.hidden = true;
    }
  }
}
