import {
  sendMessage, subscribeMessages, getAllUsers,
  pushNotification, editMessage, deleteMessage,
  saveCustomGroup, deleteCustomGroup, subscribeCustomGroups,
  updateGroupMembers, getGroupData,
  setPresence, subscribePresence,
  markRoomRead, incrementUnread, subscribeUnread,
  subscribeCustomSpaces, subscribeSpaceConfigs
} from "./firebase.js";
import { notifyUser } from "./notify.js";
import { uploadChatImage } from "./storage.js";
import {
  authGuard, getCurrentSpace, setupSidebar, setupNotifBadge,
  initTheme, updateThemeBtn, toggleTheme, DEFAULT_USERS, timeAgo, setCurrentSpace,
  BASE_SPACES, getCachedSpaces, cacheSpaces, mergeCustomSpaces, mergeSpaceConfig
} from "./helpers.js";
import { renderSidebar, renderBottomNav } from "./sidebar.js";

const CURRENT_USER = authGuard();
if (!CURRENT_USER) throw new Error("not auth");

document.getElementById("appShell").insertAdjacentHTML("afterbegin", renderSidebar("chat", getCurrentSpace(), getCachedSpaces()));
document.querySelector(".main").insertAdjacentHTML("beforeend", renderBottomNav("chat"));
setupSidebar(CURRENT_USER);
setupNotifBadge(CURRENT_USER);
initTheme(); updateThemeBtn(localStorage.getItem("theme") || "light");
window.toggleTheme    = toggleTheme;

// Keep sidebar in sync with custom spaces + space config overrides
let _sidebarCustoms = {};
let _sidebarConfigs = {};
function _refreshPageSidebar() {
  const sb = document.getElementById("sidebar"); if (!sb) return;
  const merged = mergeSpaceConfig(_sidebarConfigs, mergeCustomSpaces(_sidebarCustoms, BASE_SPACES));
  cacheSpaces(merged);
  sb.outerHTML = renderSidebar("chat", getCurrentSpace(), merged);
  setupSidebar(CURRENT_USER);
}
subscribeCustomSpaces(_cs => { _sidebarCustoms = _cs; _refreshPageSidebar(); });
subscribeSpaceConfigs(_cfg => { _sidebarConfigs = _cfg; _refreshPageSidebar(); });
window.doLogout       = () => { sessionStorage.clear(); window.location.href = "../index.html"; };
window.switchSpace    = s  => { setCurrentSpace(s); location.href = "dashboard.html"; };
window.openNewProject = () => { location.href = "dashboard.html"; };
window.openAddSpaceModal = () => { location.href = "space-settings.html"; };

const EMOJIS = ["😀","😂","😍","🤔","👍","👎","❤️","🔥","✅","⚡","🎉","💪","🙏","😎","🤝","💡","📌","⚠️","✨","🚀","📝","📧","🖨️","📄","🗂️","💬","📢","🔔","⏰","📅","✔️","❌","⭐","🏆","💼","📊","📈","🎯","💰","🔗"];

let currentRoom = null;
let currentRoomType = "group";
let currentRoomName = "";
let unsub = null;
let emojiOpen = false;
let allUsers = { ...DEFAULT_USERS };
let customGroups = [];
let mentionActive = false;
let mentionQuery = "";
let mentionStart = -1;
let mentionSelectedIdx = 0;
let membersPanelOpen = false;
let currentGroupData = null;  // stores the custom group record if current room is custom
let presenceMap = {};         // uid -> { online, lastSeen }
let unreadMap   = {};         // roomId -> count
let _renderRoomListTimer = null;
function debouncedRenderRoomList() {
  if (_renderRoomListTimer) clearTimeout(_renderRoomListTimer);
  _renderRoomListTimer = setTimeout(renderRoomList, 200);
}

async function loadUsers() {
  const stored = await getAllUsers();
  Object.entries(stored).forEach(([k,v]) => { allUsers[k] = { ...(allUsers[k]||{}), ...v }; });
}

// ── Presence ──────────────────────────────────────────────────
function initPresence() {
  // Mark self online
  setPresence(CURRENT_USER, true);
  // Update to offline when tab closes
  window.addEventListener("beforeunload", () => setPresence(CURRENT_USER, false));
  // Subscribe to all presence
  subscribePresence(data => {
    presenceMap = data;
    debouncedRenderRoomList(); // refresh DM list with online dots (debounced)
  });
}

function isOnline(uid) {
  const p = presenceMap[uid];
  if (!p) return false;
  // Consider online if updated within last 5 minutes
  return p.online && (Date.now() - p.lastSeen < 5 * 60 * 1000);
}

function onlineIndicator(uid) {
  const online = isOnline(uid);
  return `<span class="online-dot ${online ? "is-online" : "is-offline"}" title="${online ? "Online" : "Offline"}"></span>`;
}

// ── Unread counts ─────────────────────────────────────────────
function initUnread() {
  subscribeUnread(CURRENT_USER, counts => {
    unreadMap = counts;
    debouncedRenderRoomList();
    updateTotalUnreadBadge();
  });
}

function updateTotalUnreadBadge() {
  const total = Object.values(unreadMap).reduce((a, b) => a + (b || 0), 0);
  // Update bottom nav chat badge if present
  const navBadge = document.querySelector('.bnav-item[onclick*="chat"] .bnav-badge');
  if (navBadge) {
    navBadge.textContent = total > 0 ? (total > 99 ? "99+" : total) : "";
    navBadge.style.display = total > 0 ? "flex" : "none";
  }
}

// ── Build room list ───────────────────────────────────────────
async function buildRoomList() {
  await loadUsers();
  renderRoomList();
  subscribeCustomGroups(groups => {
    customGroups = groups;
    // Refresh currentGroupData if we're in a custom group
    if (currentRoom && currentGroupData) {
      const updated = groups.find(g => g.id === currentRoom);
      if (updated) {
        currentGroupData = updated;
        // Refresh meta count in header
        const metaEl = document.getElementById("chatRoomMeta");
        if (metaEl) metaEl.textContent = `${(updated.members||[]).length} member${(updated.members||[]).length!==1?"s":""}`;
        if (membersPanelOpen) renderMembersPanel();
      }
    }
    renderRoomList();
  });
}

function renderRoomList() {
  const builtinRooms = [
    { id:"group-all",    name:"Everyone",    icon:"👥", type:"group", desc:"All team" },
    { id:"group-email",  name:"Email team",  icon:"✉️",  type:"group", desc:"Email" },
    { id:"group-pdf",    name:"PDF team",    icon:"📄",  type:"group", desc:"PDF" },
    { id:"group-prints", name:"Prints team", icon:"🖨️",  type:"group", desc:"Prints" }
  ];

  const customRooms = customGroups.map(g => ({
    id: g.id, name: g.name, icon: g.icon || "💬",
    type: "group", desc: "Custom group", custom: true
  }));

  const dmRooms = Object.entries(allUsers)
    .filter(([uid]) => uid !== CURRENT_USER)
    .map(([uid, u]) => ({
      id: [CURRENT_USER, uid].sort().join("--"),
      name: u.displayName || u.name || uid,
      icon: u.av || "?",
      type: "dm", uid, cls: u.cls
    }));

  const list = document.getElementById("roomList");
  const groupItems = [...builtinRooms, ...customRooms].map(r => {
    const unread = unreadMap[r.id] || 0;
    const badge  = unread > 0 ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>` : "";
    return `
    <div class="chat-room-item ${currentRoom===r.id?"active":""}" id="room-${r.id}"
         data-room="${r.id}" onclick="selectRoom('${r.id}','${r.name}','${r.type}')">
      <div class="chat-room-icon">${r.icon}</div>
      <div style="min-width:0;flex:1">
        <div class="chat-room-name">${r.name}</div>
        <div class="chat-room-preview">${r.desc}</div>
      </div>
      ${badge}
      ${r.custom ? `<button class="chat-room-del" onclick="event.stopPropagation();deleteGroup('${r.id}','${r.name}')" title="Delete">×</button>` : ""}
    </div>`;
  }).join("");

  const dmItems = dmRooms.map(r => {
    const unread = unreadMap[r.id] || 0;
    const badge  = unread > 0 ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>` : "";
    const online = isOnline(r.uid);
    return `
    <div class="chat-room-item ${currentRoom===r.id?"active":""}" id="room-${r.id}"
         data-room="${r.id}" onclick="selectRoom('${r.id}','${r.name}','dm')">
      <div class="av-wrap" style="position:relative;flex-shrink:0">
        <div class="av av-sm ${r.cls||"av-jc"}">${r.icon}</div>
        <span class="online-dot ${online ? "is-online" : "is-offline"}"></span>
      </div>
      <div style="min-width:0;flex:1">
        <div class="chat-room-name">${r.name}</div>
        <div class="chat-room-preview">${online ? "Online now" : "Offline"}</div>
      </div>
      ${badge}
    </div>`;
  }).join("");

  list.innerHTML = `
    <div class="chat-room-section-label">Group chats</div>
    ${groupItems}
    <button class="chat-new-group-btn" onclick="openCreateGroupModal()">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      New group
    </button>
    <hr class="chat-section-divider"/>
    <div class="chat-room-section-label">Direct messages</div>
    ${dmItems}`;

  if (currentRoom) selectRoom(currentRoom, currentRoomName, currentRoomType);
}

// ── Create group modal ────────────────────────────────────────
window.openCreateGroupModal = function() {
  const members = Object.entries(allUsers)
    .filter(([uid]) => uid !== CURRENT_USER)
    .map(([uid, u]) => `
      <div class="member-check-item">
        <input type="checkbox" id="gc-${uid}" value="${uid}"/>
        <div class="av av-sm ${u.cls||'av-jc'}">${u.av}</div>
        <label for="gc-${uid}" style="font-size:13px;cursor:pointer;flex:1">${u.displayName||u.name||uid}</label>
      </div>`).join("");

  document.getElementById("createGroupModal").innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>New group chat</h3>
        <button class="modal-close" onclick="closeCreateGroupModal()">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="field-row">
          <label class="field-label">Group name *</label>
          <input type="text" id="gc-name" class="field-input" placeholder="e.g. Campaign Team"/>
        </div>
        <div class="field-row">
          <label class="field-label">Icon (emoji)</label>
          <input type="text" id="gc-icon" class="field-input" placeholder="💬" maxlength="2" style="width:80px"/>
        </div>
        <div class="field-row">
          <label class="field-label">Members</label>
          <div style="border:1px solid var(--border2);border-radius:var(--radius-sm);padding:4px">${members}</div>
        </div>
        <div id="gc-error" class="alert alert-error" style="display:none"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" onclick="closeCreateGroupModal()">Cancel</button>
        <button class="btn-primary" onclick="doCreateGroup()" style="width:auto;height:auto;padding:9px 16px;border-radius:var(--radius-sm)">Create group</button>
      </div>
    </div>`;
  document.getElementById("createGroupModal").classList.add("open");
};

window.closeCreateGroupModal = () => document.getElementById("createGroupModal").classList.remove("open");

window.doCreateGroup = async function() {
  const name = document.getElementById("gc-name")?.value.trim();
  const icon = document.getElementById("gc-icon")?.value.trim() || "💬";
  const err  = document.getElementById("gc-error");
  if (!name) { err.textContent="Enter a group name."; err.style.display="block"; return; }
  const members = [...document.querySelectorAll('[id^="gc-"]:checked')].map(el => el.value).filter(Boolean);
  members.push(CURRENT_USER);
  await saveCustomGroup({ name, icon, members, createdBy: CURRENT_USER });
  closeCreateGroupModal();
  showToast(`Group "${name}" created`);
};

window.deleteGroup = async function(id, name) {
  if (!confirm(`Delete group "${name}"? All messages will be lost.`)) return;
  await deleteCustomGroup(id);
  if (currentRoom === id) {
    currentRoom = null; currentGroupData = null;
    document.getElementById("chatMessages").innerHTML = `<div style="text-align:center;color:var(--text-3);padding:2rem;font-size:13px">Group deleted</div>`;
    document.getElementById("chatInputRow").style.display = "none";
    document.getElementById("chatHeaderActions").style.display = "none";
    document.getElementById("chatRoomName").textContent = "Select a chat";
    document.getElementById("chatRoomMeta").textContent = "";
    document.getElementById("chatRoomIcon").style.display = "none";
    if (membersPanelOpen) closeMembersPanel();
  }
  showToast(`Group "${name}" deleted`);
};

window.deleteCurrentGroup = function() {
  if (!currentGroupData) return;
  deleteGroup(currentGroupData.id, currentGroupData.name);
};

// ── Select room ───────────────────────────────────────────────
// ── Mobile panel navigation ──────────────────────────────────
function showChatPanel() {
  const sidebar  = document.querySelector('.chat-sidebar');
  const chatMain = document.getElementById('chatMain');
  if (window.innerWidth <= 768) {
    sidebar?.classList.add('chat-panel-hidden');
    chatMain?.classList.add('chat-panel-active');
  }
}
function showRoomList() {
  const sidebar  = document.querySelector('.chat-sidebar');
  const chatMain = document.getElementById('chatMain');
  sidebar?.classList.remove('chat-panel-hidden');
  chatMain?.classList.remove('chat-panel-active');
}
window.showRoomList = showRoomList;
window.selectRoom = async function(roomId, roomName, roomType) {
  currentRoom     = roomId;
  currentRoomName = roomName;
  currentRoomType = roomType || "group";
  currentGroupData = null;

  // Immediately clear previous chat so old messages never bleed through
  const msgPane = document.getElementById("chatMessages");
  if (msgPane) msgPane.innerHTML = `<div class="chat-loading-wrap"><span class="chat-loading-spinner"></span></div>`;

  // Unsubscribe previous room listener immediately
  if (unsub) { unsub(); unsub = null; }

  document.querySelectorAll(".chat-room-item").forEach(el => el.classList.toggle("active", el.dataset.room === roomId));
  document.getElementById("chatRoomName").textContent = roomName;
  document.getElementById("chatInputRow").style.display = "flex";
  document.getElementById("chatHeaderActions").style.display = "flex";

  // Find if this is a custom group
  const customGroup = customGroups.find(g => g.id === roomId);
  const isBuiltin = ["group-all","group-email","group-pdf","group-prints"].includes(roomId);
  const isDM = roomType === "dm";

  // Header icon
  const iconEl = document.getElementById("chatRoomIcon");
  if (!isDM) {
    const room = [...[
      {id:"group-all",icon:"👥"},{id:"group-email",icon:"✉️"},
      {id:"group-pdf",icon:"📄"},{id:"group-prints",icon:"🖨️"}
    ], ...customGroups.map(g=>({id:g.id,icon:g.icon||"💬"}))].find(r=>r.id===roomId);
    iconEl.textContent = room?.icon || "💬";
    iconEl.style.display = "flex";
  } else {
    iconEl.style.display = "none";
  }

  // Members button — show for all groups, hide for DM
  const membersBtn = document.getElementById("membersBtn");
  const deleteBtn  = document.getElementById("deleteGroupBtn");
  membersBtn.style.display = isDM ? "none" : "flex";
  deleteBtn.style.display  = customGroup ? "flex" : "none";

  // Meta line
  const metaEl = document.getElementById("chatRoomMeta");
  if (isDM) {
    const otherUid = roomId.split("--").find(p => p !== CURRENT_USER);
    const other = allUsers[otherUid];
    metaEl.textContent = other?.role || "Direct message";
  } else if (customGroup) {
    currentGroupData = customGroup;
    const cnt = (customGroup.members || []).length;
    metaEl.textContent = `${cnt} member${cnt!==1?"s":""}`;
  } else {
    const descMap = {"group-all":"All team","group-email":"Email team","group-pdf":"PDF team","group-prints":"Prints team"};
    metaEl.textContent = descMap[roomId] || "Group chat";
  }

  // Update members button label
  document.getElementById("membersBtnLabel").textContent = isDM ? "" : "Members";

  // Close members panel when switching rooms
  if (membersPanelOpen) closeMembersPanel();

  // Mark this room as read
  markRoomRead(CURRENT_USER, roomId);
  delete unreadMap[roomId];
  updateTotalUnreadBadge();
  // Update only the active state in the room list — no full re-render
  document.querySelectorAll(".chat-room-item").forEach(el => {
    el.classList.toggle("active", el.dataset.room === roomId);
    // Hide unread badge for this room
    if (el.dataset.room === roomId) {
      const badge = el.querySelector(".unread-badge");
      if (badge) badge.remove();
    }
  });

  // If DM, show online status in meta
  if (isDM) {
    const otherUid = roomId.split("--").find(p => p !== CURRENT_USER);
    const online = isOnline(otherUid);
    const metaEl = document.getElementById("chatRoomMeta");
    metaEl.innerHTML = `${online ? '<span class="online-dot is-online" style="display:inline-block;margin-right:4px;vertical-align:middle"></span><span style="color:#22c55e">Online now</span>' : '<span class="online-dot is-offline" style="display:inline-block;margin-right:4px;vertical-align:middle"></span>Offline'}`;
  }

  unsub = subscribeMessages(roomId, msgs => renderMessages(msgs));
  closeMentionPopup();
  closeEmoji();
  showChatPanel(); // mobile: slide to chat view
};

// ── Messages rendering with actions ──────────────────────────
function renderMessages(msgs) {
  const container = document.getElementById("chatMessages");
  if (!msgs.length) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-3);padding:2rem;font-size:13px">No messages yet 👋</div>`;
    return;
  }
  container.innerHTML = msgs.map(m => {
    const isMine  = m.from === CURRENT_USER;
    const sender  = allUsers[m.from]?.displayName || allUsers[m.from]?.name || m.from;
    const avClass = allUsers[m.from]?.cls || "av-jc";
    const avTxt   = allUsers[m.from]?.av  || "?";
    const editedTag = m.edited ? `<div class="msg-edited">edited</div>` : "";

    let bodyContent = "";
    if (m.image) {
      bodyContent = `<img src="${m.image}" class="chat-img" onclick="openImgFull('${m.image}')" alt="image"/>`;
    } else {
      bodyContent = renderMentions(m.text || "");
    }

    // Action buttons — edit/delete for own messages, delete for others (own side)
    const actions = `
      <div class="msg-actions">
        ${isMine && !m.image ? `<button class="msg-act-btn" onclick="startEditMsg('${m.id}')" title="Edit">✏️</button>` : ""}
        ${isMine ? `<button class="msg-act-btn" onclick="doDeleteMsg('${m.id}')" title="Delete">🗑</button>` : ""}
      </div>`;

    return `<div class="chat-msg-wrap">
      <div class="chat-msg ${isMine?"mine":""}">
        ${!isMine ? `<div class="av av-sm ${avClass}" style="flex-shrink:0;margin-top:2px">${avTxt}</div>` : ""}
        <div style="max-width:75%">
          ${!isMine ? `<div style="font-size:10px;color:var(--text-3);margin-bottom:3px">${sender}</div>` : ""}
          <div class="chat-bubble" id="bubble-${m.id}">${bodyContent}</div>
          ${editedTag}
          <div class="chat-msg-time">${timeAgo(m.timestamp)}</div>
        </div>
        ${actions}
      </div>
    </div>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

function renderMentions(text) {
  return text.replace(/@(\w+)/g, (match, uid) => {
    const u = allUsers[uid];
    return u ? `<span class="mention-chip">@${u.displayName||u.name||uid}</span>` : match;
  });
}

// ── Edit message ──────────────────────────────────────────────
window.startEditMsg = function(msgId) {
  const bubble = document.getElementById(`bubble-${msgId}`);
  if (!bubble) return;
  const originalText = bubble.textContent;
  bubble.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center">
      <input type="text" id="editInput-${msgId}" value="${originalText.replace(/"/g,'&quot;')}"
        style="flex:1;padding:6px 10px;border:1.5px solid var(--purple);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text-1);outline:none"
        onkeydown="if(event.key==='Enter')saveEditMsg('${msgId}','${currentRoom}');if(event.key==='Escape')cancelEditMsg('${msgId}','${originalText.replace(/'/g,"\\'")}')"/>
      <button onclick="saveEditMsg('${msgId}','${currentRoom}')" style="background:var(--purple);color:white;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer">Save</button>
      <button onclick="cancelEditMsg('${msgId}','${originalText.replace(/'/g,"\\'")}',true)" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:5px 8px;font-size:12px;cursor:pointer;color:var(--text-2)">✕</button>
    </div>`;
  document.getElementById(`editInput-${msgId}`)?.focus();
};

window.saveEditMsg = async function(msgId, roomId) {
  const input = document.getElementById(`editInput-${msgId}`);
  const newText = input?.value.trim();
  if (!newText) return;
  await editMessage(roomId, msgId, newText);
};

window.cancelEditMsg = function(msgId, original) {
  const bubble = document.getElementById(`bubble-${msgId}`);
  if (bubble) bubble.innerHTML = renderMentions(original);
};

window.doDeleteMsg = async function(msgId) {
  if (!confirm("Delete this message?")) return;
  await deleteMessage(currentRoom, msgId);
};

// ── Send message ──────────────────────────────────────────────
window.sendMsg = async function() {
  const input = document.getElementById("msgInput");
  const text  = input.value.trim(); if (!text || !currentRoom) return;
  input.value = "";
  closeMentionPopup();
  await sendMessage(currentRoom, {
    text, from: CURRENT_USER,
    fromName: allUsers[CURRENT_USER]?.displayName || allUsers[CURRENT_USER]?.name || CURRENT_USER
  });
  // Notify @mentions
  for (const uid of extractMentions(text)) {
    if (uid === CURRENT_USER) continue;
    const senderName = allUsers[CURRENT_USER]?.name || CURRENT_USER;
    const title = `${senderName} mentioned you in ${currentRoomType==="dm"?"a direct message":currentRoomName}`;
    await pushNotification(uid, { title, message:`"${text.slice(0,80)}"`, type:"mention", roomId:currentRoom, from:CURRENT_USER });
    await notifyUser(uid, { title, message:`"${text.slice(0,80)}"`, projectName:`Chat: ${currentRoomName}`, fromUser:CURRENT_USER });
  }
  // DM notification
  if (currentRoomType === "dm") {
    const parts = currentRoom.split("--");
    const other = parts.find(p => p !== CURRENT_USER);
    if (other && !extractMentions(text).includes(other)) {
      const senderName = allUsers[CURRENT_USER]?.name || CURRENT_USER;
      await pushNotification(other, { title:`New message from ${senderName}`, message:`"${text.slice(0,80)}"`, type:"dm", roomId:currentRoom, from:CURRENT_USER });
      await notifyUser(other, { title:`New message from ${senderName}`, message:`"${text.slice(0,80)}"`, projectName:"Direct message", fromUser:CURRENT_USER });
      await incrementUnread(other, currentRoom);
    }
  } else {
    // Group chat — increment unread for all members except sender
    const roomMembers = getRoomMembers(currentRoom);
    for (const uid of roomMembers) {
      if (uid === CURRENT_USER) continue;
      await incrementUnread(uid, currentRoom);
    }
  }
};

function getRoomMembers(roomId) {
  if (roomId === "group-all") return Object.keys(allUsers);
  if (roomId === "group-email" || roomId === "group-pdf" || roomId === "group-prints") return Object.keys(allUsers);
  // Custom group
  const grp = customGroups.find(g => g.id === roomId);
  return grp?.members || Object.keys(allUsers);
}

function extractMentions(text) {
  const matches = text.match(/@(\w+)/g) || [];
  return [...new Set(matches.map(m => m.slice(1)).filter(uid => allUsers[uid]))];
}

// ── @mention autocomplete ─────────────────────────────────────
const msgInput = document.getElementById("msgInput");
if (msgInput) {
  msgInput.addEventListener("input", handleMentionInput);
  msgInput.addEventListener("keydown", handleMentionKeydown);
  msgInput.addEventListener("blur", () => setTimeout(closeMentionPopup, 150));
}
function handleMentionInput(e) {
  const val = e.target.value, pos = e.target.selectionStart;
  const before = val.slice(0, pos), atIdx = before.lastIndexOf("@");
  if (atIdx !== -1 && (atIdx === 0 || before[atIdx-1] === " ")) {
    mentionStart = atIdx; mentionQuery = before.slice(atIdx+1).toLowerCase();
    showMentionPopup(mentionQuery);
  } else { closeMentionPopup(); }
}
function handleMentionKeydown(e) {
  if (!mentionActive) return;
  const items = document.querySelectorAll(".mention-item");
  if (e.key==="ArrowDown") { e.preventDefault(); mentionSelectedIdx=(mentionSelectedIdx+1)%items.length; items.forEach((el,i)=>el.classList.toggle("active",i===mentionSelectedIdx)); }
  else if (e.key==="ArrowUp") { e.preventDefault(); mentionSelectedIdx=(mentionSelectedIdx-1+items.length)%items.length; items.forEach((el,i)=>el.classList.toggle("active",i===mentionSelectedIdx)); }
  else if (e.key==="Enter"||e.key==="Tab") { e.preventDefault(); document.querySelector(".mention-item.active")?.click(); }
  else if (e.key==="Escape") closeMentionPopup();
}
function showMentionPopup(query) {
  const matches = Object.entries(allUsers).filter(([uid,u]) => {
    const name = (u.displayName||u.name||uid).toLowerCase();
    return uid !== CURRENT_USER && (query===""||name.includes(query)||uid.includes(query));
  });
  if (!matches.length) { closeMentionPopup(); return; }
  mentionActive = true; mentionSelectedIdx = 0;
  let popup = document.getElementById("mentionPopup");
  if (!popup) {
    popup = document.createElement("div"); popup.id="mentionPopup"; popup.className="mention-popup";
    document.getElementById("chatInputRow").style.position="relative";
    document.getElementById("chatInputRow").appendChild(popup);
  }
  popup.innerHTML = matches.map(([uid,u],i) => `
    <div class="mention-item ${i===0?"active":""}" data-uid="${uid}" onclick="insertMention('${uid}')">
      <div class="av av-sm ${u.cls||'av-jc'}">${u.av||uid.slice(0,2).toUpperCase()}</div>
      <div><div class="mention-name">${u.displayName||u.name||uid}</div><div class="mention-role">${u.role||""}</div></div>
    </div>`).join("");
  popup.style.display="block";
}
window.insertMention = function(uid) {
  const input = document.getElementById("msgInput");
  const val = input.value, pos = input.selectionStart;
  const before = val.slice(0, mentionStart), after = val.slice(pos);
  input.value = before+"@"+uid+" "+after;
  const newPos = (before+"@"+uid+" ").length;
  input.setSelectionRange(newPos, newPos); input.focus();
  closeMentionPopup();
};
function closeMentionPopup() {
  mentionActive = false;
  const p = document.getElementById("mentionPopup"); if(p) p.style.display="none";
}

// ── Image send ────────────────────────────────────────────────
window.sendImage = () => document.getElementById("chatImgInput").click();
document.getElementById("chatImgInput")?.addEventListener("change", async function(e) {
  const file = e.target.files[0]; if (!file || !currentRoom) return;
  if (file.size > 10*1024*1024) { showToast("Image too large — max 10MB"); return; }
  showToast("Uploading image…");
  try {
    const { url } = await uploadChatImage(currentRoom, CURRENT_USER, file);
    await sendMessage(currentRoom, { image: url, from: CURRENT_USER, fromName: allUsers[CURRENT_USER]?.name||CURRENT_USER });
    if (currentRoomType === "dm") {
      const other = currentRoom.split("--").find(p => p !== CURRENT_USER);
      if (other) await pushNotification(other, { title:`${allUsers[CURRENT_USER]?.name||CURRENT_USER} sent an image`, message:"New image in direct message", type:"dm", roomId:currentRoom, from:CURRENT_USER });
    }
  } catch(err) {
    showToast("Upload failed — check Firebase Storage rules");
    console.error("[Chat] image upload error:", err);
  }
  e.target.value = "";
});

// ── Emoji ─────────────────────────────────────────────────────
window.toggleEmoji = () => {
  emojiOpen = !emojiOpen;
  document.getElementById("emojiPanel").style.display = emojiOpen ? "grid" : "none";
};
function closeEmoji() { emojiOpen=false; const p=document.getElementById("emojiPanel"); if(p) p.style.display="none"; }
window.insertEmoji = emoji => {
  const input = document.getElementById("msgInput");
  const pos = input.selectionStart;
  input.value = input.value.slice(0,pos)+emoji+input.value.slice(pos);
  input.setSelectionRange(pos+emoji.length,pos+emoji.length);
  input.focus(); closeEmoji();
};
const emojiPanel = document.getElementById("emojiPanel");
if (emojiPanel) emojiPanel.innerHTML = EMOJIS.map(em=>`<button onclick="insertEmoji('${em}')">${em}</button>`).join("");

// ── Full screen image ─────────────────────────────────────────
window.openImgFull = src => {
  const overlay = document.createElement("div");
  overlay.className="chat-img-full-overlay"; overlay.onclick=()=>overlay.remove();
  overlay.innerHTML=`<img src="${src}" class="chat-img-full"/>`;
  document.body.appendChild(overlay);
};

// ── Members panel ─────────────────────────────────────────────
window.toggleMembersPanel = function() {
  if (membersPanelOpen) closeMembersPanel();
  else openMembersPanel();
};

function openMembersPanel() {
  membersPanelOpen = true;
  const panel = document.getElementById("membersPanel");
  panel.classList.add("open");
  document.getElementById("membersBtn").style.background = "var(--purple-dim)";
  document.getElementById("membersBtn").style.borderColor = "var(--purple)";
  document.getElementById("membersBtn").style.color = "var(--purple)";
  renderMembersPanel();
}

function closeMembersPanel() {
  membersPanelOpen = false;
  const panel = document.getElementById("membersPanel");
  panel.classList.remove("open");
  document.getElementById("membersBtn").style.background = "";
  document.getElementById("membersBtn").style.borderColor = "";
  document.getElementById("membersBtn").style.color = "";
}

function renderMembersPanel() {
  const list   = document.getElementById("membersList");
  const addSec = document.getElementById("memberAddSection");
  const addList= document.getElementById("addableMembersList");

  // Determine current members
  let currentMembers = [];
  const isBuiltin = ["group-all","group-email","group-pdf","group-prints"].includes(currentRoom);

  if (isBuiltin) {
    // Built-in rooms — show all users, no add/remove
    currentMembers = Object.keys(allUsers);
    addSec.style.display = "none";
  } else if (currentGroupData) {
    currentMembers = currentGroupData.members || Object.keys(allUsers);
    addSec.style.display = "block";
  } else if (currentRoomType === "dm") {
    const other = currentRoom.split("--").find(p => p !== CURRENT_USER);
    currentMembers = [CURRENT_USER, other].filter(Boolean);
    addSec.style.display = "none";
  }

  // Render current members
  list.innerHTML = currentMembers.map(uid => {
    const u = allUsers[uid]; if (!u) return "";
    const isMe = uid === CURRENT_USER;
    const isCreator = currentGroupData?.createdBy === uid;
    const canRemove = !isBuiltin && !isMe && currentRoomType !== "dm";
    return `<div class="member-row">
      <div class="av av-sm ${u.cls||"av-jc"}">${u.av||uid.slice(0,2).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div class="member-row-name">${u.displayName||u.name||uid}${isMe?" (you)":""}</div>
        <div class="member-row-role">${u.role||""}${isCreator?" · Creator":""}</div>
      </div>
      ${canRemove ? `<button class="member-remove-btn" onclick="removeMember('${uid}')" title="Remove from group">✕</button>` : ""}
    </div>`;
  }).join("") || '<div style="color:var(--text-3);font-size:12px;padding:8px">No members found</div>';

  // Render addable members (not already in group)
  if (!isBuiltin && currentGroupData) {
    const addable = Object.entries(allUsers).filter(([uid]) =>
      !currentMembers.includes(uid) && uid !== CURRENT_USER
    );
    if (addable.length) {
      addList.innerHTML = addable.map(([uid, u]) => `
        <div class="member-add-row">
          <div class="av av-sm ${u.cls||"av-jc"}">${u.av||uid.slice(0,2).toUpperCase()}</div>
          <div class="member-add-row-name">${u.displayName||u.name||uid}</div>
          <button class="member-add-btn" onclick="addMember('${uid}')">+ Add</button>
        </div>`).join("");
    } else {
      addList.innerHTML = '<div style="color:var(--text-3);font-size:12px">Everyone is already in this group</div>';
    }
  }

  // Update meta count
  const metaEl = document.getElementById("chatRoomMeta");
  if (metaEl && currentGroupData) {
    metaEl.textContent = `${currentMembers.length} member${currentMembers.length!==1?"s":""}`;
  }
}

window.removeMember = async function(uid) {
  if (!currentGroupData) return;
  const u = allUsers[uid];
  if (!confirm(`Remove ${u?.name||uid} from "${currentGroupData.name}"?`)) return;
  const newMembers = (currentGroupData.members || []).filter(m => m !== uid);
  await updateGroupMembers(currentGroupData.id, newMembers);
  // Update local cache
  currentGroupData = { ...currentGroupData, members: newMembers };
  renderMembersPanel();
  renderRoomList(); // update member count in sidebar
  showToast(`${u?.name||uid} removed from group`);
};

window.addMember = async function(uid) {
  if (!currentGroupData) return;
  const u = allUsers[uid];
  const newMembers = [...(currentGroupData.members || []), uid];
  await updateGroupMembers(currentGroupData.id, newMembers);
  currentGroupData = { ...currentGroupData, members: newMembers };
  renderMembersPanel();
  renderRoomList();
  showToast(`${u?.name||uid} added to group`);
};

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById("chatToast");
  if (!t) { t=document.createElement("div"); t.id="chatToast"; t.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(16px);background:#2a1a3a;color:white;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:500;opacity:0;transition:all .25s;z-index:999;white-space:nowrap;pointer-events:none"; document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity="1"; t.style.transform="translateX(-50%) translateY(0)";
  setTimeout(()=>{ t.style.opacity="0"; t.style.transform="translateX(-50%) translateY(16px)"; },2500);
}

// ── Close handlers ────────────────────────────────────────────
document.addEventListener("keydown", e => { if (e.key==="Escape") { closeEmoji(); closeMentionPopup(); } });
document.addEventListener("click", e => { if (!e.target.closest(".emoji-btn")&&!e.target.closest("#emojiPanel")) closeEmoji(); });
msgInput?.addEventListener("keydown", e => { if (e.key==="Enter"&&!e.shiftKey&&!mentionActive) { e.preventDefault(); sendMsg(); } });

buildRoomList().then(() => {
  // Auto-open room if navigated from a notification quick action
  const targetRoom = sessionStorage.getItem("openChatRoom");
  if (targetRoom) {
    sessionStorage.removeItem("openChatRoom");
    // Wait for room list to render
    setTimeout(() => {
      const el = document.getElementById(`room-${targetRoom}`);
      if (el) el.click();
    }, 600);
  }
});
initPresence();
initUnread();
