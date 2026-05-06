const MOBILE_POLISH_LINK_ATTR = "data-app-mobile-polish";
const DESKTOP_POLISH_LINK_ATTR = "data-app-desktop-polish";
const MOBILE_CHAT_PANEL_FIX_ATTR = "data-app-chat-panel-fix";
const PREVIOUS_PROJECTS_MODULE_ATTR = "data-app-previous-projects";

function installMobilePolish() {
  const pageFile = (window.location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") || "index";
  if (document.body) document.body.dataset.page = pageFile;

  const href = new URL("../css/mobile-polish.css", import.meta.url).href;
  if (!document.querySelector(`link[${MOBILE_POLISH_LINK_ATTR}]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(MOBILE_POLISH_LINK_ATTR, "true");
    document.head.appendChild(link);
  }

  const desktopHref = new URL("../css/desktop-polish.css", import.meta.url).href;
  if (!document.querySelector(`link[${DESKTOP_POLISH_LINK_ATTR}]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = desktopHref;
    link.setAttribute(DESKTOP_POLISH_LINK_ATTR, "true");
    document.head.appendChild(link);
  }

  if (pageFile === "dashboard" && !document.querySelector(`script[${PREVIOUS_PROJECTS_MODULE_ATTR}]`)) {
    const script = document.createElement("script");
    script.type = "module";
    script.src = new URL("./previous-projects.js", import.meta.url).href;
    script.setAttribute(PREVIOUS_PROJECTS_MODULE_ATTR, "true");
    document.head.appendChild(script);
  }

  if (!document.querySelector(`style[${MOBILE_CHAT_PANEL_FIX_ATTR}]`)) {
    const style = document.createElement("style");
    style.setAttribute(MOBILE_CHAT_PANEL_FIX_ATTR, "true");
    style.textContent = `@media (max-width: 768px) {
      body[data-page="chat"] .members-panel {
        position: absolute !important;
        left: 0 !important;
        right: 0 !important;
        top: auto !important;
        bottom: 0 !important;
        height: 70% !important;
        z-index: 20;
        pointer-events: none;
      }
      body[data-page="chat"] .members-panel.open {
        pointer-events: auto;
      }
    }`;
    document.head.appendChild(style);
  }
}

installMobilePolish();

try {
  const firebaseHelpers = await import("./firebase.js");
  globalThis.subscribeCustomSpaces ??= firebaseHelpers.subscribeCustomSpaces;
  globalThis.subscribeSpaceConfigs ??= firebaseHelpers.subscribeSpaceConfigs;
} catch (err) {
  console.warn("[APP] Sidebar space sync unavailable", err);
}

export function renderSidebar(activePage, activeSpace, extraSpaces = {}) {
  const BASE_IDS = ['email', 'pdf', 'prints'];
  const BASE_COLORS = { email:'#7c5cbf', pdf:'#2aab6f', prints:'#e0694a' };

  // extraSpaces can be the full SPACES object from helpers.js
  // Build ordered list: base spaces first, then custom spaces
  const allSpaces = [];
  const seen = new Set();

  // Always include the 3 base spaces in fixed order
  for (const id of BASE_IDS) {
    const s = extraSpaces[id];
    allSpaces.push({
      id,
      label: s?.label || { email:'Email', pdf:'PDF', prints:'Prints' }[id],
      color: s?.color || BASE_COLORS[id]
    });
    seen.add(id);
  }

  // Add any custom spaces (keys not in BASE_IDS)
  for (const [id, s] of Object.entries(extraSpaces)) {
    if (seen.has(id)) continue;
    allSpaces.push({ id, label: s.label || id, color: s.color || '#3b7dd8' });
    seen.add(id);
  }

  const spaceItems = allSpaces.map(s => `
    <div class="space-nav-item ${activeSpace===s.id?'active':''}" data-space="${s.id}"
      style="${activeSpace===s.id?`color:${s.color}`:''}"
      onclick="switchSpace('${s.id}')">
      <span class="space-dot" style="background:${s.color};${activeSpace===s.id?'box-shadow:0 0 0 3px rgba(255,255,255,.2)':''}"></span>
      ${s.label}
    </div>`).join('');

  return `
<div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>
<aside class="sidebar" id="sidebar">
  <div class="sidebar-brand">
    <img src="../assets/logo.png" class="sidebar-brand-logo" onerror="this.style.display='none'"/>
    <div class="sidebar-brand-text">
      <div class="sidebar-brand-name">APP Project Management</div>
      <div class="sidebar-brand-creator">Created by JC A.</div>
    </div>
  </div>

  <div class="sidebar-section">
    <div class="sidebar-section-label">Spaces</div>
    <div class="space-nav-item ${activeSpace==='all'?'active':''}" data-space="all"
      style="${activeSpace==='all'?'color:#3b7dd8':''}"
      onclick="switchSpace('all')">
      <span class="space-dot" style="background:#3b7dd8;${activeSpace==='all'?'box-shadow:0 0 0 3px rgba(255,255,255,.2)':''}"></span>
      All spaces
    </div>
    ${spaceItems}
    <div class="nav-item" onclick="openAddSpaceModal()" style="margin-top:4px;font-size:12px;color:rgba(255,255,255,.4)">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      Add space
    </div>
  </div>

  <div class="sidebar-section">
    <div class="sidebar-section-label">Workspace</div>
    <div class="nav-item ${activePage==='main-dashboard'?'active':''}" onclick="closeSidebar();location.href='main-dashboard.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="6" height="4" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="7" width="6" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="1" width="5" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="13" width="5" height="1" rx=".5" stroke="currentColor" stroke-width="1.3"/></svg>
      Main dashboard
    </div>
    <div class="nav-item ${activePage==='dashboard'?'active':''}" onclick="closeSidebar();location.href='dashboard.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="8.5" y="1" width="5.5" height="5.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/></svg>
      Board
    </div>
    <div class="nav-item ${activePage==='chat'?'active':''}" onclick="closeSidebar();location.href='chat.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M13 7A6 6 0 001 7c0 1.2.35 2.3.96 3.23L1 13l2.77-.96A6 6 0 0013 7z" stroke="currentColor" stroke-width="1.3"/></svg>
      Chat
    </div>
    <div class="nav-item ${activePage==='email-builder'?'active':''}" onclick="closeSidebar();location.href='email-builder.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1 3.5A1.5 1.5 0 012.5 2h10A1.5 1.5 0 0114 3.5v8a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 011 11.5v-8z" stroke="currentColor" stroke-width="1.3"/><path d="M1 4l6.5 4.5L14 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      Email builder
    </div>
    <div class="nav-item ${activePage==='files'?'active':''}" onclick="closeSidebar();location.href='files.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 3.5A1.5 1.5 0 013.5 2h4l3 3v7.5A1.5 1.5 0 019 14H3.5A1.5 1.5 0 012 12.5v-9z" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 2v3.5H11" stroke="currentColor" stroke-width="1.3"/></svg>
      File library
    </div>
    <div class="nav-item ${activePage==='notifications'?'active':''}" onclick="closeSidebar();location.href='notifications.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.5A4 4 0 003.5 5.5V8L2 9.5h11L11.5 8V5.5A4 4 0 007.5 1.5z" stroke="currentColor" stroke-width="1.3"/><path d="M6 9.5v.5a1.5 1.5 0 003 0V9.5" stroke="currentColor" stroke-width="1.3"/></svg>
      Notifications <span class="nav-badge" id="sidebarNotifBadge" style="display:none">0</span>
    </div>
  </div>

  <div class="sidebar-section">
    <div class="sidebar-section-label">Team</div>
    <div class="nav-item ${activePage==='people'?'active':''}" onclick="closeSidebar();location.href='people.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="5.5" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="11.5" cy="5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M13.5 13c0-2-1.3-3.2-3-3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      People
    </div>
    <div class="nav-item ${activePage==='profile'?'active':''}" onclick="closeSidebar();location.href='profile.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="5" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 13.5c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      My profile
    </div>
    <div class="nav-item ${activePage==='space-settings'?'active':''}" onclick="closeSidebar();location.href='space-settings.html'">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.5 2.5l1 1M11.5 11.5l1 1M11.5 2.5l-1 1M2.5 11.5l1-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      Space settings
    </div>
    <div class="nav-item" onclick="doLogout()">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M5.5 13H3a1 1 0 01-1-1V3a1 1 0 011-1h2.5M9.5 10.5l3-3-3-3M12.5 7.5H5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      Sign out
    </div>
  </div>

  <div class="sidebar-bottom">
    <button class="theme-toggle" id="themeToggleBtn" onclick="toggleTheme()">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.5 8.5A5 5 0 015.5 2.5a5 5 0 100 9 5 5 0 006-3z" stroke="currentColor" stroke-width="1.3"/></svg>
      Dark mode
    </button>
    <div class="sidebar-user" onclick="closeSidebar();location.href='profile.html'">
      <div class="av-wrap" style="position:relative;flex-shrink:0">
        <div class="av av-sm" id="sidebarAv"></div>
        <span class="online-dot is-online" title="You are online" style="position:absolute;bottom:0;right:0"></span>
      </div>
      <div><div class="sidebar-user-name" id="sidebarName"></div><div class="sidebar-user-role" id="sidebarRole"></div></div>
    </div>
  </div>
</aside>`;
}

export function renderBottomNav(activePage) {
  return `<nav class="bottom-nav">
    <button class="bn-item ${activePage==='main-dashboard'?'active':''}" onclick="location.href='main-dashboard.html'">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="5" rx="2" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="9" width="7" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="2" width="7" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>
      Overview
    </button>
    <button class="bn-item ${activePage==='dashboard'?'active':''}" onclick="location.href='dashboard.html'">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="2" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="11" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="11" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>
      Board
    </button>
    <button class="bn-item" onclick="openNewProject()" style="color:var(--purple)">
      <div style="width:38px;height:38px;border-radius:50%;background:var(--purple);display:flex;align-items:center;justify-content:center">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>
      </div>
      New
    </button>
    <button class="bn-item ${activePage==='chat'?'active':''}" onclick="location.href='chat.html'">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M17 9A7 7 0 011 9c0 1.4.4 2.7 1.1 3.77L1 17l4.23-1.1A7 7 0 0017 9z" stroke="currentColor" stroke-width="1.5"/></svg>
      Chat
    </button>
    <button class="bn-item ${activePage==='profile'?'active':''}" onclick="location.href='profile.html'">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M2 18c0-4.418 3.582-7 8-7s8 2.582 8 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Profile
    </button>
  </nav>`;
}
