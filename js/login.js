import { verifyPin, getAllUsers, getUserProfile } from "./firebase.js";
import { DEFAULT_USERS, getCachedUsers, cacheUsers } from "./helpers.js";

let selectedUser = null;

function renderMemberGrid(all) {
  const grid = document.getElementById("memberGrid");
  if (!grid) return;
  // Preserve current selection across re-renders
  const prevSelected = selectedUser;
  grid.innerHTML = Object.entries(all).map(([uid,u]) => `
    <button class="member-btn${prevSelected===uid?' selected':''}" data-user="${uid}" onclick="selectMember(this)">
      <div class="av ${u.cls||'av-jc'}" id="av-login-${uid}" style="width:36px;height:36px;font-size:12px;font-weight:600">
        ${u.photoURL ? `<img src="${u.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>` : u.av||uid.slice(0,2).toUpperCase()}
      </div>
      <span class="mb-name">${u.name||uid}</span>
      <span class="mb-role">${u.role||"Team member"}</span>
    </button>`).join("");
}

async function loadMemberGrid() {
  // Step 1: Render from localStorage cache instantly (includes previously added users)
  const cached = getCachedUsers();
  const initial = cached ? { ...DEFAULT_USERS, ...cached } : { ...DEFAULT_USERS };
  renderMemberGrid(initial);

  // Step 2: Fetch fresh Firebase users — update display and persist cache
  try {
    const stored = await getAllUsers();
    const all = { ...DEFAULT_USERS };
    Object.entries(stored).forEach(([k,v]) => { if (!all[k]) all[k] = v; else all[k] = {...all[k],...v}; });
    cacheUsers(all); // persist so next load is instant
    renderMemberGrid(all);
  } catch(e) {
    console.warn("[Login] Could not load Firebase users, using cached/defaults:", e);
  }
}
loadMemberGrid();

window.selectMember = function(btn) {
  document.querySelectorAll(".member-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  selectedUser = btn.dataset.user;
  document.getElementById("pinWrap").style.display = "block";
  document.getElementById("loginBtn").style.display = "block";
  document.getElementById("pinInput").value = "";
  document.getElementById("pinInput").focus();
};

window.doLogin = async function() {
  if (!selectedUser) return;
  const pin = document.getElementById("pinInput").value.trim();
  if (!pin) return;
  const btn = document.getElementById("loginBtn");
  btn.textContent = "Signing in…"; btn.disabled = true;
  try {
    const ok = await verifyPin(selectedUser, pin);
    if (ok) {
      sessionStorage.setItem("app_user", selectedUser);
      // Cache admin status immediately so all pages get it instantly
      if (selectedUser === "jc") {
        sessionStorage.setItem("app_admin_jc", "1");
      } else {
        try {
          const snap = await (await import("./firebase.js")).getUserProfile(selectedUser);
          sessionStorage.setItem("app_admin_" + selectedUser, snap?.isAdmin ? "1" : "0");
        } catch(e) {}
      }
      window.location.href = "pages/dashboard.html";
    } else {
      document.getElementById("pinError").style.display = "block";
      document.getElementById("pinInput").value = "";
      document.getElementById("pinInput").focus();
      btn.textContent = "Sign in"; btn.disabled = false;
    }
  } catch(err) {
    document.getElementById("login-error").textContent = "Connection error — check Firebase config.";
    document.getElementById("login-error").style.display = "block";
    btn.textContent = "Sign in"; btn.disabled = false;
  }
};
document.getElementById("pinInput")?.addEventListener("keydown", e => { if (e.key === "Enter") window.doLogin(); });
