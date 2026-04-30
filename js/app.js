// APP Tracker v35 — base64 for task files (no Storage auth needed)
import {
  createProject, updateProject, deleteProject, subscribeProjects,
  getSpaceTypes, saveSpaceTypes, pushNotification,
  subscribeNotifications, markNotifRead, clearNotifications,
  subscribeSpaceConfigs, subscribeCustomSpaces, setPresence, subscribePresence, getAllUsers,
  getSpaceConfig,
  db, ref, set as fbSet, update as fbUpdate, remove as fbRemove
} from "./firebase.js";
import { notifyUser } from "./notify.js";
import { uploadChecklistFile, deleteStorageFile } from "./storage.js";
import {
  SPACES, BASE_SPACES, DEFAULT_USERS, STATUS_LIST, statusClass, priorityClass, PRIORITY_LEVELS,
  formatDate, timeAgo, authGuard, getCurrentSpace, setCurrentSpace,
  setupSidebar, setupNotifBadge, initTheme, updateThemeBtn, toggleTheme,
  mergeSpaceConfig, mergeCustomSpaces,
  isAdminUser, loadAdminStatus,
  cacheSpaces, cacheUsers, getCachedUsers
} from "./helpers.js";
import { renderSidebar, renderBottomNav } from "./sidebar.js";

const CURRENT_USER = authGuard();
if (!CURRENT_USER) throw new Error("not auth");
const u_obj = DEFAULT_USERS[CURRENT_USER] || { name: CURRENT_USER, av: "?", cls: "av-jc" };

// ALL_USERS — merged DEFAULT_USERS + Firebase users, used for @mentions
// Pre-populated from localStorage so @mentions work instantly on load
let ALL_USERS = { ...DEFAULT_USERS, ...(getCachedUsers() || {}) };

document.getElementById("appShell").insertAdjacentHTML("afterbegin", renderSidebar("dashboard", getCurrentSpace(), SPACES));
document.querySelector(".main")?.insertAdjacentHTML("beforeend", renderBottomNav("dashboard"));
setupSidebar(CURRENT_USER);
setupNotifBadge(CURRENT_USER);
initTheme(); updateThemeBtn(localStorage.getItem("theme") || "light");

const SPACE_COLORS = { all:"#3b7dd8", email:"#7c5cbf", pdf:"#2aab6f", prints:"#e0694a" };

// ── Link helpers ──────────────────────────────────────────────────────────
function detectLinkType(name, url) {
  const n = (name || "").toLowerCase();
  const u = (url  || "").toLowerCase();
  if (n.includes("email") || n.includes("newsletter") || n.includes("campaign") ||
      u.includes("mailchimp") || u.includes("klaviyo") || u.includes("leadconnector") ||
      u.includes("activecampaign") || u.includes("hubspot") || u.includes("sendinblue") ||
      u.includes("backend.lead") || u.includes("emails/schedule") || u.includes("emails/preview"))
    return { type:"email",   label:"Email Design", icon:"✉",  cls:"link-pill-email" };
  if (n.includes("canva") || u.includes("canva.com"))
    return { type:"canva",   label:"Canva",        icon:"🎨", cls:"link-pill-canva" };
  if (n.includes("image") || n.includes("photo") || n.includes("png") || n.includes("jpg") ||
      u.match(/\.(png|jpg|jpeg|gif|webp|svg)/))
    return { type:"image",   label:"Image",        icon:"🖼", cls:"link-pill-image" };
  if (n.includes("doc") || n.includes("pdf") || n.includes("sheet") || n.includes("slide") ||
      u.includes("drive.google") || u.includes("docs.google") || u.includes("dropbox"))
    return { type:"file",    label:"File",         icon:"📄", cls:"link-pill-file" };
  return   { type:"website", label:"Website",      icon:"🔗", cls:"link-pill-website" };
}

function renderLinkPills(links) {
  if (!links || !links.length) return "";
  return `<div class="link-pills">${links.map(l => {
    const { icon, cls, label } = detectLinkType(l.name, l.url);
    const displayName = l.name || label;
    return `<a class="link-pill ${cls}" href="${l.url}" target="_blank" rel="noopener"
              onclick="event.stopPropagation()" title="${l.name}: ${l.url}">
      <span class="lp-icon">${icon}</span>
      <span class="lp-label">${displayName}</span>
    </a>`;
  }).join("")}</div>`;
}

// Legacy single-link compat: convert old designLink to links array
function normaliseLinkData(p) {
  if (p.links && p.links.length) return p.links;
  if (p.designLink) return [{ name:"Email Design", url:p.designLink }];
  return [];
}

// Modal link editor state
let _modalLinks = [];

window.addLinkRow = function() {
  const nameEl = document.getElementById("newLinkName");
  const urlEl  = document.getElementById("newLinkUrl");
  const name   = nameEl?.value.trim();
  const url    = urlEl?.value.trim();
  if (!url) return;
  _modalLinks.push({ name: name || "Link", url });
  nameEl.value = ""; urlEl.value = "";
  renderLinkEditor();
  urlEl.focus();
};

window.removeLinkRow = function(idx) {
  _modalLinks.splice(idx, 1);
  renderLinkEditor();
};

function renderLinkEditor() {
  const list = document.getElementById("linkEditorList"); if (!list) return;
  list.innerHTML = _modalLinks.map((l, i) => {
    const { icon, cls } = detectLinkType(l.name, l.url);
    return `<div class="link-editor-row">
      <span style="font-size:16px;flex-shrink:0">${icon}</span>
      <input class="link-editor-name" type="text" value="${l.name}" placeholder="Name"
        oninput="_modalLinks[${i}].name=this.value;updateLinkIcon(${i})"/>
      <input class="link-editor-url" type="url" value="${l.url}" placeholder="URL"
        oninput="_modalLinks[${i}].url=this.value"/>
      <button class="link-del-btn" onclick="removeLinkRow(${i})">×</button>
    </div>`;
  }).join("");
}

window.updateLinkIcon = function(idx) {
  // Re-render to update icon after name change
  renderLinkEditor();
};

const projectsBySpace = { email:[], pdf:[], prints:[] }; // custom spaces added dynamically
let notifications   = [];
let editingId       = null;
let activeFilter    = "all";
let completedOpen   = false;
let dragSrcId       = null;
let spaceTypes      = [];
let pendingFiles    = [];   // array of { file, name, type, size }
let removedFilePaths = []; // Storage paths to delete on save
let chartInstance   = null;
let chartMode       = "stage";

// ── Helpers ────────────────────────────────────────────────────────────────
function allProjects() { return Object.values(projectsBySpace).flat(); }
function currentProjects() {
  const s = getCurrentSpace();
  return s === "all" ? allProjects() : projectsBySpace[s] || [];
}

// ── Space switching ────────────────────────────────────────────────────────
window.openAddSpaceModal = () => { location.href = "space-settings.html"; };

// ── Notes @mention autocomplete ───────────────────────────────────────────
let _notesMentionStart = -1;
let _notesMentionIdx   = 0;

window.handleNotesMention = function(e) {
  const ta   = e.target;
  const val  = ta.value;
  const pos  = ta.selectionStart;
  const before = val.slice(0, pos);
  const atIdx  = before.lastIndexOf("@");
  const popup  = document.getElementById("notesMentionPopup");
  if (!popup) return;

  if (atIdx !== -1 && (atIdx === 0 || /\s/.test(before[atIdx-1]))) {
    const query  = before.slice(atIdx + 1).toLowerCase();
    _notesMentionStart = atIdx;
    const matches = Object.entries(ALL_USERS).filter(([uid, u]) => {
      const name = (u.name || uid).toLowerCase();
      return query === "" || name.includes(query) || uid.includes(query);
    });
    if (!matches.length) { popup.style.display = "none"; return; }
    _notesMentionIdx = 0;
    popup.innerHTML = matches.map(([uid, u], i) => `
      <div class="mention-item ${i===0?"active":""}" data-uid="${uid}" onclick="insertNotesMention('${uid}')">
        <div class="av av-sm ${u.cls||'av-jc'}">${u.av||uid.slice(0,2).toUpperCase()}</div>
        <div><div class="mention-name">${u.name||uid}</div><div class="mention-role">${u.role||'Team member'}</div></div>
      </div>`).join("");
    popup.style.display = "block";
  } else {
    popup.style.display = "none";
  }
};

window.handleNotesMentionKey = function(e) {
  const popup = document.getElementById("notesMentionPopup");
  if (!popup || popup.style.display === "none") return;
  const items = popup.querySelectorAll(".mention-item");
  if (e.key === "ArrowDown") { e.preventDefault(); _notesMentionIdx = (_notesMentionIdx+1)%items.length; items.forEach((el,i)=>el.classList.toggle("active",i===_notesMentionIdx)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); _notesMentionIdx = (_notesMentionIdx-1+items.length)%items.length; items.forEach((el,i)=>el.classList.toggle("active",i===_notesMentionIdx)); }
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); popup.querySelector(".mention-item.active")?.click(); }
  else if (e.key === "Escape") { popup.style.display = "none"; }
};

window.insertNotesMention = function(uid) {
  const ta   = document.getElementById("f-notes"); if (!ta) return;
  const val  = ta.value;
  const pos  = ta.selectionStart;
  const u    = ALL_USERS[uid] || { name: uid };
  const before = val.slice(0, _notesMentionStart);
  const after  = val.slice(pos);
  ta.value   = before + "@" + uid + " " + after;
  const newPos = (before + "@" + uid + " ").length;
  ta.setSelectionRange(newPos, newPos);
  ta.focus();
  const popup = document.getElementById("notesMentionPopup");
  if (popup) popup.style.display = "none";
};

// Helper: extract @mentions from text
function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@(\w+)/g) || [];
  return [...new Set(matches.map(m => m.slice(1)).filter(uid => DEFAULT_USERS[uid] || uid))];
}

window.switchSpace = async function(spaceId) {
  setCurrentSpace(spaceId);
  // Re-render sidebar with new active space
  document.getElementById("sidebar").outerHTML;
  const sidebar = document.getElementById("sidebar");
  sidebar.outerHTML = renderSidebar("dashboard", spaceId, SPACES);
  // Re-attach sidebar close overlay
  document.getElementById("sidebarOverlay").onclick = closeSidebar;
  setupSidebar(CURRENT_USER);

  updateSpaceBanner();
  await loadSpaceTypes();
  buildTypeButtons();
  buildStageDropdown();
  buildFilterButtons();
  renderAll();
};

// Re-render just the sidebar without a full page reload
function fvRefreshSidebar() {
  const sidebarEl = document.getElementById("sidebar");
  if (!sidebarEl) return;
  const currentSpace = getCurrentSpace();
  const newHtml = renderSidebar("dashboard", currentSpace, SPACES);
  sidebarEl.outerHTML = newHtml;
  document.getElementById("sidebarOverlay").onclick = closeSidebar;
  setupSidebar(CURRENT_USER);
}

function updateSpaceBanner() {
  const s    = getCurrentSpace();
  const hr   = new Date().getHours();
  const greet = hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
  document.getElementById("topGreeting").textContent = `${greet}, ${u_obj.name}`;
  const labelEl = document.getElementById("spaceLabel");
  if (!labelEl) return;
  if (s === "all") {
    labelEl.innerHTML = `<span class="space-banner space-banner-all">All spaces</span>`;
  } else {
    const info = SPACES[s];
    if (!info) return;
    labelEl.innerHTML = `<span class="space-banner space-banner-${s}" style="background:${SPACE_COLORS[s]||'#7c5cbf'}22;color:${SPACE_COLORS[s]||'#7c5cbf'}">${info.label} Space</span>`;
  }
}

async function loadSpaceTypes() {
  const s = getCurrentSpace();
  if (s === "all") { spaceTypes = ["Newsletter","Blog","Case Study","Report","eBook","Book"]; return; }
  const def    = SPACES[s]?.defaultTypes || ["Newsletter","Blog","Case Study"];
  const stored = await getSpaceTypes(s);
  spaceTypes = stored ? stored : [...def];
}

// ── Stage dropdown ─────────────────────────────────────────────────────────
function buildStageDropdown() {
  const sel = document.getElementById("f-stage");
  if (!sel) return;
  const s = getCurrentSpace();
  const stages = s === "all" ? SPACES.email.stages : (SPACES[s]?.stages || SPACES.email.stages);
  sel.innerHTML = stages.map(st =>
    `<option value="${st.id}">${st.id} — ${st.name} (${st.ownerLabel})</option>`
  ).join("");
}

// ── Type buttons ───────────────────────────────────────────────────────────
function typeBadgeClass(type) {
  const map = {
    Newsletter:"badge-news", Blog:"badge-blog", "Case Study":"badge-case",
    Report:"badge-rept", eBook:"badge-ebk", Presentation:"badge-pres",
    Book:"badge-book", Tarpaulin:"badge-tarp", Cards:"badge-card"
  };
  return map[type] || "badge-custom";
}

function buildTypeButtons() {
  const g = document.getElementById("typeGroup");
  if (!g) return;
  g.innerHTML = spaceTypes.map((t,i) =>
    `<button class="seg-btn ${i===0?"active":""}" data-val="${t}" onclick="setSeg(this,'typeGroup')">${t}</button>`
  ).join("") +
  `<button class="seg-btn" onclick="addCustomType()" title="Add custom type" style="font-size:16px;padding:5px 10px">+</button>`;
}

window.addCustomType = async function() {
  const name = prompt("New type name:");
  if (!name?.trim()) return;
  spaceTypes.push(name.trim());
  const s = getCurrentSpace();
  if (s !== "all") await saveSpaceTypes(s, spaceTypes);
  buildTypeButtons();
};

// ── Filter buttons ─────────────────────────────────────────────────────────
function buildFilterButtons() {
  const c = document.getElementById("boardControls");
  if (!c) return;
  const types = spaceTypes.map(t =>
    `<button class="filter-btn" onclick="setFilter(this,'type:${t}')">${t}</button>`
  ).join("");
  c.innerHTML = `
    <button class="filter-btn active" onclick="setFilter(this,'all')">All</button>
    <button class="filter-btn" onclick="setFilter(this,'mine')">My tasks</button>
    <button class="filter-btn" onclick="setFilter(this,'overdue')">Overdue</button>
    ${types}`;
}

window.setFilter = function(btn, filter) {
  activeFilter = filter;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderBoard();
};

function filteredProjects() {
  const today = new Date(); today.setHours(0,0,0,0);
  const s     = getCurrentSpace();
  let base    = s === "all" ? allProjects() : projectsBySpace[s] || [];
  base = base.filter(p => p.status !== "Published");
  if (activeFilter === "mine") {
    return base.filter(p => {
      const sp = SPACES[p.space || "email"];
      return sp?.stages.find(st => st.id === Number(p.stage))?.owner === CURRENT_USER;
    });
  }
  if (activeFilter === "overdue") return base.filter(p => p.due && new Date(p.due+"T00:00:00") < today);
  if (activeFilter.startsWith("type:")) return base.filter(p => p.type === activeFilter.slice(5));
  return base;
}

// ── Space quick overview ───────────────────────────────────────────────────
function renderSpaceQuickOverview() {
  const el = document.getElementById("spaceQuickOverview"); if (!el) return;
  const s  = getCurrentSpace();
  if (s === "all") { el.innerHTML = ""; return; }
  const sp      = SPACES[s] || BASE_SPACES[s]; if (!sp) return;
  const active  = (projectsBySpace[s]||[]).filter(p => p.status !== "Published");
  const today   = new Date(); today.setHours(0,0,0,0);
  const overdue = active.filter(p => p.due && new Date(p.due+"T00:00:00") < today).length;
  const high    = active.filter(p => p.priority === "High").length;

  el.innerHTML = `
    <div class="space-quick-overview" style="border-left:3px solid ${SPACE_COLORS[s] || sp.color || '#7c5cbf'}">
      <div class="spo-header">
        <div class="spo-title">
          <span style="display:inline-flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${SPACE_COLORS[s]||sp.color||'#7c5cbf'}"></span>
            ${sp.label} Space —
            <span style="font-weight:400;color:var(--text-2)">${active.length} active${overdue>0?` · <span style="color:var(--rev-fg)">${overdue} overdue</span>`:""}${high>0?` · <span style="color:#a32d2d">🔴 ${high} high priority</span>`:""}</span>
          </span>
        </div>
      </div>
      <div class="spo-stages">
        ${(sp.stages||[]).map(st => {
          const cnt = active.filter(p => Number(p.stage) === st.id).length;
          return `<div class="spo-stage ${cnt>0?"has-items":""}"><span style="font-size:10px;color:var(--text-3)">${st.name.split(" ")[0]}</span><span class="spo-stage-count" style="${cnt>0?"color:var(--text-1)":"color:var(--text-3)"}">${cnt}</span></div>`;
        }).join("")}
      </div>
    </div>`;
}

// ── Updated renderAll ──────────────────────────────────────────────────────
let _renderAllTimer = null;
function renderAll() {
  if (_renderAllTimer) cancelAnimationFrame(_renderAllTimer);
  _renderAllTimer = requestAnimationFrame(() => {
    _renderAllTimer = null;
    const s = getCurrentSpace();
    if (s === "all") {
      renderAllSpacesDashboard();
    } else {
      renderSpaceQuickOverview();
      renderBoard();
      renderStats();
      renderChart();
    }
  });
}

// ── ALL SPACES dashboard ───────────────────────────────────────────────────
function renderAllSpacesDashboard() {
  const board = document.getElementById("board");
  const stats = document.getElementById("statsGrid");
  const chart = document.getElementById("chartSection");
  const controls = document.getElementById("boardControls");

  // Hide board controls and chart, show overview cards
  if (controls) controls.style.display = "none";
  if (chart)    chart.style.display    = "none";

  // Stats across all spaces
  const ap    = allProjects();
  const today = new Date(); today.setHours(0,0,0,0);
  const active  = ap.filter(p => p.status !== "Published");
  const mine    = active.filter(p => {
    const sp = SPACES[p.space || "email"];
    return sp?.stages.find(st => st.id === Number(p.stage))?.owner === CURRENT_USER;
  }).length;
  const pub     = ap.filter(p => p.status === "Published").length;
  const overdue = active.filter(p => p.due && new Date(p.due+"T00:00:00") < today).length;
  if (stats) stats.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total active</div><div class="stat-val">${active.length}</div></div>
    <div class="stat-card"><div class="stat-label">My tasks</div><div class="stat-val">${mine}</div></div>
    <div class="stat-card"><div class="stat-label">Published</div><div class="stat-val">${pub}</div></div>
    <div class="stat-card"><div class="stat-label">Overdue</div><div class="stat-val" style="${overdue>0?"color:var(--rev-fg)":""}">${overdue}</div></div>`;

  // Space overview cards
  if (board) {
    board.className = "space-overview-grid";
    board.style.minWidth = "unset";
    // Include all spaces (base + custom)
    const spaces = Object.keys(SPACES).filter(sid => SPACES[sid]?.stages);
    board.innerHTML = spaces.map(sid => {
      const sp      = SPACES[sid];
      if (!sp) return "";
      const sproj   = projectsBySpace[sid] || [];
      const sactive = sproj.filter(p => p.status !== "Published");
      const smine   = sactive.filter(p => sp.stages.find(st => st.id===Number(p.stage))?.owner===CURRENT_USER).length;
      const spub    = sproj.filter(p => p.status==="Published").length;
      const sod     = sactive.filter(p => p.due && new Date(p.due+"T00:00:00") < today).length;
      const spColor = sp.color || SPACE_COLORS[sid] || '#7c5cbf';
      return `
        <div class="space-overview-card" onclick="switchSpace('${sid}')">
          <div class="space-overview-header">
            <div class="space-overview-dot" style="background:${spColor}"></div>
            <div class="space-overview-name">${sp.label} Space</div>
            <div style="margin-left:auto;font-size:11px;color:var(--text-3)">${sactive.length} active</div>
          </div>
          <div class="space-overview-stats">
            <div class="space-ov-stat">
              <div class="space-ov-val" style="color:${spColor}">${sactive.length}</div>
              <div class="space-ov-label">Active</div>
            </div>
            <div class="space-ov-stat">
              <div class="space-ov-val">${smine}</div>
              <div class="space-ov-label">Mine</div>
            </div>
            <div class="space-ov-stat">
              <div class="space-ov-val" style="${sod>0?"color:var(--rev-fg)":""}">${sod}</div>
              <div class="space-ov-label">Overdue</div>
            </div>
          </div>
          <div style="margin-top:10px;font-size:11px;color:var(--text-3);display:flex;gap:10px">
            ${sp.stages.slice(0,4).map(st => {
              const cnt = sactive.filter(p => Number(p.stage)===st.id).length;
              return `<span>${st.name.split(" ")[0]}: <strong style="color:var(--text-1)">${cnt}</strong></span>`;
            }).join("")}
          </div>
          <div style="margin-top:10px;text-align:right;font-size:12px;color:${spColor};font-weight:500">Open space →</div>
        </div>`;
    }).join("");
  }
  renderCompleted();
}

// ── Board render ───────────────────────────────────────────────────────────
function renderBoard() {
  const board = document.getElementById("board");
  if (!board) return;
  const controls = document.getElementById("boardControls");
  const chart    = document.getElementById("chartSection");
  if (controls) controls.style.display = "";
  if (chart)    chart.style.display    = "";

  board.className = "board board-7";
  board.style.minWidth = window.innerWidth <= 768 ? "unset" : "1700px";
  board.style.willChange = "contents";
  board.innerHTML = "";

  const today  = new Date(); today.setHours(0,0,0,0);
  const s      = getCurrentSpace();
  const stages = s === "all" ? SPACES.email.stages : (SPACES[s]?.stages || SPACES.email.stages);
  const visible = filteredProjects();

  stages.forEach(stage => {
    const projects  = visible.filter(p => Number(p.stage) === stage.id);
    const isMyStage = stage.owner === CURRENT_USER;
    const col = document.createElement("div");
    col.className = `stage-col ${stage.key}`;
    col.innerHTML = `
      <div class="stage-head">
        <div>
          <div class="stage-step">Step ${stage.id}</div>
          <div class="stage-name">${stage.name}</div>
          <div class="stage-owner">${
            stage.ownersLabel && stage.ownersLabel.length > 1
              ? stage.ownersLabel.join(' · ')
              : stage.ownerLabel
          }</div>
        </div>
        <span class="stage-count">${projects.length}</span>
      </div>
      <div class="tasks-area" id="col-${stage.id}" data-stage="${stage.id}"></div>
      <button class="add-task-btn" onclick="openNewProject(${stage.id})">+ Add project</button>`;
    board.appendChild(col);
    const area = col.querySelector(`#col-${stage.id}`);
    setupDropZone(area, stage.id);
    if (!projects.length) { area.innerHTML = `<div class="empty-col">Empty</div>`; }
    else {
      const frag = document.createDocumentFragment();
      projects.forEach(p => buildCard(p, frag, stage, today));
      area.appendChild(frag);
    }
  });
  renderCompleted();
}

function buildCard(p, area, stage, today) {
  const isMine = stage.owner === CURRENT_USER;
  let dueBadge = "";
  if (p.due) {
    const dd = new Date(p.due+"T00:00:00"); const diff = Math.round((dd-today)/86400000);
    if (diff < 0) dueBadge = `<span class="badge badge-overdue">Overdue ${Math.abs(diff)}d</span>`;
    else if (diff <= 2) dueBadge = `<span class="badge badge-due">Due ${diff}d</span>`;
  }
  const checklist = p.checklist ? Object.values(p.checklist) : [];
  const done = checklist.filter(c => c.done).length;
  const filesAttached = checklist.filter(c => c.fileName).length;
  const checkBar = checklist.length ? `
    <div class="tc-checklist-bar">
      <div class="checklist-progress"><div class="checklist-progress-fill" style="width:${Math.round(done/checklist.length*100)}%"></div></div>
      <div class="checklist-count">${done}/${checklist.length}${filesAttached > 0 ? ` · <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style="vertical-align:middle"><path d="M2 1.5A.5.5 0 012.5 1h4l2 2v5.5a.5.5 0 01-.5.5h-6A.5.5 0 012 8.5v-7z" stroke="currentColor" stroke-width="1.2"/></svg> ${filesAttached}` : ""}</div>
    </div>` : "";
  const priorityBadge = p.priority ? `<span class="badge badge-priority-${p.priority.toLowerCase()}">${p.priority==="High"?"🔴":p.priority==="Medium"?"🟡":"🟢"} ${p.priority}</span>` : "";
  const spaceTag = getCurrentSpace() === "all" ? `<span class="badge badge-custom" style="font-size:9px">${p.space||"email"}</span>` : "";
  const cardLinks = normaliseLinkData(p);

  // Multi-file display on card — always show LATEST version thumbnail
  const projFiles = getProjectFiles(p);
  let fileSection = "";
  if (projFiles.length === 1) {
    const f    = projFiles[0];
    const src  = getSlotDisplaySrc(f);
    const type = getSlotDisplayType(f) || f.fileType;
    const vCount = f.versions ? (Array.isArray(f.versions) ? f.versions.length : Object.keys(f.versions).length) : 1;
    const vBadge = vCount > 1 ? `<span style="font-size:9px;background:var(--purple-dim);color:var(--purple);padding:1px 4px;border-radius:4px;flex-shrink:0">v${vCount}</span>` : "";
    if (type?.includes("image") && src) {
      fileSection = `<div class="tc-links" style="display:flex;align-items:center;gap:5px">
        <img src="${src}" onclick="event.stopPropagation();viewFile('${p.id}',0)" style="width:36px;height:36px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid var(--border)" title="${f.fileName}"/>
        ${vBadge}
      </div>`;
    } else {
      const icon = type?.includes("pdf") ? "📄" : "📝";
      fileSection = `<div class="tc-links" style="display:flex;align-items:center;gap:5px"><button class="tc-link" style="background:none;border:none;cursor:pointer" onclick="event.stopPropagation();viewFile('${p.id}',0)">${icon} ${f.fileName}</button>${vBadge}</div>`;
    }
  } else if (projFiles.length > 1) {
    const thumbs = projFiles.slice(0,3).map((f, i) => {
      const src  = getSlotDisplaySrc(f);
      const type = getSlotDisplayType(f) || f.fileType;
      if (type?.includes("image") && src) {
        return `<img src="${src}" onclick="event.stopPropagation();viewFile('${p.id}',${i})" style="width:36px;height:36px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid var(--border)" title="${f.fileName}"/>`;
      }
      const icon = type?.includes("pdf") ? "📄" : "📝";
      return `<span onclick="event.stopPropagation();viewFile('${p.id}',${i})" style="font-size:20px;cursor:pointer;line-height:1" title="${f.fileName}">${icon}</span>`;
    }).join("");
    const extra = projFiles.length > 3 ? `<span style="font-size:10px;color:var(--text-3);align-self:center">+${projFiles.length-3}</span>` : "";
    fileSection = `<div class="tc-links" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">${thumbs}${extra}</div>`;
  }

  const card = document.createElement("div");
  card.className = `task-card${isMine?" mine":""}`;
  card.draggable = true; card.dataset.id = p.id;
  card.innerHTML = `
    <div class="tc-top"><div class="tc-name">${p.name}</div><span style="color:var(--text-3);cursor:grab;font-size:14px">⠿</span></div>
    <div class="tc-meta">
      <span class="badge ${typeBadgeClass(p.type)}">${p.type}</span>
      <span class="badge ${statusClass(p.status||'In Progress')}">${p.status||"In Progress"}</span>
      ${priorityBadge}
      ${spaceTag}${dueBadge}
    </div>
    ${p.due ? `<div class="tc-due">Due ${formatDate(p.due)}</div>` : ""}
    ${fileSection}
    ${cardLinks.length ? renderLinkPills(cardLinks) : ""}
    ${checkBar}`;
  card.addEventListener("click",     () => openDetail(p));
  card.addEventListener("dragstart", e  => { dragSrcId = p.id; card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
  card.addEventListener("dragend",   ()  => card.classList.remove("dragging"));
  area.appendChild(card);
}

function setupDropZone(area, stageId) {
  area.addEventListener("dragover",  e  => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", ()  => area.classList.remove("drag-over"));
  area.addEventListener("drop", async e => {
    e.preventDefault(); area.classList.remove("drag-over");
    if (!dragSrcId) return;
    const p = allProjects().find(x => x.id === dragSrcId);
    if (!p || Number(p.stage) === stageId) return;
    const fromStage = Number(p.stage);
    const hist = p.history || [];
    hist.push({ action:"moved", by:CURRENT_USER, from:fromStage, stage:stageId, timestamp:Date.now() });
    await updateProject(p.space||"email", dragSrcId, { stage:stageId, history:hist });
    // Pass a copy of p with the updated space to ensure correct lookup
    const pCopy = { ...p, stage: fromStage };
    await notifyStageChange(pCopy, fromStage, stageId);
    dragSrcId = null;
  });
}

let _lastCompletedHtml = "";
function renderCompleted() {
  const s         = getCurrentSpace();
  const published = (s === "all" ? allProjects() : projectsBySpace[s]||[]).filter(p => p.status === "Published");
  const toggle    = document.getElementById("completedToggle");
  const list      = document.getElementById("completedList");
  if (!toggle||!list) return;
  toggle.textContent = completedOpen ? `Hide (${published.length})` : `Show (${published.length})`;
  list.style.display = completedOpen ? "block" : "none";
  if (!completedOpen||!published.length) {
    if (!published.length) list.innerHTML=`<p style="color:var(--text-3);font-size:13px;padding:8px 0">None yet.</p>`;
    _lastCompletedHtml = "";
    return;
  }
  list.innerHTML = `<div class="completed-list">${published.map(p => `
    <div class="completed-card">
      <div class="completed-check">✓</div>
      <div class="completed-name">${p.name}</div>
      <div style="display:flex;gap:6px"><span class="badge ${typeBadgeClass(p.type)}">${p.type}</span></div>
    </div>`).join("")}</div>`;
}
window.toggleCompleted = () => { completedOpen = !completedOpen; renderCompleted(); };

function renderStats() {
  const today   = new Date(); today.setHours(0,0,0,0);
  const s       = getCurrentSpace();
  const base    = s==="all" ? allProjects() : projectsBySpace[s]||[];
  const active  = base.filter(p => p.status !== "Published");
  const mine    = active.filter(p => {
    const sp = SPACES[p.space||"email"];
    return sp?.stages.find(st => st.id===Number(p.stage))?.owner === CURRENT_USER;
  }).length;
  const pub     = base.filter(p => p.status === "Published").length;
  const overdue = active.filter(p => p.due && new Date(p.due+"T00:00:00") < today).length;
  document.getElementById("statsGrid").innerHTML = `
    <div class="stat-card"><div class="stat-label">Active</div><div class="stat-val">${active.length}</div></div>
    <div class="stat-card"><div class="stat-label">My tasks</div><div class="stat-val">${mine}</div></div>
    <div class="stat-card"><div class="stat-label">Published</div><div class="stat-val">${pub}</div></div>
    <div class="stat-card"><div class="stat-label">Overdue</div><div class="stat-val" style="${overdue>0?"color:var(--rev-fg)":""}">${overdue}</div></div>`;
}

// ── Chart ──────────────────────────────────────────────────────────────────
function renderChart() {
  const canvas = document.getElementById("projectChart");
  if (!canvas) return;
  // Destroy only on mode/space change — update data in place when possible
  const needsRebuild = !chartInstance;
  if (!needsRebuild && chartInstance) { chartInstance.destroy(); chartInstance = null; }
  const s      = getCurrentSpace();
  const stages = s==="all" ? SPACES.email.stages : SPACES[s].stages;
  const active = (s==="all" ? allProjects() : projectsBySpace[s]||[]).filter(p => p.status !== "Published");
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const textCol = isDark ? "#9b98b0" : "#6b6882";
  const gridCol = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  let labels, data, bgColors;
  if (chartMode === "stage") {
    labels   = stages.map(st => st.name.split(" ")[0]);
    data     = stages.map(st => active.filter(p => Number(p.stage)===st.id).length);
    bgColors = ["#3b7dd8","#2aab6f","#9b7de0","#4ab3d8","#c060c8","#e0a030","#e06070"].slice(0,stages.length);
  } else if (chartMode === "status") {
    labels   = ["In Progress","Need Revision","Approved"];
    data     = labels.map(l => active.filter(p => (p.status||"In Progress")===l).length);
    bgColors = ["#e0a030","#e04a4a","#3b7dd8"];
  } else {
    labels   = spaceTypes;
    data     = spaceTypes.map(t => active.filter(p => p.type===t).length);
    bgColors = ["#7c5cbf","#2aab6f","#e0694a","#4ab3d8","#c060c8","#e0a030"];
  }
  chartInstance = new Chart(canvas, {
    type:"bar",
    data:{ labels, datasets:[{ data, backgroundColor:bgColors, borderRadius:6, borderSkipped:false }] },
    options:{
      responsive:true, maintainAspectRatio:true,
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: c => ` ${c.raw} project${c.raw!==1?"s":""}` } } },
      scales:{
        x:{ grid:{ display:false }, ticks:{ color:textCol, font:{ size:11 } } },
        y:{ grid:{ color:gridCol }, ticks:{ color:textCol, stepSize:1, font:{ size:11 } }, beginAtZero:true }
      }
    }
  });
}
window.switchChart = function(btn, mode) {
  chartMode = mode;
  document.querySelectorAll(".chart-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderChart();
};

// ── Notifications dropdown ─────────────────────────────────────────────────
window.toggleNotifs = () => {
  const p = document.getElementById("notifPanel");
  p.style.display = p.style.display==="none"?"block":"none";
};
window.readNotif   = id => markNotifRead(CURRENT_USER, id);
window.clearNotifs = async () => { await clearNotifications(CURRENT_USER); document.getElementById("notifPanel").style.display="none"; };
document.addEventListener("click", e => { if (!e.target.closest(".notif-wrap")) { const p=document.getElementById("notifPanel"); if(p) p.style.display="none"; } });
function renderNotifDropdown() {
  const list = document.getElementById("notifList"); if (!list) return;
  if (!notifications.length) { list.innerHTML=`<p class="notif-empty">No notifications</p>`; return; }
  list.innerHTML = notifications.slice(0,15).map(n => {
    const icon = n.type==="mention"?"🏷":n.type==="dm"?"💬":n.type==="stage"?"📋":n.type==="new_task"?"🆕":n.type==="published"?"✅":"🔔";
    const quickAction = buildNotifQuickAction(n);
    return `<div class="notif-item ${n.read?"":"unread"}" onclick="readNotif('${n.id}')">
      <div class="ni-title">${icon} ${n.title}</div>
      <div class="ni-sub">${n.message||""} · ${timeAgo(n.timestamp)}</div>
      ${quickAction}
    </div>`;
  }).join("");
}

function buildNotifQuickAction(n) {
  // DM or mention in chat → Reply button
  if (n.type === "dm" && n.roomId) {
    return `<button class="notif-action-btn" onclick="event.stopPropagation();goToChat('${n.roomId}')">💬 Reply</button>`;
  }
  if (n.type === "mention" && n.roomId) {
    return `<button class="notif-action-btn" onclick="event.stopPropagation();goToChat('${n.roomId}')">💬 Open chat</button>`;
  }
  // Stage assignment → View task button
  if (n.type === "stage" && n.projectId) {
    return `<button class="notif-action-btn" onclick="event.stopPropagation();goToTask('${n.projectId}','${n.space||"email"}')">📋 View task</button>`;
  }
  // Mention in task notes → go to task
  if (n.type === "mention" && n.projectId) {
    return `<button class="notif-action-btn" onclick="event.stopPropagation();goToTask('${n.projectId}','${n.space||"email"}')">📋 View task</button>`;
  }
  // New task created → view it
  if (n.type === "new_task" && n.projectId) {
    return `<button class="notif-action-btn" onclick="event.stopPropagation();goToTask('${n.projectId}','${n.space||"email"}')">🆕 View task</button>`;
  }
  // Task published → view it
  if (n.type === "published" && n.projectId) {
    return `<button class="notif-action-btn" onclick="event.stopPropagation();goToTask('${n.projectId}','${n.space||"email"}')">✅ View task</button>`;
  }
  return "";
}

window.goToChat = function(roomId) {
  sessionStorage.setItem("openChatRoom", roomId);
  window.location.href = "chat.html";
};

window.goToTask = function(projectId, space) {
  setCurrentSpace(space);
  sessionStorage.setItem("highlightProject", projectId);
  window.location.href = "dashboard.html";
};

// ── File handling (multi-file) ─────────────────────────────────────────────
window.handleFileSelect = function(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  const MAX = 5;
  for (const file of files) {
    if (pendingFiles.length >= MAX) { alert(`Max ${MAX} files per task.`); break; }
    if (file.size > 10*1024*1024) { alert(`"${file.name}" is too large — max 10MB per file.`); continue; }
    if (pendingFiles.find(f => f.name === file.name && f.size === file.size)) continue; // skip dupe
    pendingFiles.push({ file, name:file.name, type:file.type, size:file.size });
  }
  document.getElementById("fileInput").value = "";
  renderFilePreview();
};

function renderFilePreview() {
  const el = document.getElementById("attachedFilePreview"); if (!el) return;
  // Combine saved files (from existing project) + new pending files
  const savedFiles = _editingSavedFiles || [];
  const totalCount = savedFiles.length + pendingFiles.length;
  if (!totalCount) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <div class="attached-files-list">
      ${savedFiles.map((f, i) => `
        <div class="attached-file">
          <div class="file-icon">${fileIcon(f.fileType)}</div>
          <div class="file-name">${f.fileName}</div>
          <button class="file-remove-btn" onclick="removeSavedFile(${i})" title="Remove">✕</button>
        </div>`).join("")}
      ${pendingFiles.map((f, i) => `
        <div class="attached-file pending">
          <div class="file-icon">${fileIcon(f.type)}</div>
          <div class="file-name">${f.name}</div>
          <div class="file-size">${(f.size/1024/1024).toFixed(1)}MB</div>
          <button class="file-remove-btn" onclick="removePendingFile(${i})" title="Remove">✕</button>
        </div>`).join("")}
    </div>`;
}

// Tracks saved files on the project being edited (so we can remove individual ones)
let _editingSavedFiles = [];

window.removePendingFile = function(idx) {
  pendingFiles.splice(idx, 1);
  renderFilePreview();
};

window.removeSavedFile = function(idx) {
  const f = _editingSavedFiles[idx];
  if (f?.filePath) removedFilePaths.push(f.filePath);
  _editingSavedFiles.splice(idx, 1);
  renderFilePreview();
};
function fileIcon(type) { if (!type) return "📄"; if (type.includes("pdf")) return "📄"; if (type.includes("image")) return "🖼"; return "📝"; }

// ── File Review Panel ─────────────────────────────────────────────────────
// State for the open review panel
let _fvProjectId  = null;  // project id
let _fvFileIdx    = 0;     // which file slot (multiple files per project)
let _fvVersionIdx = null;  // which version in view (null = latest)
let _fvEditingId  = null;  // comment/reply id currently being edited
let _fvReplyingTo = null;  // comment id currently being replied to

window.closeFileViewer = function(e) {
  if (e.target.id === "fileViewerModal") document.getElementById("fileViewerModal").classList.remove("open");
};

// Main entry point — open the review panel
window.viewFile = function(projectId, fileIdx) {
  _fvProjectId   = projectId;
  _fvFileIdx     = fileIdx ?? 0;
  _fvVersionIdx  = null; // always open on latest
  _fvEditingId    = null;
  _fvReplyingTo   = null;
  _annModeActive  = false;
  _annDrawing     = false;
  _annPending     = null;
  _fvRedrawingCid = null;
  _penPtsRaw      = [];
  // Clear version cache so we always load fresh data from Firebase on open
  Object.keys(_fvVersionCache).forEach(k => delete _fvVersionCache[k]);
  // Pre-populate local cache from Firebase subscription data
  const p = allProjects().find(x => x.id === projectId);
  if (p?.fileReviews) fvSyncFromFirebase(p);
  // Restore full panel (may have been hidden by viewCheckFile)
  const cp = document.getElementById("fvCommentsPanel");
  const ac = document.getElementById("fvActions");
  if (cp) cp.style.display = "";
  if (ac) ac.innerHTML = `
    <button class="btn-ghost" style="font-size:12px" onclick="fvDownloadCurrent()">⬇ Download</button>
    <button id="fvAnnotateBtn" class="btn-ghost" style="font-size:12px" onclick="fvToggleAnnotate()" title="Click image to drop annotation pins">✏ Annotate</button>
    <label class="btn-ghost" style="font-size:12px;cursor:pointer">
      ↑ Upload new version
      <input type="file" id="fvUploadInput" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp" style="display:none" onchange="fvUploadNewVersion(event)"/>
    </label>`;
  fvRender();
  document.getElementById("fileViewerModal").classList.add("open");
};

// Migrate old flat file format to versioned format on-the-fly
function fvGetSlot(p, idx) {
  const files = getProjectFiles(p);
  const slot  = files[idx];
  if (!slot) return null;

  if (slot.versions) {
    // Firebase RTDB stores arrays as objects with numeric string keys
    // Normalise to a proper JS array sorted by index
    const versions = Array.isArray(slot.versions)
      ? slot.versions
      : Object.keys(slot.versions)
          .sort((a,b) => Number(a)-Number(b))
          .map(k => slot.versions[k]);
    return { ...slot, versions };
  }

  // No versions yet — wrap flat file into v0
  return {
    ...slot,
    versions: [{
      fileName:   slot.fileName,
      fileType:   slot.fileType,
      fileData:   slot.fileData,
      fileUrl:    slot.fileUrl,
      filePath:   slot.filePath,
      uploadedBy: slot.uploadedBy || "jc",
      uploadedAt: slot.uploadedAt || Date.now(),
    }]
  };
}

function fvCurrentVersion(slot) {
  const versions = slot.versions || [];
  if (_fvVersionIdx !== null && versions[_fvVersionIdx]) return versions[_fvVersionIdx];
  return versions[versions.length - 1]; // latest = last
}

// ── Review data model ─────────────────────────────────────────────────────
// Comments & annotations stored at project.fileReviews[key] 
// where key = `${fileIdx}_${versionIdx}`
// This keeps heavy base64 fileData COMPLETELY SEPARATE from comment writes.

// ── State ─────────────────────────────────────────────────────────────────

// Annotation drawing state
let _annTool       = 'rect';   // 'rect' | 'circle' | 'pen'
let _annDrawing    = false;
let _annStart      = null;     // {x,y} in % coords
let _annSvg        = null;     // live SVG element while drawing
let _annPending    = null;     // shape data awaiting text input
let _annTextInput  = null;     // popup element
let _fvRedrawingCid = null;    // cid of annotation being redrawn
let _penPtsRaw     = [];       // raw [x,y] pairs collected during pen draw

// ── Local version cache ────────────────────────────────────────────────────
// Keyed by "projectId/fileIdx" → array of version objects
// Written immediately on upload/delete so fvRender shows changes without
// waiting for Firebase subscribeProjects to fire back.
const _fvVersionCache = {};

function _vcKey()         { return `${_fvProjectId}/${_fvFileIdx}`; }
function _vcGet()         { return _fvVersionCache[_vcKey()] || null; }
function _vcSet(versions) { _fvVersionCache[_vcKey()] = versions; }
function _vcClear()       { delete _fvVersionCache[_vcKey()]; }

// Get the authoritative versions array — local cache first, then Firebase
function fvGetVersions(slot) {
  const cached = _vcGet();
  if (cached) return cached;
  return slot?.versions || [];
}

function fvCid() { return Math.random().toString(36).slice(2,9); }

// ── Local optimistic review cache ─────────────────────────────────────────
// Keyed by "projectId/fileIdx_vidx" — updated immediately on write,
// so comments appear instantly without waiting for Firebase onValue roundtrip
const _fvLocalCache = {};

function fvCacheKey() {
  if (!_fvProjectId) return null;
  const key = fvReviewKey();
  return key ? `${_fvProjectId}/${key}` : null;
}

function fvCacheGet() {
  const k = fvCacheKey(); if (!k) return null;
  return _fvLocalCache[k] || null;
}

function fvCacheSet(reviews) {
  const k = fvCacheKey(); if (!k) return;
  _fvLocalCache[k] = reviews;
}

function fvCacheAdd(comment) {
  const k = fvCacheKey(); if (!k) return;
  if (!_fvLocalCache[k]) _fvLocalCache[k] = {};
  _fvLocalCache[k][comment.id] = comment;
}

function fvCacheUpdate(cid, updates) {
  const k = fvCacheKey(); if (!k) return;
  // Ensure cache bucket exists
  if (!_fvLocalCache[k]) _fvLocalCache[k] = {};
  // If item not in local cache, pull from Firebase subscription data first
  if (!_fvLocalCache[k][cid]) {
    const p = allProjects().find(x => x.id === _fvProjectId);
    const key = fvReviewKey();
    const fbItem = key ? p?.fileReviews?.[key]?.[cid] : null;
    if (fbItem) _fvLocalCache[k][cid] = fbItem;
    else return; // truly doesn't exist anywhere
  }
  _fvLocalCache[k][cid] = { ..._fvLocalCache[k][cid], ...updates };
}

// Sync Firebase data into local cache (called by subscribeProjects)
// Only updates keys we don't have locally yet (or if another user wrote)
function fvSyncFromFirebase(p) {
  if (!p.fileReviews) return;
  Object.entries(p.fileReviews).forEach(([key, reviews]) => {
    const ck = `${p.id}/${key}`;
    if (!_fvLocalCache[ck]) {
      _fvLocalCache[ck] = reviews;
    } else {
      // Merge: add any new entries from Firebase that aren't in local cache
      Object.entries(reviews).forEach(([cid, c]) => {
        if (!_fvLocalCache[ck][cid]) _fvLocalCache[ck][cid] = c;
      });
    }
  });
}

// ── Review key ────────────────────────────────────────────────────────────
function fvReviewKey() {
  const p = allProjects().find(x => x.id === _fvProjectId); if (!p) return null;
  const slot = fvGetSlot(p, _fvFileIdx); if (!slot) return null;
  const vidx = _fvVersionIdx !== null ? _fvVersionIdx : (slot.versions||[]).length - 1;
  return `${_fvFileIdx}_${vidx}`;
}

function fvGetReviews() {
  // Always merge latest Firebase data into local cache first
  // This ensures delete/like/edit work even when cache is cold
  const p = allProjects().find(x => x.id === _fvProjectId);
  if (p?.fileReviews) fvSyncFromFirebase(p);

  const cached = fvCacheGet();
  if (cached) {
    return Object.values(cached).filter(c => !c.deleted).sort((a,b) => a.at - b.at);
  }
  return [];
}

async function fvSaveReview(commentData) {
  const p   = allProjects().find(x => x.id === _fvProjectId); if (!p) return;
  const key = fvReviewKey(); if (!key) return;
  const sp  = p.space || getCurrentSpace() || 'email';
  // Update local cache immediately for instant UI feedback
  fvCacheAdd(commentData);
  // Write to Firebase (async - UI already updated)
  await fbSet(ref(db, `spaces/${sp}/projects/${p.id}/fileReviews/${key}/${commentData.id}`), commentData);
}

async function fvUpdateReview(cid, updates) {
  const p   = allProjects().find(x => x.id === _fvProjectId); if (!p) return;
  const key = fvReviewKey(); if (!key) return;
  const sp  = p.space || getCurrentSpace() || 'email';
  // Update local cache immediately
  fvCacheUpdate(cid, updates);
  await fbUpdate(ref(db, `spaces/${sp}/projects/${p.id}/fileReviews/${key}/${cid}`), updates);
}

async function fvRemoveReview(cid) {
  const p   = allProjects().find(x => x.id === _fvProjectId); if (!p) return;
  const key = fvReviewKey(); if (!key) return;
  const sp  = p.space || getCurrentSpace() || 'email';
  fvCacheUpdate(cid, { deleted: true });
  await fbUpdate(ref(db, `spaces/${sp}/projects/${p.id}/fileReviews/${key}/${cid}`), { deleted: true });
}

// ── @mention helpers ───────────────────────────────────────────────────────
window.fvHandleMention = function(e) {
  const ta     = e.target;
  const before = ta.value.slice(0, ta.selectionStart);
  const atIdx  = before.lastIndexOf('@');
  const popup  = ta.parentNode?.querySelector('.fv-mention-popup');
  if (!popup) return;
  if (atIdx !== -1 && (atIdx === 0 || /\s/.test(before[atIdx-1]))) {
    const query = before.slice(atIdx+1).toLowerCase();
    const matches = Object.entries(ALL_USERS).filter(([uid,u]) =>
      query==='' || (u.name||uid).toLowerCase().includes(query) || uid.includes(query));
    if (!matches.length) { popup.style.display='none'; return; }
    popup.innerHTML = matches.map(([uid,u],i) =>
      `<div class="mention-item ${i===0?'active':''}" data-uid="${uid}" onmousedown="event.preventDefault();fvInsertMention(event,'${uid}')">
        <div class="av av-sm ${u.cls||'av-jc'}" style="width:20px;height:20px;font-size:8px;font-weight:700">${u.av||uid.slice(0,2).toUpperCase()}</div>
        <div><div class="mention-name">${u.name||uid}</div><div class="mention-role">${u.role||'Team member'}</div></div>
      </div>`).join('');
    popup.style.display = 'block';
  } else {
    popup.style.display = 'none';
  }
};

window.fvInsertMention = function(e, uid) {
  const popup = e.target.closest('.fv-mention-popup');
  const ta    = popup?.parentNode?.querySelector('textarea');
  if (!ta) return;
  const val = ta.value, pos = ta.selectionStart;
  const before = val.slice(0,pos), atIdx = before.lastIndexOf('@');
  ta.value = before.slice(0,atIdx) + '@' + uid + ' ' + val.slice(pos);
  const np = atIdx + uid.length + 2;
  ta.setSelectionRange(np,np); ta.focus();
  popup.style.display = 'none';
};

window.fvMentionKey = function(e) {
  const popup = e.target.parentNode?.querySelector('.fv-mention-popup');
  if (!popup || popup.style.display==='none') return;
  const items = popup.querySelectorAll('.mention-item');
  if (e.key==='ArrowDown') { e.preventDefault(); const c=popup.querySelector('.active'); const n=c?.nextElementSibling||items[0]; items.forEach(i=>i.classList.remove('active')); n?.classList.add('active'); }
  else if (e.key==='ArrowUp') { e.preventDefault(); const c=popup.querySelector('.active'); const n=c?.previousElementSibling||items[items.length-1]; items.forEach(i=>i.classList.remove('active')); n?.classList.add('active'); }
  else if (e.key==='Enter') { const a=popup.querySelector('.active'); if(a){e.preventDefault();a.dispatchEvent(new MouseEvent('mousedown'));} }
  else if (e.key==='Escape') { popup.style.display='none'; }
};

function fvFormatText(text) {
  return (text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/@(\w+)/g, (m,uid) => ALL_USERS[uid] ? `<span class="fv-mention">@${ALL_USERS[uid].name}</span>` : m);
}

// ── Main render ────────────────────────────────────────────────────────────
function fvRender() {
  // If user is actively drawing, only refresh comments — never interrupt the canvas
  if (_annDrawing) { fvRenderComments(); return; }
  const p = allProjects().find(x => x.id === _fvProjectId); if (!p) return;
  const allSlots = getProjectFiles(p);
  const slot     = fvGetSlot(p, _fvFileIdx); if (!slot) return;
  const versions = fvGetVersions(slot);  // local cache-first
  const vidx     = (_fvVersionIdx !== null && _fvVersionIdx < versions.length)
                   ? _fvVersionIdx : versions.length - 1;
  const ver      = versions[vidx];
  if (!ver) { document.getElementById('fvPreview').innerHTML = '<div style="padding:2rem;color:var(--text-3);text-align:center">No version data</div>'; return; }
  const src      = ver.fileUrl || ver.fileData;
  const totalVers= versions.length;
  const isImage  = ver.fileType?.includes('image');

  // Header
  document.getElementById('fvTitle').textContent = slot.fileName || ver.fileName;
  document.getElementById('fvMeta').textContent  =
    `v${vidx+1} of ${totalVers} · ${DEFAULT_USERS[ver.uploadedBy]?.name||ver.uploadedBy||'Unknown'} · ${timeAgo(ver.uploadedAt)}`;
  document.getElementById('fvDownloadAll').style.display = totalVers > 1 ? 'inline-flex' : 'none';

  // File tabs
  const tabsEl = document.getElementById('fvFileTabs');
  if (allSlots.length > 1) {
    tabsEl.innerHTML = allSlots.map((s,i) => {
      const sv = fvGetSlot(p,i);
      const sv0 = sv?.versions?.[sv.versions.length-1];
      const thumb = sv0?.fileType?.includes('image')
        ? `<img src="${sv0.fileUrl||sv0.fileData}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;display:block"/>`
        : `<span style="font-size:22px;display:block;text-align:center">${fileIcon(sv0?.fileType)}</span>`;
      return `<div class="fv-tab ${i===_fvFileIdx?'active':''}" onclick="fvSwitchFile(${i})" title="${s.fileName||''}">${thumb}<div class="fv-tab-name">${(s.fileName||'').split('.')[0]}</div></div>`;
    }).join('');
    tabsEl.style.display = 'flex';
  } else { tabsEl.style.display = 'none'; }

  // Preview
  const prevEl = document.getElementById('fvPreview');
  if (isImage) {
    fvRenderAnnotatedImage(src);
  } else if (ver.fileType?.includes('pdf')) {
    prevEl.innerHTML = `<iframe src="${src}" style="width:100%;height:100%;min-height:400px;border:none;border-radius:8px"></iframe>`;
  } else {
    prevEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--text-2)"><span style="font-size:56px">${fileIcon(ver.fileType)}</span><div style="font-size:13px;font-weight:500">${ver.fileName}</div></div>`;
  }

  // ── Version filmstrip ──────────────────────────────────────────────────
  const stripEl = document.getElementById('fvVersionStrip');
  if (totalVers > 1) {
    stripEl.style.display = '';
    const isOnLatest = vidx === versions.length - 1;

    const cards = versions.map((v, i) => {
      const vsrc     = v.fileUrl || v.fileData;
      const isImg    = v.fileType?.includes('image');
      const active   = i === vidx;
      const isLast   = i === versions.length - 1;
      const uploader = DEFAULT_USERS[v.uploadedBy]?.name || v.uploadedBy || '?';
      const canDel   = versions.length > 1 && (v.uploadedBy === CURRENT_USER || CURRENT_USER === 'jc');

      const imgHtml = isImg && vsrc
        ? `<img src="${vsrc}" alt="v${i+1}"/>`
        : `<div class="fv-vcard-icon">${fileIcon(v.fileType)}</div>`;

      const latestBadge  = isLast  ? `<span class="fv-badge fv-badge-latest">Latest</span>` : '';
      const currentBadge = active  ? `<span class="fv-badge fv-badge-current">Viewing</span>` : '';
      const delBtn = canDel
        ? `<button class="fv-vcard-del" onclick="event.stopPropagation();fvDeleteVersion(${i})">🗑 Delete v${i+1}</button>`
        : '';

      return `
        <div class="fv-vcard${active?' active':''}" onclick="fvSwitchVersion(${i})" title="Switch to v${i+1}">
          <div class="fv-vcard-img">${imgHtml}</div>
          <div class="fv-vcard-body">
            <div class="fv-vcard-ver">v${i+1} ${latestBadge}${currentBadge}</div>
            <div class="fv-vcard-who">${uploader}</div>
            <div class="fv-vcard-time">${timeAgo(v.uploadedAt)}</div>
          </div>
          ${delBtn}
        </div>`;
    }).join('');

    const prevBtn = `<button class="fv-arr" onclick="fvSwitchVersion(${vidx-1})" ${vidx===0?'disabled':''}>‹</button>`;
    const nextBtn = `<button class="fv-arr" onclick="fvSwitchVersion(${vidx+1})" ${vidx===versions.length-1?'disabled':''}>›</button>`;
    const returnBtn = !isOnLatest
      ? `<button class="fv-return-btn" onclick="fvSwitchVersion(${versions.length-1})">↩ Latest (v${versions.length})</button>`
      : '';

    stripEl.innerHTML = `
      <div class="fv-strip-bar">
        <span class="fv-strip-label">Versions (${totalVers})</span>
        ${returnBtn}
        ${prevBtn}${nextBtn}
      </div>
      <div class="fv-strip-scroll">${cards}</div>`;

    // Scroll active card into view without interrupting user
    requestAnimationFrame(() => {
      const activeCard = stripEl.querySelector('.fv-vcard.active');
      activeCard?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' });
    });
  } else {
    stripEl.style.display = 'none';
  }

  // Actions bar — show annotation toolbar only for images
  const acEl = document.getElementById('fvActions');
  if (isImage) {
    acEl.innerHTML = `
      <button class="btn-ghost" style="font-size:12px" onclick="fvDownloadCurrent()">⬇ Download</button>
      <div class="ann-toolbar" id="annToolbar">
        <button class="ann-tool-btn ${_annTool==='rect'?'active':''}" onclick="fvSetTool('rect')" title="Rectangle">⬜</button>
        <button class="ann-tool-btn ${_annTool==='circle'?'active':''}" onclick="fvSetTool('circle')" title="Circle">⭕</button>
        <button class="ann-tool-btn ${_annTool==='pen'?'active':''}" onclick="fvSetTool('pen')" title="Freehand">✏️</button>
        <button id="fvAnnotateBtn" class="${_annDrawing||_annPending?'ann-tool-btn active':'ann-tool-btn'}" onclick="fvToggleAnnotate()" title="Draw annotation">Annotate</button>
        <button class="ann-tool-btn" onclick="fvClearAllAnnotations()" title="Clear all annotations" style="color:var(--rev-fg)">🗑</button>
      </div>
      <label class="btn-ghost" style="font-size:12px;cursor:pointer">
        ↑ New version
        <input type="file" id="fvUploadInput" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp" style="display:none" onchange="fvUploadNewVersion(event)"/>
      </label>`;
  } else {
    acEl.innerHTML = `
      <button class="btn-ghost" style="font-size:12px" onclick="fvDownloadCurrent()">⬇ Download</button>
      <label class="btn-ghost" style="font-size:12px;cursor:pointer">↑ New version<input type="file" id="fvUploadInput" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp" style="display:none" onchange="fvUploadNewVersion(event)"/></label>`;
  }

  // Comments
  fvRenderComments();
}

// ── Annotation rendering ───────────────────────────────────────────────────
let _annModeActive = false;

window.fvSetTool = function(tool) {
  _annTool = tool;
  // Re-render toolbar buttons
  document.querySelectorAll('.ann-tool-btn').forEach(b => b.classList.remove('active'));
  const map = { rect:'rect', circle:'circle', pen:'pen' };
  document.querySelectorAll('.ann-tool-btn').forEach(b => {
    if (b.getAttribute('onclick') === `fvSetTool('${tool}')`) b.classList.add('active');
  });
};

window.fvToggleAnnotate = function() {
  _annModeActive = !_annModeActive;
  _annPending    = null;
  _annDrawing    = false;
  document.getElementById('fvAnnotateBtn')?.classList.toggle('active', _annModeActive);
  const wrap = document.getElementById('fvAnnWrap');
  if (wrap) wrap.classList.toggle('annotate-mode', _annModeActive);
  document.getElementById('fvAnnTextPopup')?.remove();
};

// Lightweight: only refresh SVG shapes on the existing image (no DOM rebuild, no listener rebind)
function fvRedrawShapes() {
  const svgEl = document.getElementById('fvAnnSvg'); if (!svgEl) return;
  const reviews = fvGetReviews();
  const shapes  = reviews.filter(c => c.shape);
  svgEl.innerHTML = shapes.map((c, i) => fvShapeToSvg(c, i+1)).join('');
}

function fvRenderAnnotatedImage(src) {
  const prevEl  = document.getElementById('fvPreview');
  const reviews = fvGetReviews();
  const shapes  = reviews.filter(c => c.shape);

  // The ann-wrap uses inline-flex so it hugs the image exactly.
  // The SVG is absolutely positioned over only that image rect.
  // getPct() in fvBindDrawing uses ann-wrap.getBoundingClientRect()
  // which now matches the image precisely — no coord drift.
  // ann-wrap is inline-block so it shrinks to exactly the image dimensions.
  // SVG sits position:absolute over that same rect — perfect coordinate alignment.
  prevEl.style.cssText = 'display:flex;align-items:center;justify-content:center;';
  prevEl.innerHTML = `
    <div class="ann-wrap" id="fvAnnWrap">
      <img id="fvAnnImg" src="${src}" draggable="false"
           onerror="this.style.opacity='0.3'"/>
      <svg class="ann-svg-layer" id="fvAnnSvg"
           viewBox="0 0 100 100" preserveAspectRatio="none"
           style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;border-radius:6px;pointer-events:none;"></svg>
    </div>`;

  // Draw saved shapes
  document.getElementById('fvAnnSvg').innerHTML =
    shapes.map((c,i) => fvShapeToSvg(c, i+1)).join('');

  if (_annModeActive) document.getElementById('fvAnnWrap')?.classList.add('annotate-mode');
  fvBindDrawing();
}

function fvPtsToSvg(pts) {
  // pts is array of [x,y] pairs where x,y are 0-100 (matching viewBox)
  if (!pts || !pts.length) return '';
  return pts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
}

function fvShapeToSvg(c, num) {
  const s     = c.shape;
  const color = '#7c5cbf';
  const isOwn = c.by === CURRENT_USER;

  // All coordinates are in viewBox space (0-100), NO % units needed
  function badge(bx, by) {
    const nx = Math.min(Math.max(bx, 2), 96);
    const ny = Math.min(Math.max(by, 2), 96);
    const r  = 3.5;  // number badge radius
    // Delete box: sits right beside number badge, same height
    const del = isOwn
      ? `<rect x="${nx+r+0.8}" y="${ny-r}" width="${r*2}" height="${r*2}" rx="1.2" fill="#e53e3e" style="cursor:pointer;pointer-events:all" onclick="fvDeleteAnnotation('${c.id}')"/>
         <text x="${nx+r+0.8+r}" y="${ny+0.3}" font-size="3.8" font-weight="900" fill="white" text-anchor="middle" dominant-baseline="middle" style="pointer-events:none">✕</text>`
      : '';
    return `<circle cx="${nx}" cy="${ny}" r="${r}" fill="${color}" style="cursor:pointer;pointer-events:all" onclick="fvScrollToComment('${c.id}')"/>
      <text x="${nx}" y="${ny+0.3}" font-size="3.5" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle" style="pointer-events:none">${num}</text>
      ${del}`;
  }

  let shape = '';
  if (s.type === 'rect') {
    const x1 = Math.min(s.x1, s.x2), y1 = Math.min(s.y1, s.y2);
    const w  = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
    shape = `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="${color}22" stroke="${color}" stroke-width="0.5" rx="0.8"/>
      ${badge(x1, y1)}`;
  } else if (s.type === 'circle') {
    const rx = Math.max(Math.abs(s.rx)||2, 0.5);
    const ry = Math.max(Math.abs(s.ry)||2, 0.5);
    shape = `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${rx}" ry="${ry}" fill="${color}22" stroke="${color}" stroke-width="0.5"/>
      ${badge(s.cx - rx, s.cy - ry)}`;
  } else if (s.type === 'pen') {
    // pts = [[x,y], ...] stored as raw 0-100 values
    const pts = s.pts || (s.points ? s.points.split(/\s+/).reduce((a,v,i,arr)=>{ if(i%2===0)a.push([parseFloat(v),parseFloat(arr[i+1]||0)]); return a; },[]) : []);
    const ptsStr = fvPtsToSvg(pts);
    shape = ptsStr
      ? `<polyline points="${ptsStr}" fill="none" stroke="${color}" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/>
         ${badge(s.x0, s.y0)}`
      : '';
  }
  return shape ? `<g class="ann-shape" data-cid="${c.id}">${shape}</g>` : '';
}

// ── Drawing interaction ────────────────────────────────────────────────────
function fvBindDrawing() {
  // Always work with live element reference inside each handler
  function getWrap() { return document.getElementById('fvAnnWrap'); }

  function getPct(e, w) {
    const r  = w.getBoundingClientRect();
    const cx = (e.touches || e.changedTouches)?.[0]?.clientX ?? e.clientX;
    const cy = (e.touches || e.changedTouches)?.[0]?.clientY ?? e.clientY;
    return { x: Math.min(100,Math.max(0,((cx-r.left)/r.width)*100)),
             y: Math.min(100,Math.max(0,((cy-r.top)/r.height)*100)) };
  }

  function onDown(e) {
    if (!_annModeActive) return;
    if (e.target.closest('.ann-shape') || e.target.closest('#fvAnnTextPopup')) return;
    e.preventDefault();
    const w = getWrap(); if (!w) return;
    _annDrawing = true;
    _annStart   = getPct(e, w);
    _annPending = null;
    document.getElementById('fvAnnTextPopup')?.remove();

    const svg = document.getElementById('fvAnnSvg'); if (!svg) return;
    const tag = _annTool === 'pen' ? 'polyline' : (_annTool === 'circle' ? 'ellipse' : 'rect');
    _annSvg = document.createElementNS('http://www.w3.org/2000/svg', tag);
    _annSvg.setAttribute('fill',   '#7c5cbf22');
    _annSvg.setAttribute('stroke', '#7c5cbf');
    _annSvg.setAttribute('stroke-width', '0.6');
    _annSvg.setAttribute('stroke-dasharray', '5,3');
    if (_annTool === 'pen') {
      _penPtsRaw = [[_annStart.x, _annStart.y]];
      _annSvg.setAttribute('points', `${_annStart.x.toFixed(2)},${_annStart.y.toFixed(2)}`);
      _annSvg.setAttribute('fill', 'none');
      _annSvg.setAttribute('stroke-linecap', 'round');
      _annSvg.setAttribute('stroke-linejoin', 'round');
      _annSvg.setAttribute('stroke-dasharray', '');
    }
    svg.appendChild(_annSvg);
  }

  function onMove(e) {
    if (!_annDrawing || !_annSvg || !_annStart) return;
    e.preventDefault();
    const w = getWrap(); if (!w) return;
    const cur = getPct(e, w);
    if (_annTool === 'rect') {
      const x1 = Math.min(_annStart.x, cur.x), y1 = Math.min(_annStart.y, cur.y);
      _annSvg.setAttribute('x', x1);      _annSvg.setAttribute('y', y1);
      _annSvg.setAttribute('width',  Math.abs(cur.x-_annStart.x));
      _annSvg.setAttribute('height', Math.abs(cur.y-_annStart.y));
    } else if (_annTool === 'circle') {
      const cx = (_annStart.x+cur.x)/2, cy = (_annStart.y+cur.y)/2;
      _annSvg.setAttribute('cx', cx); _annSvg.setAttribute('cy', cy);
      _annSvg.setAttribute('rx', Math.abs(cur.x-_annStart.x)/2);
      _annSvg.setAttribute('ry', Math.abs(cur.y-_annStart.y)/2);
    } else if (_annTool === 'pen') {
      _penPtsRaw.push([cur.x, cur.y]);
      _annSvg.setAttribute('points', _penPtsRaw.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '));
    }
  }

  function onUp(e) {
    if (!_annDrawing || !_annStart) return;
    _annDrawing = false;
    const w   = getWrap(); if (!w) return;
    const end = getPct(e, w);
    const start = { ..._annStart };

    // ── Capture pen path BEFORE touching _annSvg ──
    let penPts = null;
    if (_annTool === 'pen' && _annSvg) {
      penPts = _penPtsRaw.length >= 2 ? [..._penPtsRaw] : [[start.x, start.y],[end.x, end.y]];
    }

    _annStart = null;
    _penPtsRaw = [];

    // Require meaningful drag (> 1% for shapes, any movement for pen)
    const dx = Math.abs(end.x - start.x), dy = Math.abs(end.y - start.y);
    const tooSmall = (_annTool !== 'pen' && dx < 1 && dy < 1) || (_annTool === 'pen' && !penPts);
    if (tooSmall) { _annSvg?.remove(); _annSvg = null; return; }

    // Keep shape visible as a ghost while user types the comment
    // Change to solid so it looks like a preview of the final annotation
    if (_annSvg) {
      _annSvg.setAttribute('stroke-dasharray', '');
      _annSvg.setAttribute('opacity', '0.7');
      // Don't remove — will be removed by fvSubmitAnnotation/fvCancelAnnotation
    }

    let shapeData;
    if (_annTool === 'rect') {
      shapeData = { type:'rect', x1:start.x, y1:start.y, x2:end.x, y2:end.y };
    } else if (_annTool === 'circle') {
      shapeData = { type:'circle', cx:(start.x+end.x)/2, cy:(start.y+end.y)/2,
                    rx:Math.abs(end.x-start.x)/2, ry:Math.abs(end.y-start.y)/2 };
    } else {
      // Store as array of [x,y] pairs (raw %) — rendered via fvPtsToSvg()
      shapeData = { type:'pen', pts:penPts, x0:start.x, y0:start.y };
    }
    _annPending = shapeData;
    fvShowShapeTextInput(end.x, end.y);
  }

  // Attach listeners directly — no cloning (cloning loses SVG state)
  const w = getWrap(); if (!w) return;
  // Remove any previous listeners by replacing just the element's event handlers
  // We use named functions stored on the element itself to allow clean removal
  if (w._fvBound) {
    w.removeEventListener('mousedown',  w._fvBound.down);
    w.removeEventListener('mousemove',  w._fvBound.move);
    w.removeEventListener('mouseup',    w._fvBound.up);
    w.removeEventListener('touchstart', w._fvBound.down);
    w.removeEventListener('touchmove',  w._fvBound.move);
    w.removeEventListener('touchend',   w._fvBound.up);
  }
  w._fvBound = { down:onDown, move:onMove, up:onUp };
  w.addEventListener('mousedown',  onDown);
  w.addEventListener('mousemove',  onMove);
  w.addEventListener('mouseup',    onUp);
  w.addEventListener('touchstart', onDown, {passive:false});
  w.addEventListener('touchmove',  onMove, {passive:false});
  w.addEventListener('touchend',   onUp,   {passive:false});
  if (_annModeActive) w.classList.add('annotate-mode');
}

function fvShowShapeTextInput(x, y) {
  document.getElementById('fvAnnTextPopup')?.remove();
  const wrap = document.getElementById('fvAnnWrap'); if (!wrap) return;
  const popLeft = Math.min(x, 60);
  const popTop  = Math.min(y + 3, 75);
  const popup = document.createElement('div');
  popup.id = 'fvAnnTextPopup';
  popup.className = 'ann-pin-input';
  popup.style.cssText = `left:${popLeft}%;top:${popTop}%;`;
  popup.innerHTML = `
    <div class="fv-input-mention-wrap" style="position:relative">
      <textarea id="fvAnnTextarea" class="fv-comment-input" placeholder="Add note… use @ to tag" rows="2"
        oninput="fvHandleMention(event)" onkeydown="fvMentionKey(event);if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();fvSubmitAnnotation();}" style="font-size:12px;resize:none;"></textarea>
      <div class="fv-mention-popup" style="display:none;bottom:100%;top:auto"></div>
    </div>
    <div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end">
      <button class="btn-ghost" style="font-size:11px;padding:4px 8px" onclick="fvCancelAnnotation()">Cancel</button>
      <button class="btn-primary" style="font-size:11px;padding:4px 10px;width:auto;height:auto;border-radius:var(--radius-sm)" onclick="fvSubmitAnnotation()">Add</button>
    </div>`;
  wrap.appendChild(popup);
  popup.querySelector('textarea')?.focus();
}

window.fvCancelAnnotation = function() {
  _annPending = null;
  document.getElementById('fvAnnTextPopup')?.remove();
  // Remove the ghost preview shape
  if (_annSvg) { _annSvg.remove(); _annSvg = null; }
};

window.fvSubmitAnnotation = async function() {
  if (!_annPending) return;
  const ta   = document.getElementById('fvAnnTextarea');
  const text = ta?.value.trim();

  if (_fvRedrawingCid) {
    // ── Redraw mode: update shape on existing comment ──
    const cached = fvCacheGet();
    const existing = cached?.[_fvRedrawingCid];
    if (existing) {
      const updated = { ...existing, shape: _annPending, editedAt: Date.now() };
      // If user also typed new text, update that too
      if (text) updated.text = text;
      fvCacheUpdate(_fvRedrawingCid, updated);
      fvRedrawShapes();
      fvRenderComments();
      await fvUpdateReview(_fvRedrawingCid, updated).catch(console.error);
    }
    _fvRedrawingCid = null;
  } else {
    // ── New annotation ──
    if (!text) return; // text required for new annotations
    const comment = { id:fvCid(), by:CURRENT_USER, at:Date.now(), text, shape:_annPending, replies:[], likes:{} };
    try {
      await fvSaveReview(comment);
    } catch(err) {
      console.error('[Review] Save annotation failed:', err);
      alert('Failed to save annotation: ' + (err.message||err));
      return;
    }
    fvRedrawShapes();
    fvRenderComments();
  }

  _annPending    = null;
  _annModeActive = false;
  document.getElementById('fvAnnTextPopup')?.remove();
  document.getElementById('fvAnnotateBtn')?.classList.remove('active');
  document.getElementById('fvAnnWrap')?.classList.remove('annotate-mode');
  // Remove ghost preview — real shape now rendered by fvRedrawShapes
  if (_annSvg) { _annSvg.remove(); _annSvg = null; }
};

window.fvScrollToComment = function(cid) {
  const el = document.getElementById('fvc-'+cid);
  if (el) { el.scrollIntoView({behavior:'smooth',block:'nearest'}); el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),1000); }
};

// ── Comment renderer ───────────────────────────────────────────────────────
function fvRenderComments() {
  const listEl  = document.getElementById('fvCommentsList'); if (!listEl) return;
  const reviews = fvGetReviews();
  if (!reviews.length) {
    listEl.innerHTML = `<div style="color:var(--text-3);font-size:12px;padding:12px 0;text-align:center">No feedback yet.</div>`;
    return;
  }
  listEl.innerHTML = reviews.map((c,i) => fvCommentHtml(c, i)).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

function fvLikeHtml(c, parentId) {
  const likes   = c.likes || {};
  const count   = Object.keys(likes).length;
  const liked   = !!likes[CURRENT_USER];
  const pid     = parentId ? `'${parentId}'` : 'null';
  return `<button class="fv-like-btn ${liked?'liked':''}" onclick="fvToggleLike('${c.id}',${pid})" title="${liked?'Unlike':'Like'}">
    ${liked?'❤️':'🤍'}<span class="fv-like-count">${count||''}</span>
  </button>`;
}

function fvCommentHtml(c, idx) {
  const isOwn    = c.by === CURRENT_USER;
  const uData    = DEFAULT_USERS[c.by] || { name:c.by, av:'?', cls:'av-jc' };
  const replies  = (c.replies||[]).filter(r=>!r.deleted);
  const hasShape = !!c.shape;
  const shapeIcon = hasShape ? ({rect:'⬜',circle:'⭕',pen:'✏️'}[c.shape.type]||'📌') : '';

  const repliesHtml = replies.map(r => {
    const ru      = DEFAULT_USERS[r.by]||{name:r.by,av:'?',cls:'av-jc'};
    const isOwnR  = r.by === CURRENT_USER;
    const rLiked  = !!(r.likes||{})[CURRENT_USER];
    const rLikeCount = Object.keys(r.likes||{}).length;
    return `<div class="fv-reply" id="fvc-${r.id}">
      <div class="fv-comment-meta">
        <div class="av av-sm ${ru.cls}" style="width:18px;height:18px;font-size:8px;font-weight:700;flex-shrink:0">${ru.av}</div>
        <span class="fv-comment-author">${ru.name}</span>
        <span class="fv-comment-time">${timeAgo(r.at)}</span>
        <div class="fv-comment-actions">
          ${fvLikeHtml(r, c.id)}
          ${isOwnR?`<button onclick="fvEditComment('${c.id}','${r.id}')" title="Edit">✏</button>
          <button onclick="fvDeleteComment('${c.id}','${r.id}')" title="Delete">🗑</button>`:''}
        </div>
      </div>
      ${_fvEditingId===r.id ? fvEditInputHtml(r.id,r.text,c.id) : `<div class="fv-comment-text">${fvFormatText(r.text)}${r.editedAt?'<span style="font-size:10px;color:var(--text-3)"> (edited)</span>':''}</div>`}
    </div>`;
  }).join('');

  // Annotation-specific actions: edit shape (redraw), delete annotation
  const annActions = hasShape && isOwn ? `
    <button class="fv-ann-action" onclick="fvEditAnnotationShape('${c.id}')" title="Redraw shape">✏ Shape</button>
    <button class="fv-ann-action danger" onclick="fvDeleteAnnotation('${c.id}')" title="Delete annotation">🗑 Ann.</button>` : '';

  return `<div class="fv-comment ${hasShape?'is-ann':''}" id="fvc-${c.id}">
    <div class="fv-comment-meta">
      ${hasShape?`<span class="ann-shape-badge" onclick="fvHighlightShape('${c.id}')" title="Jump to annotation">${idx+1}</span>`:''}
      <div class="av av-sm ${uData.cls}" style="width:22px;height:22px;font-size:9px;font-weight:700;flex-shrink:0">${uData.av}</div>
      <span class="fv-comment-author">${uData.name}</span>
      <span class="fv-comment-time">${timeAgo(c.at)}</span>
      <div class="fv-comment-actions">
        ${fvLikeHtml(c, null)}
        <button onclick="fvStartReply('${c.id}')" title="Reply">↩</button>
        ${isOwn?`<button onclick="fvEditComment('${c.id}',null)" title="Edit text">✏</button>
        <button onclick="fvDeleteComment('${c.id}',null)" title="Delete">🗑</button>`:''}
      </div>
    </div>
    ${_fvEditingId===c.id ? fvEditInputHtml(c.id,c.text,null) : `<div class="fv-comment-text">${shapeIcon?`<span style="font-size:10px;color:var(--text-3);margin-right:3px">${shapeIcon}</span>`:''}${fvFormatText(c.text)}${c.editedAt?'<span style="font-size:10px;color:var(--text-3)"> (edited)</span>':''}</div>`}
    ${annActions ? `<div class="fv-ann-actions">${annActions}</div>` : ''}
    ${repliesHtml?`<div class="fv-replies">${repliesHtml}</div>`:''}
    ${_fvReplyingTo===c.id?fvReplyInputHtml(c.id):''}
  </div>`;
}

function fvEditInputHtml(cid, txt, parentId) {
  return `<div class="fv-input-mention-wrap" style="position:relative;margin-top:4px">
    <textarea id="fv-edit-${cid}" class="fv-comment-input" rows="2"
      oninput="fvHandleMention(event)" onkeydown="fvMentionKey(event)"
      style="font-size:12px;resize:none;">${(txt||'').replace(/</g,'&lt;')}</textarea>
    <div class="fv-mention-popup" style="display:none"></div>
    <div style="display:flex;gap:6px;margin-top:4px">
      <button class="btn-ghost" style="font-size:11px;padding:3px 8px" onclick="fvCancelEdit()">Cancel</button>
      <button class="btn-primary" style="font-size:11px;padding:3px 8px;width:auto;height:auto;border-radius:var(--radius-sm)"
        onclick="fvSaveEdit('${cid}','${parentId||''}')">Save</button>
    </div>
  </div>`;
}

function fvReplyInputHtml(parentId) {
  return `<div class="fv-reply-input" style="margin-top:8px">
    <div class="fv-input-mention-wrap" style="position:relative">
      <textarea id="fv-reply-${parentId}" class="fv-comment-input" rows="2" placeholder="Reply… use @ to tag"
        oninput="fvHandleMention(event)" onkeydown="fvMentionKey(event);if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();fvPostReply('${parentId}');}"
        style="font-size:12px;resize:none;"></textarea>
      <div class="fv-mention-popup" style="display:none"></div>
    </div>
    <div style="display:flex;gap:6px;margin-top:4px">
      <button class="btn-ghost" style="font-size:11px;padding:3px 8px" onclick="fvCancelReply()">Cancel</button>
      <button class="btn-primary" style="font-size:11px;padding:3px 8px;width:auto;height:auto;border-radius:var(--radius-sm)"
        onclick="fvPostReply('${parentId}')">Reply</button>
    </div>
  </div>`;
}

// ── Comment CRUD ───────────────────────────────────────────────────────────
window.fvSwitchFile    = function(idx) { _fvFileIdx=idx; _fvVersionIdx=null; _annModeActive=false; _annPending=null; _vcClear(); fvRender(); };
window.fvSwitchVersion = function(idx) { _fvVersionIdx=idx; _annModeActive=false; _annPending=null; fvRender(); };
window.fvStartReply    = function(cid) { _fvReplyingTo=cid; _fvEditingId=null; fvRenderComments(); setTimeout(()=>document.getElementById('fv-reply-'+cid)?.focus(),50); };
window.fvCancelReply   = function()    { _fvReplyingTo=null; fvRenderComments(); };
window.fvEditComment   = function(cid,rid) { _fvEditingId=rid||cid; _fvReplyingTo=null; fvRenderComments(); setTimeout(()=>document.getElementById('fv-edit-'+(rid||cid))?.focus(),50); };
window.fvCancelEdit    = function()    { _fvEditingId=null; fvRenderComments(); };

window.fvHighlightShape = function(cid) {
  document.querySelectorAll('.ann-shape').forEach(g => g.classList.remove('ann-highlight'));
  const g = document.querySelector(`.ann-shape[data-cid="${cid}"]`);
  if (g) { g.classList.add('ann-highlight'); setTimeout(()=>g.classList.remove('ann-highlight'),1500); }
};

window.fvPostComment = async function() {
  const input = document.getElementById('fvCommentInput');
  const text  = input?.value.trim(); if (!text) return;
  const comment = { id:fvCid(), by:CURRENT_USER, at:Date.now(), text, replies:[], likes:{} };
  input.value = '';
  input.disabled = true;
  try {
    await fvSaveReview(comment); // cache updated inside, so render shows it immediately
    fvRenderComments();
  } catch(err) {
    console.error('[Review] Post comment failed:', err);
    alert('Failed to post: ' + (err.message||err));
  } finally {
    input.disabled = false;
    input.focus();
  }
};

window.fvPostReply = async function(parentId) {
  const ta   = document.getElementById('fv-reply-'+parentId);
  const text = ta?.value.trim(); if (!text) return;
  // Read parent from local cache first, then Firebase
  const cached = fvCacheGet() || {};
  const fbData = allProjects().find(x => x.id === _fvProjectId)?.fileReviews?.[fvReviewKey()] || {};
  const parent = cached[parentId] || fbData[parentId]; if (!parent) return;
  const reply  = { id:fvCid(), by:CURRENT_USER, at:Date.now(), text };
  const newReplies = [...(parent.replies||[]), reply];
  // Update cache immediately
  fvCacheUpdate(parentId, { replies: newReplies });
  _fvReplyingTo = null;
  fvRenderComments();
  try {
    await fvUpdateReview(parentId, { replies: newReplies });
  } catch(err) {
    console.error('[Review] Post reply failed:', err);
    alert('Failed to post reply: ' + (err.message||err));
  }
};

window.fvSaveEdit = async function(cid, parentId) {
  const ta   = document.getElementById('fv-edit-'+cid);
  const text = ta?.value.trim(); if (!text) return;
  const editedAt = Date.now();
  _fvEditingId = null;
  if (parentId) {
    // editing a reply — find parent from cache
    const cached = fvCacheGet() || {};
    const parent = cached[parentId]; if (!parent) return;
    const replies = (parent.replies||[]).map(r => r.id===cid ? {...r,text,editedAt} : r);
    fvCacheUpdate(parentId, { replies });
    fvRenderComments();
    await fvUpdateReview(parentId, { replies }).catch(e => console.error('[Review] Edit reply failed:', e));
  } else {
    fvCacheUpdate(cid, { text, editedAt });
    fvRenderComments();
    await fvUpdateReview(cid, { text, editedAt }).catch(e => console.error('[Review] Edit failed:', e));
  }
};

window.fvDeleteComment = async function(cid, rid) {
  if (!confirm(rid?'Delete this reply?':'Delete this comment?')) return;
  // Warm cache from Firebase before mutating
  const _dp = allProjects().find(x => x.id === _fvProjectId);
  if (_dp) fvSyncFromFirebase(_dp);
  if (rid) {
    const cached = fvCacheGet() || {};
    const parent = cached[cid]; if (!parent) return;
    const replies = (parent.replies||[]).map(r => r.id===rid ? {...r,deleted:true} : r);
    fvCacheUpdate(cid, { replies });
    fvRenderComments();
    await fvUpdateReview(cid, { replies }).catch(e => console.error('[Review] Delete reply failed:', e));
  } else {
    fvCacheUpdate(cid, { deleted: true });
    fvRenderComments();
    await fvRemoveReview(cid).catch(e => console.error('[Review] Delete failed:', e));
  }
};

// ── Like / Unlike ────────────────────────────────────────────────────────
window.fvToggleLike = async function(cid, parentId) {
  // Ensure cache is populated from Firebase before toggling
  const _lp = allProjects().find(x => x.id === _fvProjectId);
  if (_lp) fvSyncFromFirebase(_lp);
  const cached = fvCacheGet(); if (!cached) return;
  if (parentId) {
    // Reply like
    const parent = cached[parentId]; if (!parent) return;
    const replies = (parent.replies||[]).map(r => {
      if (r.id !== cid) return r;
      const likes = { ...(r.likes||{}) };
      if (likes[CURRENT_USER]) delete likes[CURRENT_USER];
      else likes[CURRENT_USER] = true;
      return { ...r, likes };
    });
    fvCacheUpdate(parentId, { replies });
    fvRenderComments();
    await fvUpdateReview(parentId, { replies }).catch(console.error);
  } else {
    // Top-level comment like
    const c = cached[cid]; if (!c) return;
    const likes = { ...(c.likes||{}) };
    if (likes[CURRENT_USER]) delete likes[CURRENT_USER];
    else likes[CURRENT_USER] = true;
    fvCacheUpdate(cid, { likes });
    fvRenderComments();
    await fvUpdateReview(cid, { likes }).catch(console.error);
  }
};

// ── Edit annotation shape (redraw) ────────────────────────────────────────
// Stores the comment id being redrawn so fvSubmitAnnotation knows to update not create


window.fvEditAnnotationShape = function(cid) {
  _fvRedrawingCid = cid;
  _annModeActive  = true;
  _annPending     = null;
  const btn = document.getElementById('fvAnnotateBtn');
  btn?.classList.add('active');
  const wrap = document.getElementById('fvAnnWrap');
  wrap?.classList.add('annotate-mode');
  // Show instruction toast
  fvToast('Draw the new shape on the image');
};

// ── Delete single annotation (shape + comment) ────────────────────────────
window.fvDeleteAnnotation = async function(cid) {
  if (!confirm('Delete this annotation and its shape?')) return;
  // Ensure cache is warm from Firebase before marking deleted
  const p = allProjects().find(x => x.id === _fvProjectId);
  if (p) fvSyncFromFirebase(p);
  fvCacheUpdate(cid, { deleted: true });
  fvRedrawShapes();
  fvRenderComments();
  await fvRemoveReview(cid).catch(console.error);
};

// ── Clear all annotations for current version ─────────────────────────────
window.fvClearAllAnnotations = async function() {
  // Warm cache from Firebase before reading
  const p = allProjects().find(x => x.id === _fvProjectId);
  if (p) fvSyncFromFirebase(p);
  const reviews = fvGetReviews();
  const shapes  = reviews.filter(c => c.shape);
  if (!shapes.length) { fvToast('No annotations to clear'); return; }
  if (!confirm(`Clear all ${shapes.length} annotation${shapes.length>1?'s':''}?`)) return;
  for (const c of shapes) {
    fvCacheUpdate(c.id, { deleted: true });
    await fvRemoveReview(c.id).catch(console.error);
  }
  fvRedrawShapes();
  fvRenderComments();
};

// ── Toast helper ──────────────────────────────────────────────────────────
function fvToast(msg) {
  let t = document.getElementById('fvToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'fvToast';
    t.className = 'fv-toast';
    document.getElementById('fileViewerModal')?.querySelector('.modal-review')?.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2200);
}

window.fvUploadNewVersion = async function(event) {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 10*1024*1024) { alert("Max 10MB per file."); return; }
  event.target.value = "";

  const btn = document.getElementById("fvActions")?.querySelector("label");
  if (btn) btn.childNodes[0].textContent = " Processing…";

  let b64;
  try {
    b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  } catch(err) {
    alert("Failed to read file: " + err.message);
    if (btn) btn.childNodes[0].textContent = "↑ New version";
    return;
  }

  const p = allProjects().find(x => x.id === _fvProjectId);
  if (!p) { if (btn) btn.childNodes[0].textContent = "↑ New version"; return; }

  const sp       = p.space || getCurrentSpace() || "email";
  const basePath = `spaces/${sp}/projects/${p.id}`;

  // ── Read the REAL Firebase versions (not fvGetSlot which wraps flat files) ──
  // We need the raw p.files[idx].versions to know if versions already exist in DB
  const rawFiles = p.files
    ? (Array.isArray(p.files) ? p.files : Object.keys(p.files).sort((a,b)=>Number(a)-Number(b)).map(k=>p.files[k]))
    : [];
  const rawSlot     = rawFiles[_fvFileIdx] || {};
  const rawVersions = rawSlot.versions
    ? (Array.isArray(rawSlot.versions) ? rawSlot.versions : Object.keys(rawSlot.versions).sort((a,b)=>Number(a)-Number(b)).map(k=>rawSlot.versions[k]))
    : null; // null = no versions node in Firebase yet

  // Build the new version object
  const newVer = { fileName: file.name, fileType: file.type, fileData: b64,
                   uploadedBy: CURRENT_USER, uploadedAt: Date.now() };

  // ── Determine what to write ──
  let versionsToCache; // what we'll put in the local cache for instant render

  try {
    if (!rawVersions) {
      // First time adding versioning — write v0 (original flat file) AND v1 (new)
      // This preserves the original so you can always go back
      const v0 = {
        fileName:   rawSlot.fileName  || p.fileName  || file.name,
        fileType:   rawSlot.fileType  || p.fileType  || file.type,
        fileData:   rawSlot.fileData  || p.fileData  || null,
        fileUrl:    rawSlot.fileUrl   || p.fileUrl   || null,
        uploadedBy: rawSlot.uploadedBy || p.uploadedBy || "jc",
        uploadedAt: rawSlot.uploadedAt || p.createdAt || Date.now(),
      };
      await fbSet(ref(db, `${basePath}/files/${_fvFileIdx}/versions/0`), v0);
      await fbSet(ref(db, `${basePath}/files/${_fvFileIdx}/versions/1`), newVer);
      versionsToCache = [v0, newVer];
      _fvVersionIdx = 1;
    } else {
      // Versions already exist — append at next index
      const nextIdx = rawVersions.length;
      await fbSet(ref(db, `${basePath}/files/${_fvFileIdx}/versions/${nextIdx}`), newVer);
      versionsToCache = [...rawVersions, newVer];
      _fvVersionIdx = nextIdx;
    }

    // Update legacy top-level fields → always points to latest version
    if (_fvFileIdx === 0) {
      await fbUpdate(ref(db, basePath), { fileName: file.name, fileType: file.type, fileData: b64 });
    }
    await fbUpdate(ref(db, `${basePath}/files/${_fvFileIdx}`), { fileName: file.name, fileType: file.type });

  } catch(err) {
    console.error("[Upload] New version failed:", err);
    alert("Failed to upload: " + (err.message || err));
    if (btn) btn.childNodes[0].textContent = "↑ New version";
    return;
  }

  // ── Update local cache so fvRender shows new version immediately ──
  _vcSet(versionsToCache);

  if (btn) btn.childNodes[0].textContent = "↑ New version";
  fvRender();
};

// ── Delete a specific version ─────────────────────────────────────────────
window.fvDeleteVersion = async function(verIdx) {
  const p = allProjects().find(x => x.id === _fvProjectId); if (!p) return;
  const slot = fvGetSlot(p, _fvFileIdx); if (!slot) return;

  // Use version cache so we operate on the same data fvRender sees
  const versions = fvGetVersions(slot);

  if (versions.length <= 1) {
    alert("Can't delete the only version — it's the last one."); return;
  }
  const ver = versions[verIdx];
  if (!ver) { alert("Version not found."); return; }
  if (!confirm(`Delete v${verIdx+1} "${ver.fileName}"?\nThis cannot be undone.`)) return;

  const sp        = p.space || getCurrentSpace() || 'email';
  const verPath   = `spaces/${sp}/projects/${p.id}/files/${_fvFileIdx}/versions`;
  const remaining = versions.filter((_, i) => i !== verIdx);
  const newLatest = remaining[remaining.length - 1];

  // Fix current view index
  if (_fvVersionIdx === verIdx || _fvVersionIdx >= remaining.length) {
    _fvVersionIdx = remaining.length - 1;
  } else if (_fvVersionIdx > verIdx) {
    _fvVersionIdx--;
  }

  // ── Optimistic: update cache immediately, render shows it now ──
  _vcSet(remaining);
  fvToast(`Deleting v${verIdx+1}…`);
  fvRender();

  try {
    // Remove the gap node, then re-index sequentially
    await fbRemove(ref(db, `${verPath}/${verIdx}`));
    for (let ni = 0; ni < remaining.length; ni++) {
      await fbSet(ref(db, `${verPath}/${ni}`), remaining[ni]);
    }
    // Update legacy top-level fields
    if (_fvFileIdx === 0 && newLatest) {
      await fbUpdate(ref(db, `spaces/${sp}/projects/${p.id}`), {
        fileName: newLatest.fileName, fileType: newLatest.fileType,
        fileData: newLatest.fileData || null, fileUrl: newLatest.fileUrl || null,
      });
    }
    if (newLatest) {
      await fbUpdate(ref(db, `spaces/${sp}/projects/${p.id}/files/${_fvFileIdx}`), {
        fileName: newLatest.fileName, fileType: newLatest.fileType,
      });
    }
    fvToast(`v${verIdx+1} deleted`);
  } catch(err) {
    console.error('[Version] Delete failed:', err);
    // Revert cache on failure
    _vcSet(versions);
    fvRender();
    alert('Failed to delete: ' + (err.message || err));
  }
};
// Download current version
window.fvDownloadCurrent = function() {
  const p    = allProjects().find(x => x.id === _fvProjectId); if (!p) return;
  const slot = fvGetSlot(p, _fvFileIdx); if (!slot) return;
  const ver  = fvCurrentVersion(slot);
  const src  = ver.fileUrl || ver.fileData;
  if (!src) return;
  const a = document.createElement("a");
  a.href = src; a.download = ver.fileName; a.target = "_blank";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

// Download all versions of current file slot
window.downloadAllFiles = function() {
  const p    = allProjects().find(x => x.id === _fvProjectId); if (!p) return;
  const slot = fvGetSlot(p, _fvFileIdx); if (!slot) return;
  const versions = slot.versions || [];
  versions.forEach((ver, i) => {
    const src = ver.fileUrl || ver.fileData; if (!src) return;
    setTimeout(() => {
      const a = document.createElement("a");
      const ext  = ver.fileName.split(".").pop();
      const base = ver.fileName.replace(/\.[^.]+$/, "");
      a.href = src; a.download = `${base}_v${i+1}.${ext}`; a.target = "_blank";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, i * 300); // stagger to avoid browser blocking
  });
};

// Helper — returns unified files array from p.files[] + legacy p.fileName
// Get the display src for a file slot — always the latest version's data
function getSlotDisplaySrc(slot) {
  if (slot?.versions) {
    const versions = Array.isArray(slot.versions)
      ? slot.versions
      : Object.keys(slot.versions).sort((a,b) => Number(a)-Number(b)).map(k => slot.versions[k]);
    const latest = versions[versions.length - 1];
    return latest?.fileUrl || latest?.fileData || null;
  }
  return slot?.fileUrl || slot?.fileData || null;
}

function getSlotDisplayType(slot) {
  if (slot?.versions) {
    const versions = Array.isArray(slot.versions)
      ? slot.versions
      : Object.keys(slot.versions).sort((a,b) => Number(a)-Number(b)).map(k => slot.versions[k]);
    const latest = versions[versions.length - 1];
    return latest?.fileType || slot?.fileType || null;
  }
  return slot?.fileType || null;
}

function getProjectFiles(p) {
  if (p.files) {
    // Firebase RTDB may return arrays as objects with numeric string keys
    const arr = Array.isArray(p.files)
      ? p.files
      : Object.keys(p.files)
          .sort((a,b) => Number(a)-Number(b))
          .map(k => p.files[k]);
    if (arr.length) return arr;
  }
  // Legacy flat format
  if (p.fileUrl || p.fileData) return [{ fileName: p.fileName, fileType: p.fileType, fileUrl: p.fileUrl, fileData: p.fileData, filePath: p.filePath }];
  return [];
}

const uploadArea = document.getElementById("fileUploadArea");
if (uploadArea) {
  uploadArea.addEventListener("dragover",  e => { e.preventDefault(); uploadArea.classList.add("dragging"); });
  uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("dragging"));
  uploadArea.addEventListener("drop", e => {
    e.preventDefault(); uploadArea.classList.remove("dragging");
    const files = e.dataTransfer.files;
    if (files.length) handleFileSelect({ target: { files } });
  });
}

// ── Project modal ──────────────────────────────────────────────────────────
window.openNewProject = function(stageId=1) {
  try {
    editingId=null; pendingFiles=[]; removedFilePaths=[]; _editingSavedFiles=[];
    // Rebuild dropdown for current space before opening
    buildStageDropdown();
    buildTypeButtons();
    const modal = document.getElementById("projectModal"); if (!modal) return;
    document.getElementById("modalTitle").textContent = "New project";
    ["f-name","f-due","f-notes"].forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
    const stageEl = document.getElementById("f-stage");
    if (stageEl) stageEl.value = stageId;
    const prev = document.getElementById("attachedFilePreview"); if (prev) prev.innerHTML = "";
    const fi = document.getElementById("fileInput"); if (fi) fi.value = "";
    _modalLinks = [];
    renderLinkEditor();
    document.querySelectorAll("#typeGroup .seg-btn").forEach((b,i)   => b.classList.toggle("active",i===0));
    document.querySelectorAll("#statusGroup .seg-btn").forEach((b,i) => b.classList.toggle("active",i===0));
    document.querySelectorAll("#priorityGroup .seg-btn").forEach((b,i) => b.classList.toggle("active",i===0));
    const saveBtn = document.getElementById("modalSaveBtn"); if (saveBtn) saveBtn.textContent = "Save project";
    modal.classList.add("open");
    setTimeout(() => document.getElementById("f-name")?.focus(), 80);
  } catch(err) {
    console.error("openNewProject error:", err);
    alert("Error opening project form: " + err.message);
  }
};
window.closeModal = () => { document.getElementById("projectModal").classList.remove("open"); pendingFiles=[]; removedFilePaths=[]; _editingSavedFiles=[]; };
window.closeModalOutside = e => { if (e.target.id==="projectModal") closeModal(); };
window.setSeg = (btn, gid) => {
  document.querySelectorAll(`#${gid} .seg-btn`).forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
};

window.saveProject = async function() {
  const name = document.getElementById("f-name").value.trim(); if (!name) { document.getElementById("f-name").focus(); return; }
  const type       = document.querySelector("#typeGroup .seg-btn.active")?.dataset.val || spaceTypes[0] || "Newsletter";
  const status     = document.querySelector("#statusGroup .seg-btn.active")?.dataset.val || "In Progress";
  const priority   = document.querySelector("#priorityGroup .seg-btn.active")?.dataset.val || "";
  const stage      = Number(document.getElementById("f-stage").value);
  const due        = document.getElementById("f-due").value;
  const notes      = document.getElementById("f-notes").value.trim();
  const links      = _modalLinks.filter(l => l.url && l.url.trim());
  // Use project's original space when editing, not current view
  let s = getCurrentSpace() === "all" ? "email" : getCurrentSpace();
  if (editingId) {
    const editingProject = allProjects().find(p => p.id === editingId);
    if (editingProject?.space) s = editingProject.space;
  }
  const btn = document.getElementById("modalSaveBtn");
  btn.textContent="Saving…"; btn.disabled=true;

  // ── Phase 1: Save project data ─────────────────────────────────────────
  let project = null;
  let isNew   = !editingId;
  let prev    = editingId ? allProjects().find(p => p.id === editingId) : null;
  let stageChanged = false;

  try {
    const data = { name,type,status,priority,stage,due,links,notes,space:s };

    // ── Handle multi-file attachments (base64 → Realtime DB, no Storage auth needed) ──
    if (pendingFiles.length || _editingSavedFiles.length !== (prev?.files?.length ?? (prev?.fileData ? 1 : 0))) {
      if (pendingFiles.length) {
        btn.textContent = pendingFiles.length > 1 ? `Processing 1/${pendingFiles.length}…` : "Processing…";
      }

      // Convert each pending file to base64
      const newlyEncoded = [];
      for (let i = 0; i < pendingFiles.length; i++) {
        if (pendingFiles.length > 1) btn.textContent = `Processing ${i+1}/${pendingFiles.length}…`;
        const f = pendingFiles[i];
        const b64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = e => resolve(e.target.result);
          reader.onerror = () => reject(new Error(`Could not read file: ${f.name}`));
          reader.readAsDataURL(f.file);
        });
        newlyEncoded.push({ fileName: f.name, fileType: f.type, fileData: b64, fileSize: f.size });
      }

      // Final files = kept saved files + newly encoded
      const finalFiles = [..._editingSavedFiles, ...newlyEncoded];
      data.files = finalFiles;

      // Keep legacy single-file fields in sync (first file)
      if (finalFiles.length) {
        data.fileName = finalFiles[0].fileName;
        data.fileType = finalFiles[0].fileType;
        data.fileData = finalFiles[0].fileData;
        data.fileUrl  = finalFiles[0].fileUrl  || null;
        data.filePath = finalFiles[0].filePath || null;
      } else {
        data.files    = [];
        data.fileName = null; data.fileType = null;
        data.fileData = null; data.fileUrl  = null;
        data.filePath = null; data.fileSize = null;
      }
    }

    btn.textContent = "Saving…";

    if (editingId) {
      if (!prev) console.warn("editProject: project not found", editingId);
      if (prev && Number(prev?.stage) !== stage) {
        stageChanged = true;
        const hist = prev.history || [];
        hist.push({ action:"moved", by:CURRENT_USER, from:Number(prev.stage), stage, timestamp:Date.now() });
        data.history = hist;
      }
      await updateProject(s, editingId, data);
    } else {
      project = await createProject({...data, createdBy:CURRENT_USER});
    }
  } catch(err) {
    console.error("saveProject error:", err);
    alert("Error saving project: " + (err.message || err));
    btn.textContent = editingId ? "Update project" : "Save project";
    btn.disabled = false;
    return;
  }

  // ── Phase 2: Notifications (always run, separate try/catch) ───────────────
  try {
    if (isNew && project) {
      let stageInfo = (SPACES[s]?.stages || []).find(st => st.id === stage);
      // For custom spaces not yet in SPACES, fetch from Firebase
      if (!stageInfo) {
        try {
          const cfg = await getSpaceConfig(s);
          if (cfg?.stages) stageInfo = cfg.stages.find(st => st.id === stage);
        } catch(e) {}
      }
      // Notify stage owners
      if (stageInfo) await sendAssignmentNotif(stageInfo.owner, project, stageInfo);
      // Notify ALL other users
      await notifyAllUsers(
        `🆕 New task: "${name}"`,
        `${u_obj.name} created a new task in ${SPACES[s]?.label || s} — Step ${stage}: ${stageInfo?.name || ""}`,
        { projectId: project.id, space: project.space || "email", projectName: name, type: "new_task" }
      );
      // @mentions in notes
      if (notes) {
        for (const uid of extractMentions(notes)) {
          if (uid === CURRENT_USER) continue;
          await pushNotification(uid, { title:`${u_obj.name} mentioned you in "${name}"`, message:`"${notes.slice(0,80)}"`, type:"mention", projectId: project.id, space: s });
        }
      }
    } else if (!isNew && prev) {
      // Stage change notification
      if (stageChanged) await notifyStageChange(prev, Number(prev.stage), stage);
      // New @mentions in notes
      if (notes) {
        const prevNotes = prev?.notes || "";
        const newMentions = extractMentions(notes).filter(uid => !extractMentions(prevNotes).includes(uid));
        for (const uid of newMentions) {
          if (uid === CURRENT_USER) continue;
          await pushNotification(uid, { title:`${u_obj.name} mentioned you in "${name}"`, message:`Notes: "${notes.slice(0,80)}"`, type:"mention" });
        }
      }
    }
  } catch(notifErr) {
    console.warn("[Notif] saveProject notification error (non-fatal):", notifErr);
  }

  btn.textContent = isNew ? "Save project" : "Update project";
  btn.disabled = false;
  closeModal();
};

// ── Detail modal ───────────────────────────────────────────────────────────
window.openDetail = function(p) {
  const sp     = p.space || getCurrentSpace() || "email";
  const stages = SPACES[sp]?.stages || SPACES.email.stages;
  const stage  = stages.find(s => s.id===Number(p.stage));
  const sc     = {s1:"#3b7dd8",s2:"#2aab6f",s3:"#9b7de0",s4:"#4ab3d8",s5:"#c060c8",s6:"#e0a030",s7:"#e06070"}[stage?.key]||"#888";
  const allHist = (p.history||[]).slice().reverse();
  const vis3    = allHist.slice(0,3); const rest = allHist.slice(3);
  function histRow(h) {
    const who=DEFAULT_USERS[h.by]?.name||h.by;
    const toS=stages.find(s=>s.id===h.stage)?.name||"";
    const frm=h.from?` from "${stages.find(s=>s.id===h.from)?.name}"`:""
    const act=h.action==="created"?`Created by ${who} — "${toS}"`:h.action==="published"?`Published by ${who}`:`Moved${frm} → "${toS}" by ${who}`;
    return `<div class="history-item"><div class="hi-dot"></div><div><div class="hi-text">${act}</div><div class="hi-time">${timeAgo(h.timestamp)}</div></div></div>`;
  }
  const checklist = p.checklist ? Object.entries(p.checklist) : [];
  const checkItems = checklist.map(([id,c]) => {
    const hasFile = c.fileName && (c.fileUrl || c.fileData);
    const fileBtn = hasFile
      ? `<span class="ci-file-attached" onclick="viewCheckFile('${p.id}','${id}')" title="${c.fileName}">
           <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 1.5A.5.5 0 012.5 1h4l2 2v5.5a.5.5 0 01-.5.5h-6A.5.5 0 012 8.5v-7z" stroke="currentColor" stroke-width="1.2"/></svg>
           <span>${c.fileName}</span>
         </span>
         <button class="ci-file-remove" onclick="removeCheckFile('${p.id}','${id}','${sp}')" title="Remove file">✕</button>`
      : `<label class="ci-file-btn" title="Attach file">
           <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v6M2 4l3-3 3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M1 8.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
           File
           <input class="ci-file-input" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp"
             onchange="attachCheckFile(event,'${p.id}','${id}','${sp}')"/>
         </label>`;
    return `
    <div class="checklist-item ${c.done?"done":""}" id="ci-${id}">
      <input type="checkbox" ${c.done?"checked":""} onchange="toggleCheck('${p.id}','${id}',this.checked,'${sp}')"/>
      <div class="checklist-item-text">${c.text}</div>
      ${fileBtn}
      <button class="checklist-item-del" onclick="deleteCheck('${p.id}','${id}','${sp}')">✕</button>
    </div>`;
  }).join("");

  document.getElementById("detailTitle").textContent = p.name;
  document.getElementById("detailBody").innerHTML = `
    <div class="detail-grid">
      <div class="detail-field"><div class="df-label">Type</div><div class="df-val"><span class="badge ${typeBadgeClass(p.type)}">${p.type}</span></div></div>
      <div class="detail-field"><div class="df-label">Status</div><div class="df-val"><span class="badge ${statusClass(p.status||'In Progress')}">${p.status||"In Progress"}</span></div></div>
      ${p.priority ? `<div class="detail-field"><div class="df-label">Priority</div><div class="df-val"><span class="badge badge-priority-${p.priority.toLowerCase()}">${p.priority==="High"?"🔴":p.priority==="Medium"?"🟡":"🟢"} ${p.priority}</span></div></div>` : ""}
      <div class="detail-field"><div class="df-label">Stage</div><div class="df-val"><span class="stage-pill" style="background:${sc}18;color:${sc}">${stage?.name||"—"}</span></div></div>
      <div class="detail-field"><div class="df-label">Owner</div><div class="df-val">${stage?DEFAULT_USERS[stage.owner]?.name||stage.owner:"—"}</div></div>
      <div class="detail-field"><div class="df-label">Space</div><div class="df-val"><span class="space-banner space-banner-${sp}" style="background:${(SPACE_COLORS[sp]||SPACES[sp]?.color||'#3b7dd8')}22;color:${SPACE_COLORS[sp]||SPACES[sp]?.color||'#3b7dd8'};font-size:11px;padding:2px 8px;border-radius:10px">${SPACES[sp]?.label||sp}</span></div></div>
      <div class="detail-field"><div class="df-label">Due date</div><div class="df-val">${p.due?formatDate(p.due):"—"}</div></div>
      ${(()=>{const pf=getProjectFiles(p);if(!pf.length)return"";if(pf.length===1)return`<div class="detail-field"><div class="df-label">File</div><div class="df-val"><button class="file-open-btn" onclick="viewFile('${p.id}',0)">Open ${pf[0].fileName}</button></div></div>`;return`<div class="detail-field full"><div class="df-label">Files (${pf.length})</div><div class="df-val" style="display:flex;gap:8px;flex-wrap:wrap">${pf.map((f,i)=>{if(f.fileType?.includes("image"))return`<img src="${f.fileUrl||f.fileData}" onclick="viewFile('${p.id}',${i})" style="width:56px;height:56px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid var(--border)" title="${f.fileName}"/>`;return`<button class="file-open-btn" onclick="viewFile('${p.id}',${i})">${f.fileType?.includes("pdf")?"📄":"📝"} ${f.fileName}</button>`}).join("")}</div></div>`;})()}
      ${normaliseLinkData(p).length ? `<div class="detail-field full"><div class="df-label">Links</div>
        <div class="detail-links-section">
          ${normaliseLinkData(p).map(l => {
            const { icon, label, cls } = detectLinkType(l.name, l.url);
            const typePill = `<span class="detail-link-type" style="background:var(--surface2);color:var(--text-2)">${label}</span>`;
            return `<div class="detail-link-row">
              <div class="detail-link-icon">${icon}</div>
              <div class="detail-link-info">
                <div class="detail-link-name">${l.name || label}</div>
                <div class="detail-link-url">${l.url}</div>
              </div>
              ${typePill}
              <a href="${l.url}" target="_blank" rel="noopener"
                 style="flex-shrink:0;background:var(--purple-dim);color:var(--purple);border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;text-decoration:none;cursor:pointer">
                Open →
              </a>
            </div>`;
          }).join("")}
        </div>
      </div>` : ""}
      ${p.notes?`<div class="detail-field full"><div class="df-label">Notes</div><div class="df-val" style="font-weight:400;color:var(--text-2)">${p.notes}</div></div>`:""}
    </div>
    <div class="checklist-section" style="margin-top:14px">
      <div class="checklist-header"><div class="checklist-title">Checklist <span style="color:var(--text-3);font-weight:400;font-size:11px">${checklist.filter(([,c])=>c.done).length}/${checklist.length}</span></div></div>
      <div class="checklist-items" id="checklistItems">${checkItems}</div>
      <div class="checklist-add-row">
        <input type="text" id="newCheckItem" class="field-input" style="flex:1;padding:7px 10px;font-size:12px" placeholder="Add item..." onkeydown="if(event.key==='Enter')addCheck('${p.id}','${sp}')"/>
        <label class="checklist-upload-btn" title="Attach a file to this item">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 5l3.5-4 3.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 10.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          File
          <input type="file" id="newCheckFile" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp" onchange="setPendingCheckFile(event)"/>
        </label>
        <button class="checklist-add-btn" onclick="addCheck('${p.id}','${sp}')">Add</button>
      </div>
      <div id="pendingCheckFilePreview" style="display:none" class="ci-pending-file">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 1.5A.5.5 0 012.5 1h4l2.5 2.5V9.5a.5.5 0 01-.5.5h-6A.5.5 0 012 9.5v-8z" stroke="currentColor" stroke-width="1.2"/></svg>
        <span id="pendingCheckFileName"></span>
        <button class="ci-pending-clear" onclick="clearPendingCheckFile()">✕</button>
      </div>
    </div>
    <div class="history-section" style="margin-top:14px">
      <div class="history-list">${vis3.map(histRow).join("")}</div>
      ${rest.length?`
        <div id="histExtra" style="display:none"><div class="history-list">${rest.map(histRow).join("")}</div></div>
        <button class="history-toggle-btn" id="histToggleBtn" onclick="toggleHistory()">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          Show ${rest.length} more
        </button>`:""}
    </div>`;

  const nextStage = stages.find(s=>s.id===Number(p.stage)+1);
  const canEdit   = true; // everyone can edit/delete
  // Everyone can advance or publish — not restricted to stage owner
  const advanceBtn = nextStage
    ? `<button class="btn-advance" onclick="advanceProject('${p.id}',${nextStage.id},'${sp}')" style="flex:1">Pass to ${nextStage.ownerLabel} →</button>`
    : Number(p.stage)===stages.length
    ? `<button class="btn-advance" onclick="markPublished('${p.id}','${sp}')" style="flex:1">Mark as published ✓</button>` : "";
  document.getElementById("detailFooter").innerHTML = `
    <div style="display:flex;gap:8px;width:100%;flex-wrap:wrap">
      <div style="display:flex;gap:8px;flex:1">
        ${canEdit?`<button class="btn-ghost" onclick="editProject('${p.id}','${sp}')">Edit</button>`:""}
        ${canEdit?`<button class="btn-danger" onclick="confirmDelete('${p.id}','${sp}')">Delete</button>`:""}
      </div>
      ${advanceBtn}
    </div>`;
  document.getElementById("detailModal").classList.add("open");
};

window.toggleHistory = () => {
  const extra=document.getElementById("histExtra"); const btn=document.getElementById("histToggleBtn");
  const open=extra.style.display==="block"; extra.style.display=open?"none":"block";
  btn.innerHTML=open?`<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Show more`:`<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8l4-4 4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Hide`;
};
window.closeDetail = () => document.getElementById("detailModal").classList.remove("open");
window.closeDetailOutside = e => { if (e.target.id==="detailModal") closeDetail(); };

window.editProject = function(id, sp) {
  try {
    const p = allProjects().find(x=>x.id===id); if (!p) { console.error("editProject: project not found", id); return; }
    editingId=id; pendingFiles=[]; removedFilePaths=[];
    // Load existing files into _editingSavedFiles
    _editingSavedFiles = getProjectFiles(p).map(f => ({...f}));
    const pSpace = sp || p.space || "email";
    const pStages = SPACES[pSpace]?.stages || SPACES.email.stages;
    // Rebuild stage dropdown for this project's space
    const sel = document.getElementById("f-stage");
    if (sel) sel.innerHTML = pStages.map(st =>
      `<option value="${st.id}">${st.id} — ${st.name} (${st.ownerLabel})</option>`
    ).join("");
    const modal = document.getElementById("projectModal"); if (!modal) return;
    document.getElementById("modalTitle").textContent = "Edit project";
    document.getElementById("f-name").value = p.name || "";
    document.getElementById("f-due").value  = p.due  || "";
    document.getElementById("f-notes").value = p.notes || "";
    if (sel) sel.value = p.stage;
    renderFilePreview();
    _modalLinks = normaliseLinkData(p).map(l => ({...l}));
    renderLinkEditor();
    // Rebuild type buttons for this project's space so correct types show
    const editTypes = spaceTypes.length ? spaceTypes : (SPACES[pSpace]?.defaultTypes || ["Newsletter","Blog","Case Study"]);
    const tg = document.getElementById("typeGroup");
    if (tg) {
      tg.innerHTML = editTypes.map(t =>
        `<button class="seg-btn ${t===p.type?'active':''}" data-val="${t}" onclick="setSeg(this,'typeGroup')">${t}</button>`
      ).join("") + `<button class="seg-btn" onclick="addCustomType()" title="Add custom type" style="font-size:16px;padding:5px 10px">+</button>`;
    }
    document.querySelectorAll("#statusGroup .seg-btn").forEach(b => b.classList.toggle("active",b.dataset.val===(p.status||"In Progress")));
    document.querySelectorAll("#priorityGroup .seg-btn").forEach(b => b.classList.toggle("active",b.dataset.val===(p.priority||"")));
    const saveBtn = document.getElementById("modalSaveBtn");
    if (saveBtn) saveBtn.textContent = "Update project";
    closeDetail();
    modal.classList.add("open");
    setTimeout(() => document.getElementById("f-name")?.focus(), 80);
  } catch(err) {
    console.error("editProject error:", err);
    alert("Error opening edit form: " + err.message);
  }
};
window.advanceProject = async function(id, nextStageId, sp) {
  const p=allProjects().find(x=>x.id===id); if (!p) return;
  const hist=p.history||[];
  hist.push({action:"moved",by:CURRENT_USER,from:Number(p.stage),stage:nextStageId,timestamp:Date.now()});
  await updateProject(sp||p.space||"email",id,{stage:nextStageId,history:hist});
  await notifyStageChange(p,Number(p.stage),nextStageId);
  closeDetail();
};
window.markPublished = async function(id, sp) {
  const p=allProjects().find(x=>x.id===id); if (!p) return;
  const hist=p.history||[];
  hist.push({action:"published",by:CURRENT_USER,stage:Number(p.stage),timestamp:Date.now()});
  await updateProject(sp||p.space||"email",id,{status:"Published",history:hist});
  // Notify ALL users that a task is completed/published
  await notifyAllUsers(
    `✅ Task completed: "${p.name}"`,
    `${u_obj.name} marked "${p.name}" as published in ${SPACES[sp||p.space]?.label || sp || p.space}.`,
    { projectId: p.id, space: p.space||sp||"email", projectName: p.name, type: "published" }
  );
  closeDetail();
};
window.confirmDelete = async function(id, sp) {
  if (!confirm("Delete this project?")) return;
  const p = allProjects().find(x => x.id === id);
  if (p) {
    // Delete all attached files from Storage
    const files = getProjectFiles(p);
    for (const f of files) {
      if (f.filePath) await deleteStorageFile(f.filePath).catch(() => {});
    }
    // Also clean up any checklist files
    const checklist = p.checklist ? Object.values(p.checklist) : [];
    for (const c of checklist) {
      if (c.filePath) await deleteStorageFile(c.filePath).catch(() => {});
    }
  }
  await deleteProject(sp || p?.space || "email", id);
  closeDetail();
};

window.toggleCheck = async function(pid, cid, done, sp) {
  const p=allProjects().find(x=>x.id===pid); if (!p) return;
  const cl={...p.checklist||{}}; if(cl[cid]) cl[cid].done=done;
  await updateProject(sp||p.space||"email",pid,{checklist:cl});
};
// Pending file for new checklist item
let _pendingCheckFile = null;

window.setPendingCheckFile = function(event) {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 50*1024*1024) { alert("File too large — max 50MB"); return; }
  // Store the raw File object directly — NOT base64
  _pendingCheckFile = { file, name: file.name, type: file.type };
  const preview = document.getElementById("pendingCheckFilePreview");
  const nameEl  = document.getElementById("pendingCheckFileName");
  if (preview) preview.style.display = "flex";
  if (nameEl)  nameEl.textContent    = file.name;
  event.target.value = "";
};

window.clearPendingCheckFile = function() {
  _pendingCheckFile = null;
  const preview = document.getElementById("pendingCheckFilePreview");
  if (preview) preview.style.display = "none";
};

window.addCheck = async function(pid, sp) {
  const input = document.getElementById("newCheckItem"); if (!input) return;
  const text  = input.value.trim(); if (!text) return;
  const p     = allProjects().find(x => x.id === pid); if (!p) return;
  const cl    = { ...p.checklist || {} };
  const id    = "c" + Date.now();
  cl[id] = { text, done: false };
  // Attach pending file — upload raw File to Storage, store URL
  if (_pendingCheckFile) {
    try {
      const res = await uploadChecklistFile(pid, id, _pendingCheckFile.file);
      cl[id].fileName = res.fileName;
      cl[id].fileType = res.fileType;
      cl[id].fileUrl  = res.url;
      cl[id].filePath = res.path;
    } catch(err) {
      console.error("[Checklist] File upload failed:", err);
      alert("File upload failed: " + (err.message || err));
      return;
    }
  }
  await updateProject(sp || p.space || "email", pid, { checklist: cl });
  input.value = "";
  _pendingCheckFile = null;
  const preview = document.getElementById("pendingCheckFilePreview");
  if (preview) preview.style.display = "none";
  openDetail(allProjects().find(x => x.id === pid));
};
window.deleteCheck = async function(pid, cid, sp) {
  const p=allProjects().find(x=>x.id===pid); if(!p) return;
  const cl={...p.checklist||{}}; delete cl[cid];
  await updateProject(sp||p.space||"email",pid,{checklist:cl});
  openDetail(allProjects().find(x=>x.id===pid));
};

window.attachCheckFile = async function(event, pid, cid, sp) {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 50*1024*1024) { alert("File too large — max 50MB"); return; }
  const p  = allProjects().find(x => x.id === pid); if (!p) return;
  const cl = { ...p.checklist || {} };
  if (!cl[cid]) return;
  // Delete old file from Storage if replacing
  if (cl[cid].filePath) await deleteStorageFile(cl[cid].filePath);
  const res = await uploadChecklistFile(pid, cid, file);
  cl[cid].fileName = res.fileName;
  cl[cid].fileType = res.fileType;
  cl[cid].fileUrl  = res.url;
  cl[cid].filePath = res.path;
  cl[cid].fileData = null; // clear legacy base64
  await updateProject(sp || p.space || "email", pid, { checklist: cl });
  openDetail(allProjects().find(x => x.id === pid));
};

window.removeCheckFile = async function(pid, cid, sp) {
  const p  = allProjects().find(x => x.id === pid); if (!p) return;
  const cl = { ...p.checklist || {} };
  if (!cl[cid]) return;
  // Delete from Storage
  if (cl[cid].filePath) await deleteStorageFile(cl[cid].filePath);
  delete cl[cid].fileName; delete cl[cid].fileType;
  delete cl[cid].fileUrl;  delete cl[cid].filePath;
  delete cl[cid].fileData;
  await updateProject(sp || p.space || "email", pid, { checklist: cl });
  openDetail(allProjects().find(x => x.id === pid));
};

window.viewCheckFile = function(pid, cid) {
  const p  = allProjects().find(x => x.id === pid); if (!p) return;
  const cl = p.checklist || {};
  const ch = cl[cid];
  const src = ch?.fileUrl || ch?.fileData;
  if (!src) return;

  // Use the file review modal in simple mode (no versioning for checklist files)
  document.getElementById("fvTitle").textContent   = ch.fileName || "File";
  document.getElementById("fvMeta").textContent    = "Checklist attachment";
  document.getElementById("fvDownloadAll").style.display = "none";
  document.getElementById("fvFileTabs").style.display    = "none";
  document.getElementById("fvVersionStrip").style.display = "none";
  document.getElementById("fvCommentsPanel").style.display = "none";

  const prevEl = document.getElementById("fvPreview");
  if (ch.fileType?.includes("image")) {
    prevEl.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;display:block;margin:auto"/>`;
  } else if (ch.fileType?.includes("pdf")) {
    prevEl.innerHTML = `<iframe src="${src}" style="width:100%;height:100%;min-height:400px;border:none;border-radius:8px"></iframe>`;
  } else {
    prevEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--text-2)">
      <span style="font-size:56px">📄</span>
      <div style="font-size:13px;font-weight:500">${ch.fileName}</div>
      <a href="${src}" target="_blank" rel="noopener" download="${ch.fileName}" class="btn-primary"
         style="display:inline-block;text-decoration:none;padding:8px 16px;background:var(--purple);color:white;border-radius:var(--radius-sm)">Download</a>
    </div>`;
  }

  // Simple download-only actions
  document.getElementById("fvActions").innerHTML = `
    <a href="${src}" target="_blank" rel="noopener" download="${ch.fileName}" class="btn-ghost" style="font-size:12px;text-decoration:none">⬇ Download</a>`;

  document.getElementById("fileViewerModal").classList.add("open");
};

// Notify every user in the system (used for new task + published events)
async function notifyAllUsers(titleFn, messageFn, extra = {}) {
  // Use live user list so custom/added users also get notified
  let allUids;
  try {
    const stored = await getAllUsers();
    allUids = [...new Set([...Object.keys(DEFAULT_USERS), ...Object.keys(stored)])];
  } catch(e) {
    allUids = Object.keys(DEFAULT_USERS); // fallback
  }
  await Promise.all(allUids.map(async uid => {
    if (uid === CURRENT_USER) return; // skip self
    try {
      await pushNotification(uid, {
        title:   typeof titleFn   === "function" ? titleFn(uid)   : titleFn,
        message: typeof messageFn === "function" ? messageFn(uid) : messageFn,
        type: extra.type || "general",
        ...extra
      });
      await notifyUser(uid, {
        title:   typeof titleFn   === "function" ? titleFn(uid)   : titleFn,
        message: typeof messageFn === "function" ? messageFn(uid) : messageFn,
        projectName: extra.projectName,
        fromUser: CURRENT_USER,
        type: extra.type || "general"
      });
    } catch(err) { console.error(`[Notif] notifyAllUsers failed for ${uid}:`, err); }
  }));
}

async function sendAssignmentNotif(toUser, project, stageInfo) {
  // toUser may be a single uid (legacy) — always notify all owners of the stage
  const owners = stageInfo.owners && stageInfo.owners.length
    ? stageInfo.owners
    : (toUser ? [toUser] : []);
  const title   = `"${project.name}" assigned to you`;
  const message = `${u_obj.name} added it to ${stageInfo.name}`;
  for (const uid of owners) {
    if (!uid || uid === CURRENT_USER) continue;
    try {
      await pushNotification(uid, { title, message, projectId: project.id, space: project.space||"email", type: "stage" });
      await notifyUser(uid, { title, message, projectName: project.name, fromUser: CURRENT_USER, type: "stage" });
      console.log(`[Notif] Sent assignment notif to ${uid}: ${title}`);
    } catch(err) { console.error("[Notif] sendAssignmentNotif failed:", err); }
  }
}

async function notifyStageChange(project, fromId, toId) {
  const sp = project.space || getCurrentSpace() || "email";

  // Try live SPACES first (includes custom spaces if applyAllSpaceData has run)
  let stages = SPACES[sp]?.stages || BASE_SPACES[sp]?.stages;

  // For custom spaces not yet in SPACES, load config directly from Firebase
  if (!stages) {
    try {
      const cfg = await getSpaceConfig(sp);
      if (cfg?.stages?.length) stages = cfg.stages;
    } catch(e) {}
  }

  if (!stages) {
    console.warn(`[Notif] No stages found for space "${sp}" — skipping notification`);
    return;
  }

  const toStage = stages.find(s => s.id === Number(toId));
  if (!toStage) {
    console.warn(`[Notif] Stage ${toId} not found in space ${sp}`);
    return;
  }

  // Notify all owners of the destination stage (supports multi-person steps)
  const recipients = toStage.owners && toStage.owners.length
    ? toStage.owners
    : (toStage.owner ? [toStage.owner] : []);

  const title   = `"${project.name}" is now with you`;
  const message = `${u_obj.name} moved it to Step ${toId}: ${toStage.name}`;
  for (const recipient of recipients) {
    if (!recipient || recipient === CURRENT_USER) continue;
    try {
      await pushNotification(recipient, { title, message, projectId: project.id, space: project.space||sp, type: "stage" });
      await notifyUser(recipient, { title, message, projectName: project.name, fromUser: CURRENT_USER, type: "stage" });
      console.log(`[Notif] Stage change notif sent to ${recipient} (step ${toId})`);
    } catch(err) { console.error("[Notif] notifyStageChange failed:", err); }
  }
}

// ── Init & subscriptions ───────────────────────────────────────────────────
async function init() {
  await loadSpaceTypes();
  buildTypeButtons();
  buildStageDropdown();
  buildFilterButtons();
  updateSpaceBanner();

  // Fetch Firebase users in background — update ALL_USERS and cache for @mentions
  getAllUsers().then(stored => {
    const merged = { ...DEFAULT_USERS };
    Object.entries(stored).forEach(([k,v]) => { merged[k] = { ...(merged[k]||{}), ...v }; });
    // Update in-place so existing references to ALL_USERS see new users
    Object.assign(ALL_USERS, merged);
    // Persist for instant next load
    cacheUsers(merged);
  }).catch(() => {});

  // Subscribe to space config overrides (name/owner edits from settings)
  // ── Space config + custom spaces — always applied together ──────────────
  // Keeping both pieces of state in sync prevents the race where one
  // subscription fires before the other, wiping the other's changes.
  let _latestSpaceConfigs = {};
  let _latestCustomSpaces  = {};

  function applyAllSpaceData() {
    // Step 1: start from BASE_SPACES
    const fresh = JSON.parse(JSON.stringify(BASE_SPACES));

    // Step 2: overlay config overrides (renamed labels, new stages) for base spaces
    const withConfigs = mergeSpaceConfig(_latestSpaceConfigs, fresh);

    // Step 3: add custom spaces, then apply config overrides to them too
    const withCustom = mergeCustomSpaces(_latestCustomSpaces, withConfigs);

    // Step 4: apply config overrides again for custom space ids
    // (mergeSpaceConfig skips ids not in its base, so we do a targeted pass)
    Object.entries(_latestSpaceConfigs).forEach(([sid, cfg]) => {
      if (!withCustom[sid]) return;
      if (cfg.label)  withCustom[sid].label  = cfg.label;
      if (cfg.color)  withCustom[sid].color  = cfg.color;
      if (cfg.stages && cfg.stages.length) {
        withCustom[sid].stages = cfg.stages.map((sc, i) => ({
          id:          i + 1,
          key:         `s${i + 1}`,
          name:        sc.name        || `Step ${i + 1}`,
          owner:       sc.owner       || "jc",
          owners:      sc.owners      || [sc.owner || "jc"],
          ownersLabel: sc.ownersLabel || [sc.ownerLabel || sc.owner || "JC"],
          ownerLabel:  sc.ownersLabel?.length
            ? sc.ownersLabel.join(", ")
            : (sc.ownerLabel || sc.owner || "JC")
        }));
      }
    });

    // Step 5: replace SPACES in place — keeps existing object reference
    Object.keys(SPACES).forEach(k => delete SPACES[k]);
    Object.assign(SPACES, withCustom);

    // Step 5b: persist to localStorage so next page load renders instantly
    cacheSpaces(withCustom);

    // Step 6: rebuild all board UI that reads from SPACES
    fvRefreshSidebar();
    buildStageDropdown();
    buildFilterButtons();
    buildTypeButtons();
    renderAll();
    updateSpaceBanner();
  }

  // No dedup guards — Firebase onValue fires once on attach (initial data)
  // then again only when data changes. We WANT the initial fire to always
  // apply, so custom spaces appear on every page load without user interaction.
  subscribeSpaceConfigs(configs => {
    _latestSpaceConfigs = configs;

    // Fast path: apply config overrides to SPACES immediately so labels/colors
    // update in sidebar without waiting for the full board rebuild.
    const quickWithConfig = mergeSpaceConfig(configs, { ...SPACES });
    Object.keys(SPACES).forEach(k => delete SPACES[k]);
    Object.assign(SPACES, quickWithConfig);
    fvRefreshSidebar();

    applyAllSpaceData();
  });

  subscribeCustomSpaces(customs => {
    _latestCustomSpaces = customs;

    // ── Fast path: update SPACES and sidebar IMMEDIATELY ──────────────────
    // Do this BEFORE applyAllSpaceData (which rebuilds the whole board) so
    // the sidebar reflects custom spaces the instant Firebase responds.
    const quickMerged = mergeCustomSpaces(customs, { ...BASE_SPACES });
    Object.keys(SPACES).forEach(k => delete SPACES[k]);
    Object.assign(SPACES, quickMerged);
    cacheSpaces(quickMerged);       // persist so next load is instant
    fvRefreshSidebar();             // sidebar updated NOW — no board rebuild needed

    // Subscribe to projects in each custom space
    Object.keys(customs).forEach(sid => {
      if (!projectsBySpace[sid]) {
        projectsBySpace[sid] = [];
        subscribeProjects(sid, projects => {
          projectsBySpace[sid] = projects;
          renderAll();
        });
      }
    });

    // Full apply (applies spaceConfig overrides, rebuilds board UI)
    applyAllSpaceData();
  });

  ["email","pdf","prints"].forEach(sp => {
    subscribeProjects(sp, projects => {
      projectsBySpace[sp] = projects;
      // Sync fileReviews into local cache
      projects.forEach(p => { if (p.fileReviews) fvSyncFromFirebase(p); });
      // If another user uploaded a new version, clear local version cache
      if (_fvProjectId) {
        const cur = projects.find(x => x.id === _fvProjectId);
        if (cur) {
          const cached = _vcGet();
          if (cached) {
            const fbSlot = fvGetSlot(cur, _fvFileIdx);
            const fbLen  = (fbSlot?.versions || []).length;
            if (fbLen > cached.length) { _vcClear(); }
          }
        }
      }
      renderAll();
    });
  });

  subscribeNotifications(CURRENT_USER, notifs => {
    notifications = notifs;
    renderNotifDropdown();
  });
}
init();

// ── Presence — mark self online for all pages ─────────────────
setPresence(CURRENT_USER, true);
window.addEventListener("beforeunload", () => setPresence(CURRENT_USER, false));

// ── Auto-highlight project from notification quick action ──────
(function checkHighlight() {
  const pid = sessionStorage.getItem("highlightProject");
  if (!pid) return;
  sessionStorage.removeItem("highlightProject");
  // Wait for projects to load then open the card
  const attempts = setInterval(() => {
    const p = allProjects().find(x => x.id === pid);
    if (p) {
      clearInterval(attempts);
      openDetail(p.id, p.space || "email");
      // Scroll to card
      const card = document.querySelector(`[data-pid="${pid}"]`);
      if (card) card.scrollIntoView({ behavior:"smooth", block:"center" });
    }
  }, 300);
  setTimeout(() => clearInterval(attempts), 8000); // give up after 8s
})();

// Update board minWidth on resize
window.addEventListener("resize", () => {
  const board = document.getElementById("board");
  if (!board) return;
  if (board.classList.contains("board-7")) {
    board.style.minWidth = window.innerWidth <= 768 ? "unset" : "1700px";
  }
});

// Mobile stage collapse — CSS handles the arrow via ::after
function initMobileStages() {
  if (window.innerWidth > 768) return;
  document.querySelectorAll(".stage-col").forEach(col => {
    const head = col.querySelector(".stage-head");
    if (!head || head.dataset.mi) return;
    head.dataset.mi = "1";
    // Auto-collapse empty stages
    const count = parseInt(col.querySelector(".stage-count")?.textContent || "0");
    if (count === 0) col.classList.add("collapsed");
    head.addEventListener("click", () => col.classList.toggle("collapsed"));
  });
}
const boardObs = new MutationObserver(() => setTimeout(initMobileStages, 50));
const boardEl  = document.getElementById("board");
if (boardEl) boardObs.observe(boardEl, { childList: true });
window.addEventListener("resize", () => {
  // On resize to desktop, remove collapsed state
  if (window.innerWidth > 768) {
    document.querySelectorAll(".stage-col.collapsed").forEach(col => col.classList.remove("collapsed"));
  } else {
    initMobileStages();
  }
  // Update board minWidth
  const board = document.getElementById("board");
  if (board && board.classList.contains("board-7")) {
    board.style.minWidth = window.innerWidth <= 768 ? "unset" : "1700px";
  }
});
