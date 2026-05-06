import { subscribeProjects, subscribeCustomSpaces } from "./firebase.js";
import {
  SPACES, BASE_SPACES, DEFAULT_USERS,
  getCurrentSpace, statusClass, formatDate, timeAgo
} from "./helpers.js";

const projectsBySpace = { email: [], pdf: [], prints: [] };
const subscribedSpaces = new Set();
let archiveOpen = false;
let renderQueued = false;
let isRendering = false;
let suppressMutation = false;
let archiveInitialized = false;
const ARCHIVE_STYLES_ATTR = "data-app-previous-projects-styles";

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[ch]);
}

function safeColor(value) {
  const color = String(value || "");
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : "#7c5cbf";
}

function typeBadgeClass(type) {
  const map = {
    Newsletter: "badge-news",
    Blog: "badge-blog",
    "Case Study": "badge-case",
    Report: "badge-rept",
    eBook: "badge-ebk",
    Presentation: "badge-pres",
    Book: "badge-book",
    Tarpaulin: "badge-tarp",
    Cards: "badge-card"
  };
  return map[type] || "badge-custom";
}

function allProjects() {
  return Object.values(projectsBySpace).flat();
}

function getPublishedMeta(project) {
  const publishedEvent = (project.history || []).slice().reverse().find(h => h.action === "published");
  return {
    timestamp: publishedEvent?.timestamp || project.updatedAt || project.createdAt || 0,
    by: publishedEvent?.by || project.updatedBy || project.createdBy || ""
  };
}

function publishedProjects() {
  const space = getCurrentSpace();
  const source = space === "all" ? allProjects() : projectsBySpace[space] || [];
  return source
    .filter(project => project.status === "Published")
    .sort((a, b) => getPublishedMeta(b).timestamp - getPublishedMeta(a).timestamp);
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderArchive();
  });
}

function renderArchive() {
  const toggle = document.getElementById("completedToggle");
  const list = document.getElementById("completedList");
  if (!toggle || !list) return;
  ensureArchiveHeader();

  const projects = publishedProjects();
  const space = getCurrentSpace();
  const archiveScope = space === "all" ? "all spaces" : `${SPACES[space]?.label || space} space`;

  isRendering = true;
  suppressMutation = true;
  toggle.textContent = archiveOpen ? `Hide archive (${projects.length})` : `View archive (${projects.length})`;
  list.style.display = archiveOpen ? "block" : "none";

  if (!archiveOpen) {
    isRendering = false;
    requestAnimationFrame(() => { suppressMutation = false; });
    return;
  }

  if (!projects.length) {
    list.innerHTML = `<div class="project-archive-empty">No previous projects yet. Published projects will appear here automatically.</div>`;
    isRendering = false;
    requestAnimationFrame(() => { suppressMutation = false; });
    return;
  }

  list.innerHTML = `
    <div class="project-archive-summary">
      <div>
        <div class="project-archive-count">${projects.length}</div>
        <div class="project-archive-label">Previous project${projects.length === 1 ? "" : "s"} in ${escapeText(archiveScope)}</div>
      </div>
      <div class="project-archive-hint">Newest published first</div>
    </div>
    <div class="project-archive-grid">${projects.map(project => {
      const meta = getPublishedMeta(project);
      const spaceId = project.space || "email";
      const spaceConfig = SPACES[spaceId] || BASE_SPACES[spaceId] || {};
      const spaceColor = safeColor(spaceConfig.color || "#7c5cbf");
      const when = meta.timestamp ? timeAgo(meta.timestamp) : "Published";
      const publishedBy = meta.by ? (DEFAULT_USERS[meta.by]?.name || meta.by) : "Team";
      const due = project.due ? formatDate(project.due) : "No due date";
      const type = project.type || "Project";
      return `
        <button class="project-archive-card" data-project-id="${escapeText(project.id)}">
          <div class="project-archive-card-top">
            <span class="completed-check" aria-hidden="true">&#10003;</span>
            <span class="project-archive-space" style="--archive-space:${spaceColor}">${escapeText(spaceConfig.label || spaceId)}</span>
          </div>
          <div class="project-archive-name">${escapeText(project.name)}</div>
          <div class="project-archive-meta">
            <span class="badge ${typeBadgeClass(type)}">${escapeText(type)}</span>
            <span class="badge ${statusClass(project.status || "Published")}">Published</span>
          </div>
          <div class="project-archive-foot">
            <span>${escapeText(when)} by ${escapeText(publishedBy)}</span>
            <span>${escapeText(due)}</span>
          </div>
        </button>`;
    }).join("")}</div>`;
  isRendering = false;
  requestAnimationFrame(() => { suppressMutation = false; });
}

function ensureArchiveHeader() {
  const header = document.querySelector(".completed-header");
  if (!header || header.dataset.archiveReady === "true") return;
  const title = header.querySelector("h3");
  if (title) title.textContent = "Previous projects";
  if (!header.querySelector(".completed-subtitle")) {
    const wrap = document.createElement("div");
    const subtitle = document.createElement("p");
    subtitle.className = "completed-subtitle";
    subtitle.textContent = "Completed / published archive";
    if (title) {
      title.replaceWith(wrap);
      wrap.appendChild(title);
      wrap.appendChild(subtitle);
    }
  }
  header.dataset.archiveReady = "true";
}

function subscribeSpace(spaceId) {
  if (!spaceId || subscribedSpaces.has(spaceId)) return;
  subscribedSpaces.add(spaceId);
  if (!projectsBySpace[spaceId]) projectsBySpace[spaceId] = [];
  subscribeProjects(spaceId, projects => {
    projectsBySpace[spaceId] = projects;
    queueRender();
  });
}

window.openPreviousProjectFromArchive = function(projectId) {
  const project = allProjects().find(p => p.id === projectId);
  if (project && typeof window.openDetail === "function") window.openDetail(project);
};

function initPreviousProjectsArchive() {
  if (archiveInitialized) return;
  archiveInitialized = true;
  installArchiveStyles();
  ["email", "pdf", "prints"].forEach(subscribeSpace);
  subscribeCustomSpaces(customs => {
    Object.keys(customs || {}).forEach(subscribeSpace);
    queueRender();
  });

  window.toggleCompleted = function() {
    archiveOpen = !archiveOpen;
    renderArchive();
  };

  const originalSwitchSpace = window.switchSpace;
  if (typeof originalSwitchSpace === "function") {
    window.switchSpace = async function(...args) {
      const result = await originalSwitchSpace.apply(this, args);
      queueRender();
      return result;
    };
  }

  document.getElementById("completedList")?.addEventListener("click", event => {
    const card = event.target.closest(".project-archive-card");
    if (!card) return;
    window.openPreviousProjectFromArchive(card.dataset.projectId);
  });

  const section = document.querySelector(".completed-section");
  if (section) {
    new MutationObserver(() => {
      if (!isRendering && !suppressMutation) queueRender();
    }).observe(section, { childList: true, subtree: true, attributes: true });
  }

  renderArchive();
}

function waitForBoardReady(attempt = 0) {
  const hasArchiveHost = document.getElementById("completedToggle") && document.getElementById("completedList");
  const appReady = typeof window.openDetail === "function" && typeof window.switchSpace === "function";
  if ((!hasArchiveHost || !appReady) && attempt < 100) {
    setTimeout(() => waitForBoardReady(attempt + 1), 50);
    return;
  }
  initPreviousProjectsArchive();
}

waitForBoardReady();

function installArchiveStyles() {
  if (document.querySelector(`link[${ARCHIVE_STYLES_ATTR}]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../css/archive-polish.css", import.meta.url).href;
  link.setAttribute(ARCHIVE_STYLES_ATTR, "true");
  document.head.appendChild(link);
}
