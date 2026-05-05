// APP Tracker v33 — Firebase Storage (no more base64)
import {
  createProject, updateProject, deleteProject, subscribeProjects,
  getSpaceTypes, saveSpaceTypes, pushNotification,
  subscribeNotifications, markNotifRead, clearNotifications,
  subscribeSpaceConfigs, subscribeCustomSpaces, setPresence, subscribePresence
} from "./firebase.js";
import { notifyUser } from "./notify.js";
import { uploadProjectFile, uploadChecklistFile, deleteStorageFile } from "./storage.js";
import {
  SPACES, BASE_SPACES, DEFAULT_USERS, STATUS_LIST, statusClass, priorityClass, PRIORITY_LEVELS,
  formatDate, timeAgo, authGuard, getCurrentSpace, setCurrentSpace,
  setupSidebar, setupNotifBadge, initTheme, updateThemeBtn, toggleTheme,
  mergeSpaceConfig, mergeCustomSpaces
} from "./helpers.js";
import { renderSidebar, renderBottomNav } from "./sidebar.js";

const CURRENT_USER = authGuard();
if (!CURRENT_USER) throw new Error("not auth");
const u_obj = DEFAULT_USERS[CURRENT_USER] || { name: CURRENT_USER, av: "?", cls: "av-jc" };

document.getElementById("appShell").insertAdjacentHTML("afterbegin", renderSidebar("dashboard", getCurrentSpace()));
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

let projectsBySpace = { email:[], pdf:[], prints:[] };
let notifications   = [];
let editingId       = null;
let activeFilter    = "all";
let completedOpen   = false;
let dragSrcId       = null;
let spaceTypes      = [];
let pendingFile     = null;
let fileRemoved     = false;
let chartInstance   = null;
let chartMode       = "stage";

// ── Helpers ────────────────────────────────────────────────────────────────
function allProjects() { return [...projectsBySpace.email, ...projectsBySpace.pdf, ...projectsBySpace.prints]; }
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
    const matches = Object.entries(DEFAULT_USERS).filter(([uid, u]) => {
      const name = (u.name || uid).toLowerCase();
      return query === "" || name.includes(query) || uid.includes(query);
    });
    if (!matches.length) { popup.style.display = "none"; return; }
    _notesMentionIdx = 0;
    popup.innerHTML = matches.map(([uid, u], i) => `
      <div class="mention-item ${i===0?"active":""}" data-uid="${uid}" onclick="insertNotesMention('${uid}')">
        <div class="av av-sm ${u.cls||'av-jc'}">${u.av}</div>
        <div><div class="mention-name">${u.name}</div><div class="mention-role">${u.role}</div></div>
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
  const u    = DEFAULT_USERS[uid] || { name: uid };
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
  sidebar.outerHTML = renderSidebar("dashboard", spaceId);
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
    const spaces = ["email","pdf","prints"];
    board.innerHTML = spaces.map(sid => {
      const sp      = SPACES[sid];
      const sproj   = projectsBySpace[sid] || [];
      const sactive = sproj.filter(p => p.status !== "Published");
      const smine   = sactive.filter(p => sp.stages.find(st => st.id===Number(p.stage))?.owner===CURRENT_USER).length;
      const spub    = sproj.filter(p => p.status==="Published").length;
      const sod     = sactive.filter(p => p.due && new Date(p.due+"T00:00:00") < today).length;
      return `
        <div class="space-overview-card" onclick="switchSpace('${sid}')">
          <div class="space-overview-header">
            <div class="space-overview-dot" style="background:${SPACE_COLORS[sid]}"></div>
            <div class="space-overview-name">${sp.label} Space</div>
            <div style="margin-left:auto;font-size:11px;color:var(--text-3)">${sactive.length} active</div>
          </div>
          <div class="space-overview-stats">
            <div class="space-ov-stat">
              <div class="space-ov-val" style="color:${SPACE_COLORS[sid]}">${sactive.length}</div>
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
          <div style="margin-top:10px;text-align:right;font-size:12px;color:${SPACE_COLORS[sid]};font-weight:500">Open space →</div>
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
        <div class="stage-head-inner">
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
  const fileLink  = p.fileName ? `<button class="tc-link" style="background:none;border:none;cursor:pointer" onclick="event.stopPropagation();viewFile('${p.id}')">📄 ${p.fileName}</button>` : "";

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
    ${fileLink ? `<div class="tc-links">${fileLink}</div>` : ""}
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

// ── File handling ──────────────────────────────────────────────────────────
window.handleFileSelect = function(event) {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 50*1024*1024) { alert("File too large — max 50MB"); return; }
  // Store the raw File object — upload to Firebase Storage on save (no base64)
  pendingFile = { file, name:file.name, type:file.type, size:file.size };
  document.getElementById("attachedFilePreview").innerHTML = `
    <div class="attached-file">
      <div class="file-icon">${fileIcon(file.type)}</div>
      <div class="file-name">${file.name}</div>
      <div class="file-size">${(file.size/1024/1024).toFixed(1)}MB</div>
      <button class="file-remove-btn" onclick="removePendingFile()">✕ Remove</button>
    </div>`;
};
window.removePendingFile = () => { pendingFile=null; fileRemoved=true; document.getElementById("attachedFilePreview").innerHTML=""; document.getElementById("fileInput").value=""; };
function fileIcon(type) { if (!type) return "📄"; if (type.includes("pdf")) return "📄"; if (type.includes("image")) return "🖼"; return "📝"; }

window.viewFile = function(projectId) {
  const p = allProjects().find(x => x.id === projectId);
  const src = p?.fileUrl || p?.fileData; // support legacy base64 too
  if (!src) return;
  document.getElementById("fileViewerTitle").textContent = p.fileName||"File";
  const body = document.getElementById("fileViewerBody");
  if (p.fileType?.includes("image")) {
    body.innerHTML = `<img src="${src}" style="max-width:100%;border-radius:8px"/>`;
  } else if (p.fileType?.includes("pdf")) {
    body.innerHTML = `<iframe src="${src}" style="width:100%;height:500px;border:none;border-radius:8px"></iframe>`;
  } else {
    body.innerHTML = `<div style="text-align:center;padding:2rem">
      <div style="font-size:48px">${fileIcon(p.fileType)}</div>
      <div style="margin-top:12px;font-size:14px;color:var(--text-2)">${p.fileName}</div>
      <a href="${src}" target="_blank" rel="noopener" download="${p.fileName}" class="btn-primary"
         style="display:inline-block;margin-top:14px;text-decoration:none;padding:8px 16px;background:var(--purple);color:white;border-radius:var(--radius-sm)">
        Download
      </a></div>`;
  }
  document.getElementById("fileViewerModal").classList.add("open");
};

const uploadArea = document.getElementById("fileUploadArea");
if (uploadArea) {
  uploadArea.addEventListener("dragover",  e => { e.preventDefault(); uploadArea.classList.add("dragging"); });
  uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("dragging"));
  uploadArea.addEventListener("drop", e => {
    e.preventDefault(); uploadArea.classList.remove("dragging");
    const file = e.dataTransfer.files[0];
    if (file) { const dt=new DataTransfer(); dt.items.add(file); document.getElementById("fileInput").files=dt.files; handleFileSelect({target:{files:[file]}}); }
  });
}

// ── Project modal ──────────────────────────────────────────────────────────
window.openNewProject = function(stageId=1) {
  try {
    editingId=null; pendingFile=null; fileRemoved=false;
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
window.closeModal = () => { document.getElementById("projectModal").classList.remove("open"); pendingFile=null; fileRemoved=false; };
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
  try {
    const data = { name,type,status,priority,stage,due,links,notes,space:s };

    if (pendingFile) {
      // Upload raw file to Firebase Storage — store URL, not base64
      btn.textContent = "Uploading…";
      const projectId = editingId || `temp_${Date.now()}`;
      // Delete old file from Storage if replacing
      const oldProject = editingId ? allProjects().find(p => p.id === editingId) : null;
      if (oldProject?.filePath) await deleteStorageFile(oldProject.filePath);

      const result = await uploadProjectFile(projectId, pendingFile.file);
      data.fileName = result.fileName;
      data.fileType = result.fileType;
      data.fileUrl  = result.url;      // ← Storage URL, tiny string
      data.filePath = result.path;     // ← Storage path for deletion later
      data.fileSize = result.fileSize;
      data.fileData = null;            // ← clear any old base64
    } else if (fileRemoved) {
      // Delete from Storage and clear all file fields
      const oldProject = editingId ? allProjects().find(p => p.id === editingId) : null;
      if (oldProject?.filePath) await deleteStorageFile(oldProject.filePath);
      data.fileName = null; data.fileType = null;
      data.fileUrl  = null; data.filePath = null;
      data.fileData = null; data.fileSize = null;
    }
    if (editingId) {
      const prev = allProjects().find(p => p.id===editingId);
      if (!prev) { console.warn('editProject: project not found', editingId); }
      if (prev && Number(prev?.stage)!==stage) {
        const hist=prev.history||[];
        hist.push({action:"moved",by:CURRENT_USER,from:Number(prev.stage),stage,timestamp:Date.now()});
        data.history=hist;
        await notifyStageChange(prev,Number(prev.stage),stage);
      }
      await updateProject(s,editingId,data); editingId=null; fileRemoved=false;
      // Notify @mentions in notes (new mentions only)
      if (notes) {
        const prevNotes = prev?.notes || "";
        const newMentions = extractMentions(notes).filter(uid => !extractMentions(prevNotes).includes(uid));
        for (const uid of newMentions) {
          if (uid === CURRENT_USER) continue;
          await pushNotification(uid, { title:`${u_obj.name} mentioned you in "${data.name}"`, message:`Notes: "${notes.slice(0,80)}"`, type:"mention" });
          await notifyUser(uid, { title:`${u_obj.name} mentioned you in a task`, message:`"${data.name}" — ${notes.slice(0,80)}`, projectName:data.name, fromUser:CURRENT_USER });
        }
      }
    } else {
      const project  = await createProject({...data,createdBy:CURRENT_USER});
      const stageInfo = (SPACES[s]?.stages || []).find(st=>st.id===stage);
      // Notify assigned stage owners
      if (stageInfo) await sendAssignmentNotif(stageInfo.owner, project, stageInfo);
      // Notify ALL users that a new task was created
      await notifyAllUsers(
        `New task added: "${data.name}"`,
        `${u_obj.name} created a new task in ${SPACES[s]?.label || s} — Step ${stage}: ${stageInfo?.name || ""}`,
        { projectId: project.id, space: project.space||"email", projectName: data.name, type: "new_task" }
      );
      // Notify @mentions in notes on creation
      if (notes) {
        for (const uid of extractMentions(notes)) {
          if (uid === CURRENT_USER) continue;
          await pushNotification(uid, { title:`${u_obj.name} mentioned you in "${data.name}"`, message:`"${notes.slice(0,80)}"`, type:"mention" });
          await notifyUser(uid, { title:`${u_obj.name} mentioned you in a task`, message:`"${data.name}" — ${notes.slice(0,80)}`, projectName:data.name, fromUser:CURRENT_USER });
        }
      }
    }
  } catch(err) {
    console.error('saveProject error:', err);
    alert('Error saving project: ' + (err.message || err));
    btn.textContent = editingId ? "Update project" : "Save project";
    btn.disabled = false;
    return;
  }
  btn.textContent = editingId ? "Update project" : "Save project";
  btn.disabled=false;
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
      <div class="detail-field"><div class="df-label">Space</div><div class="df-val"><span class="space-banner space-banner-${sp}" style="background:${SPACE_COLORS[sp]}22;color:${SPACE_COLORS[sp]};font-size:11px;padding:2px 8px;border-radius:10px">${SPACES[sp]?.label||sp}</span></div></div>
      <div class="detail-field"><div class="df-label">Due date</div><div class="df-val">${p.due?formatDate(p.due):"—"}</div></div>
      ${p.fileName?`<div class="detail-field"><div class="df-label">File</div><div class="df-val"><button class="file-open-btn" onclick="viewFile('${p.id}')">Open ${p.fileName}</button></div></div>`:""}
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
    editingId=id; pendingFile=null; fileRemoved=false;
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
  document.getElementById("attachedFilePreview").innerHTML=p.fileName?`<div class="attached-file"><div class="file-icon">${fileIcon(p.fileType)}</div><div class="file-name">${p.fileName}</div><button class="file-remove-btn" onclick="removePendingFile()" title="Remove file — you can then upload a new one">✕ Remove</button></div>`:"";
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
  const p=allProjects().find(x=>x.id===id);
  await deleteProject(sp||p?.space||"email",id);
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
  const reader = new FileReader();
  reader.onload = e => {
    _pendingCheckFile = { name: file.name, type: file.type, data: e.target.result };
    const preview = document.getElementById("pendingCheckFilePreview");
    const nameEl  = document.getElementById("pendingCheckFileName");
    if (preview) preview.style.display = "flex";
    if (nameEl)  nameEl.textContent    = file.name;
  };
  reader.readAsDataURL(file);
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
  // Attach pending file — upload to Storage, store URL
  if (_pendingCheckFile) {
    const res = await uploadChecklistFile(pid, id, _pendingCheckFile.file);
    cl[id].fileName = res.fileName;
    cl[id].fileType = res.fileType;
    cl[id].fileUrl  = res.url;
    cl[id].filePath = res.path;
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
  document.getElementById("fileViewerTitle").textContent = ch.fileName || "File";
  const body = document.getElementById("fileViewerBody");
  if (ch.fileType?.includes("image")) {
    body.innerHTML = `<img src="${src}" style="max-width:100%;border-radius:8px"/>`;
  } else if (ch.fileType?.includes("pdf")) {
    body.innerHTML = `<iframe src="${src}" style="width:100%;height:500px;border:none;border-radius:8px"></iframe>`;
  } else {
    body.innerHTML = `<div style="text-align:center;padding:2rem">
      <div style="font-size:48px">📄</div>
      <div style="margin-top:12px;font-size:14px;color:var(--text-2)">${ch.fileName}</div>
      <a href="${src}" target="_blank" rel="noopener" download="${ch.fileName}" class="btn-primary"
         style="display:inline-block;margin-top:14px;text-decoration:none;padding:8px 16px;background:var(--purple);color:white;border-radius:var(--radius-sm)">Download</a>
    </div>`;
  }
  document.getElementById("fileViewerModal").classList.add("open");
};

// Notify every user in the system (used for new task + published events)
async function notifyAllUsers(titleFn, messageFn, extra = {}) {
  const allUids = Object.keys(DEFAULT_USERS);
  await Promise.all(allUids.map(async uid => {
    if (uid === CURRENT_USER) return; // skip self
    try {
      await pushNotification(uid, {
        title: typeof titleFn === "function" ? titleFn(uid) : titleFn,
        message: typeof messageFn === "function" ? messageFn(uid) : messageFn,
        type: extra.type || "general",
        ...extra
      });
      await notifyUser(uid, {
        title: typeof titleFn === "function" ? titleFn(uid) : titleFn,
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
  // Get the space — fall back through multiple sources
  const sp = project.space || getCurrentSpace() || "email";

  // Try live SPACES first, then BASE_SPACES, then hardcoded defaults
  let stages = SPACES[sp]?.stages || BASE_SPACES[sp]?.stages;

  // If stages still not found, use email stages as fallback
  if (!stages) stages = BASE_SPACES.email.stages;

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

  // Subscribe to space config overrides (name/owner edits from settings)
  let _lastSpaceConfigJson = "";
  subscribeSpaceConfigs(configs => {
    const json = JSON.stringify(configs);
    if (json === _lastSpaceConfigJson) return; // no-op if unchanged
    _lastSpaceConfigJson = json;
    const merged = mergeSpaceConfig(configs);
    Object.assign(SPACES, merged);
    renderAll();
    updateSpaceBanner();
  });

  // Subscribe to custom spaces so board reflects added/updated custom spaces
  let _lastCustomJson = "";
  subscribeCustomSpaces(customs => {
    const json = JSON.stringify(customs);
    if (json === _lastCustomJson) return;
    _lastCustomJson = json;
    // Merge custom spaces into SPACES
    const withCustom = mergeCustomSpaces(customs, SPACES);
    Object.assign(SPACES, withCustom);
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
    renderAll();
    updateSpaceBanner();
  });

  ["email","pdf","prints"].forEach(sp => {
    subscribeProjects(sp, projects => {
      projectsBySpace[sp] = projects;
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
