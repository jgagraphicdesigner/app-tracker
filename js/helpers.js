import { subscribeNotifications, getUserProfile, subscribeSpaceConfigs, subscribeCustomSpaces } from "./firebase.js";

export const BASE_SPACES = {
  email: {
    id:"email", label:"Email", color:"#7c5cbf",
    defaultTypes:["Newsletter","Blog","Case Study"],
    stages:[
      {id:1,key:"s1",name:"Raw document",    owner:"tamara",  ownerLabel:"Tamara"},
      {id:2,key:"s2",name:"Draft creation",  owner:"jc",      ownerLabel:"JC"},
      {id:3,key:"s3",name:"QA review",       owner:"tamara",  ownerLabel:"Tamara"},
      {id:4,key:"s4",name:"Content approval",owner:"lloyd",   ownerLabel:"Lloyd"},
      {id:5,key:"s5",name:"Design build",    owner:"jc",      ownerLabel:"JC"},
      {id:6,key:"s6",name:"Final approval",  owner:"lloyd",   ownerLabel:"Lloyd"},
      {id:7,key:"s7",name:"Send / publish",  owner:"tamara",  ownerLabel:"Tamara"}
    ]
  },
  pdf: {
    id:"pdf", label:"PDF", color:"#2aab6f",
    defaultTypes:["Report","eBook","Presentation"],
    stages:[
      {id:1,key:"s1",name:"Raw document",    owner:"shelley", ownerLabel:"Shelley"},
      {id:2,key:"s2",name:"Draft creation",  owner:"jc",      ownerLabel:"JC"},
      {id:3,key:"s3",name:"QA review",       owner:"shelley", ownerLabel:"Shelley"},
      {id:4,key:"s4",name:"Content approval",owner:"lloyd",   ownerLabel:"Lloyd"},
      {id:5,key:"s5",name:"Design build",    owner:"jc",      ownerLabel:"JC"},
      {id:6,key:"s6",name:"Final approval",  owner:"lloyd",   ownerLabel:"Lloyd"},
      {id:7,key:"s7",name:"Publish",         owner:"shelley", ownerLabel:"Shelley"}
    ]
  },
  prints: {
    id:"prints", label:"Prints", color:"#e0694a",
    defaultTypes:["Book","Tarpaulin","Cards"],
    stages:[
      {id:1,key:"s1",name:"Raw document",    owner:"tamara",  ownerLabel:"Tamara"},
      {id:2,key:"s2",name:"Draft creation",  owner:"jc",      ownerLabel:"JC"},
      {id:3,key:"s3",name:"QA review",       owner:"tamara",  ownerLabel:"Tamara"},
      {id:4,key:"s4",name:"Content approval",owner:"lloyd",   ownerLabel:"Lloyd"},
      {id:5,key:"s5",name:"Design build",    owner:"jc",      ownerLabel:"JC"},
      {id:6,key:"s6",name:"Final approval",  owner:"lloyd",   ownerLabel:"Lloyd"},
      {id:7,key:"s7",name:"Print ready",     owner:"tamara",  ownerLabel:"Tamara"}
    ]
  }
};

// Merged SPACES — base + any overrides from Firebase config
export let SPACES = { ...BASE_SPACES };

// Live space registry (base + custom, with config overrides)
export let ALL_SPACES = { ...BASE_SPACES };

export function mergeSpaceConfig(configs) {
  const merged = JSON.parse(JSON.stringify(BASE_SPACES));
  Object.entries(configs).forEach(([spaceId, cfg]) => {
    if (!merged[spaceId]) return;
    if (cfg.label) merged[spaceId].label = cfg.label;
    if (cfg.color) merged[spaceId].color = cfg.color;
    // Full replacement: space-settings saves the complete stages array,
    // so replace wholesale so renamed/added/removed steps and owners all apply.
    if (cfg.stages && cfg.stages.length) {
      merged[spaceId].stages = cfg.stages.map((sc, i) => ({
        id: i + 1,
        key: `s${i + 1}`,
        name:        sc.name  || `Step ${i + 1}`,
        owner:       sc.owner || "jc",
        owners:      sc.owners      || [sc.owner || "jc"],
        ownersLabel: sc.ownersLabel || [sc.ownerLabel || sc.owner || "JC"],
        // ownerLabel = all names joined so board shows every responsible person
        ownerLabel:  sc.ownersLabel && sc.ownersLabel.length
          ? sc.ownersLabel.join(", ")
          : (sc.ownerLabel || sc.owner || "JC")
      }));
    }
  });
  return merged;
}

export function mergeCustomSpaces(customs, base) {
  const result = { ...base };
  Object.entries(customs).forEach(([id, cs]) => {
    result[id] = {
      id, label: cs.label, color: cs.color || "#3b7dd8",
      defaultTypes: cs.types || ["Type 1"],
      stages: (cs.stages || BASE_SPACES.email.stages).map((s, i) => {
        const ownersLabel = s.ownersLabel || [s.ownerLabel || s.owner || "JC"];
        return {
          ...s,
          id: i + 1,
          key: `s${i + 1}`,
          ownersLabel,
          ownerLabel: ownersLabel.length > 1 ? ownersLabel.join(", ") : (s.ownerLabel || s.owner || "JC")
        };
      })
    };
  });
  return result;
}

export const DEFAULT_USERS = {
  jc:      { name:"JC",      role:"Designer",            av:"JC",  cls:"av-jc",     pin:"1111" },
  tamara:  { name:"Tamara",  role:"Quality Assurance",   av:"TA",  cls:"av-tamara", pin:"2222" },
  lloyd:   { name:"Lloyd",   role:"Reviewer & Approver", av:"LL",  cls:"av-lloyd",  pin:"3333" },
  shelley: { name:"Shelley", role:"PDF Quality Assurance",av:"SH", cls:"av-shelley",pin:"4444" }
};

export const PRIORITY_LEVELS = [
  { val:"High",   cls:"badge-priority-high",   icon:"🔴" },
  { val:"Medium", cls:"badge-priority-medium",  icon:"🟡" },
  { val:"Low",    cls:"badge-priority-low",     icon:"🟢" }
];

export function priorityClass(p) {
  return { High:"badge-priority-high", Medium:"badge-priority-medium", Low:"badge-priority-low" }[p] || "";
}

export const STATUS_LIST = [
  { val:"In Progress",   cls:"badge-wip" },
  { val:"Need Revision", cls:"badge-rev" },
  { val:"Approved",      cls:"badge-apr" },
  { val:"Published",     cls:"badge-pub" }
];

export function statusClass(s) {
  return { "In Progress":"badge-wip","Need Revision":"badge-rev","Approved":"badge-apr","Published":"badge-pub" }[s] || "badge-wip";
}

export function formatDate(str) {
  if (!str) return "—";
  return new Date(str+"T00:00:00").toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"});
}

export function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000)    return "just now";
  if (d < 3600000)  return `${Math.floor(d/60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
  return `${Math.floor(d/86400000)}d ago`;
}

export function authGuard(root=false) {
  const user = sessionStorage.getItem("app_user");
  if (!user) { window.location.href = root ? "index.html" : "../index.html"; return null; }
  return user;
}

export function getCurrentSpace() {
  const s = sessionStorage.getItem("app_space") || "email";
  return s;
}

export function setCurrentSpace(space) {
  sessionStorage.setItem("app_space", space);
}

export async function getUsers() {
  const { getAllUsers } = await import("./firebase.js");
  const stored = await getAllUsers();
  const merged = { ...DEFAULT_USERS };
  Object.entries(stored).forEach(([k,v]) => {
    if (merged[k]) merged[k] = { ...merged[k], ...v };
    else merged[k] = v;
  });
  return merged;
}

export function initTheme() {
  const t = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
  return t;
}

export function toggleTheme() {
  const cur  = document.documentElement.getAttribute("data-theme") || "light";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  updateThemeBtn(next);
}

export function updateThemeBtn(theme) {
  const btn = document.getElementById("themeToggleBtn"); if (!btn) return;
  btn.innerHTML = theme === "dark"
    ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M7 1v1M7 12v1M1 7h1M12 7h1M2.5 2.5l.7.7M10.8 10.8l.7.7M2.5 11.5l.7-.7M10.8 3.2l.7-.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Light mode`
    : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.5 8.5A5 5 0 015.5 2.5a5 5 0 100 9 5 5 0 006-3z" stroke="currentColor" stroke-width="1.3"/></svg> Dark mode`;
}

export async function setupSidebar(currentUser) {
  const users = await getUsers();
  const u = users[currentUser] || { name:currentUser, av:currentUser.slice(0,2).toUpperCase(), cls:"av-jc", role:"Team member" };
  const avEl = document.getElementById("sidebarAv");
  if (avEl) { avEl.className = `av av-sm ${u.cls}`; avEl.textContent = u.av; }
  const nameEl = document.getElementById("sidebarName");
  const roleEl = document.getElementById("sidebarRole");
  if (nameEl) nameEl.textContent = u.name;
  if (roleEl) roleEl.textContent = u.role;

  getUserProfile(currentUser).then(profile => {
    if (profile.photoURL && avEl) avEl.innerHTML = `<img src="${profile.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    // Update sidebar name/role if user has saved custom values
    if (profile.displayName && nameEl) nameEl.textContent = profile.displayName;
    if (profile.role && roleEl) roleEl.textContent = profile.role;
  });

  window.doLogout = () => { sessionStorage.clear(); window.location.href = "../index.html"; };
  window.toggleTheme = toggleTheme;
  initTheme();
  updateThemeBtn(localStorage.getItem("theme") || "light");
}

export function setupNotifBadge(currentUser) {
  let prevUnread = 0;
  subscribeNotifications(currentUser, notifs => {
    const unread = notifs.filter(n => !n.read).length;
    if (unread === prevUnread) return; // no DOM writes if count unchanged
    ["notifBadge","sidebarNotifBadge","bnBadge"].forEach(id => {
      const b = document.getElementById(id); if (!b) return;
      b.textContent = unread;
      b.style.display = unread > 0 ? "flex" : "none";
      // Pulse animation when new notifications arrive
      if (unread > prevUnread) {
        b.classList.remove("pulse");
        void b.offsetWidth; // reflow to restart animation
        b.classList.add("pulse");
      }
    });
    prevUnread = unread;
  });
}

// ── Presence helper for non-chat pages ───────────────────────
export async function setupPresence(uid) {
  // Import dynamically to avoid circular deps
  const { setPresence } = await import("./firebase.js");
  setPresence(uid, true);
  window.addEventListener("beforeunload", () => setPresence(uid, false));
}
