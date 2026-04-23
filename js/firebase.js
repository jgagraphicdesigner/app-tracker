import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, push, update, remove, query, limitToLast, increment }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB1XiESVFpEtS8lcPg7bTY-G1-wJtAeSJI",
  authDomain: "app-project-management-59e1f.firebaseapp.com",
  databaseURL: "https://app-project-management-59e1f-default-rtdb.firebaseio.com",
  projectId: "app-project-management-59e1f",
  storageBucket: "app-project-management-59e1f.appspot.com",
  messagingSenderId: "461565231163",
  appId: "1:461565231163:web:6506bde0114003e5255c1e",
  measurementId: "G-37QR21CCPM"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

export async function createProject(data) {
  const r = push(ref(db, `spaces/${data.space}/projects`));
  const project = { ...data, id: r.key, createdAt: Date.now(),
    history: [{ action:"created", by:data.createdBy, stage:data.stage, timestamp:Date.now() }]
  };
  await set(r, project);
  return project;
}
export async function updateProject(space, id, data) {
  await update(ref(db, `spaces/${space}/projects/${id}`), data);
}
export async function deleteProject(space, id) {
  await remove(ref(db, `spaces/${space}/projects/${id}`));
}
export function subscribeProjects(space, callback) {
  return onValue(ref(db, `spaces/${space}/projects`), snap => {
    callback(Object.values(snap.val() || {}));
  });
}
export async function getSpaceTypes(space) {
  const snap = await get(ref(db, `spaces/${space}/types`));
  return snap.val() || null;
}
export async function saveSpaceTypes(space, types) {
  await set(ref(db, `spaces/${space}/types`), types);
}
export async function pushNotification(toUser, notification) {
  const r = push(ref(db, `notifications/${toUser}`));
  await set(r, { ...notification, id: r.key, read: false, timestamp: Date.now() });
}
export function subscribeNotifications(user, callback) {
  return onValue(ref(db, `notifications/${user}`), snap => {
    callback(Object.values(snap.val() || {}).sort((a,b) => b.timestamp - a.timestamp));
  });
}
export async function markNotifRead(user, id) {
  await update(ref(db, `notifications/${user}/${id}`), { read: true });
}
export async function clearNotifications(user) {
  await remove(ref(db, `notifications/${user}`));
}
export async function verifyPin(user, pin) {
  const snap = await get(ref(db, `users/${user}/pin`));
  const stored = snap.val();
  if (!stored) return pin === { jc:"1111", tamara:"2222", lloyd:"3333" }[user];
  return pin === stored;
}
export async function updatePin(user, newPin) {
  await set(ref(db, `users/${user}/pin`), newPin);
}
export async function saveUserProfile(user, data) {
  await update(ref(db, `users/${user}`), data);
}
export async function getUserProfile(user) {
  const snap = await get(ref(db, `users/${user}`));
  return snap.val() || {};
}
export async function getAllUsers() {
  const snap = await get(ref(db, "users"));
  return snap.val() || {};
}
export async function createUser(uid, data) {
  await set(ref(db, `users/${uid}`), data);
}
export async function sendMessage(roomId, message) {
  const r = push(ref(db, `chat/${roomId}`));
  await set(r, { ...message, id: r.key, timestamp: Date.now() });
}
export function subscribeMessages(roomId, callback) {
  // Limit to last 100 messages — dramatically faster on mobile
  const q = query(ref(db, `chat/${roomId}`), limitToLast(100));
  return onValue(q, snap => {
    callback(Object.values(snap.val() || {}).sort((a,b) => a.timestamp - b.timestamp));
  });
}
export async function saveFile(fileData) {
  const r = push(ref(db, "files"));
  await set(r, { ...fileData, id: r.key, uploadedAt: Date.now() });
  return r.key;
}
export async function deleteFile(id) {
  await remove(ref(db, `files/${id}`));
}
export function subscribeFiles(callback) {
  return onValue(ref(db, "files"), snap => {
    callback(Object.values(snap.val() || {}).sort((a,b) => b.uploadedAt - a.uploadedAt));
  });
}
export async function updateFile(id, data) {
  await update(ref(db, `files/${id}`), data);
}
export { db, ref, onValue, update, get, set, push, remove };

// ── Canva Links ───────────────────────────────────────────────────────────
export async function saveCanvaLink(linkData) {
  const r = push(ref(db, "canvaLinks"));
  await set(r, { ...linkData, id: r.key, createdAt: Date.now() });
  return r.key;
}
export async function deleteCanvaLink(id) {
  await remove(ref(db, `canvaLinks/${id}`));
}
export async function updateCanvaLink(id, data) {
  await update(ref(db, `canvaLinks/${id}`), data);
}
export function subscribeCanvaLinks(callback) {
  return onValue(ref(db, "canvaLinks"), snap => {
    callback(Object.values(snap.val() || {}).sort((a,b) => b.createdAt - a.createdAt));
  });
}

// ── Space config (custom names, owners) ───────────────────────────────────
export async function getSpaceConfig(spaceId) {
  const snap = await get(ref(db, `spaceConfig/${spaceId}`));
  return snap.val() || null;
}
export async function saveSpaceConfig(spaceId, config) {
  await update(ref(db, `spaceConfig/${spaceId}`), config);
}
export function subscribeSpaceConfigs(callback) {
  return onValue(ref(db, "spaceConfig"), snap => {
    callback(snap.val() || {});
  });
}

// ── Custom spaces ─────────────────────────────────────────────────────────
export async function getCustomSpaces() {
  const snap = await get(ref(db, "customSpaces"));
  return snap.val() || {};
}
export async function saveCustomSpace(spaceId, data) {
  await set(ref(db, `customSpaces/${spaceId}`), data);
}
export async function deleteCustomSpace(spaceId) {
  await remove(ref(db, `customSpaces/${spaceId}`));
}
export function subscribeCustomSpaces(callback) {
  return onValue(ref(db, "customSpaces"), snap => {
    callback(snap.val() || {});
  });
}

// ── Custom folders ────────────────────────────────────────────
export async function saveFolder(folderData) {
  const r = push(ref(db, "folders"));
  await set(r, { ...folderData, id: r.key, createdAt: Date.now() });
  return r.key;
}
export async function deleteFolder(id) {
  await remove(ref(db, `folders/${id}`));
}
export function subscribeFolders(callback) {
  return onValue(ref(db, "folders"), snap => {
    callback(Object.values(snap.val() || {}).sort((a,b) => a.name?.localeCompare(b.name)));
  });
}

// ── Move file to folder ───────────────────────────────────────
export async function moveFileToFolder(fileId, folder) {
  await update(ref(db, `files/${fileId}`), { folder });
}

// ── Chat groups ───────────────────────────────────────────────
export async function saveCustomGroup(groupData) {
  const r = push(ref(db, "chatGroups"));
  await set(r, { ...groupData, id: r.key, createdAt: Date.now() });
  return r.key;
}
export async function deleteCustomGroup(id) {
  await remove(ref(db, `chatGroups/${id}`));
  await remove(ref(db, `chat/${id}`));
}
export function subscribeCustomGroups(callback) {
  return onValue(ref(db, "chatGroups"), snap => {
    callback(Object.values(snap.val() || {}).sort((a,b) => a.createdAt - b.createdAt));
  });
}

// ── Message edit / delete ─────────────────────────────────────
export async function editMessage(roomId, msgId, newText) {
  await update(ref(db, `chat/${roomId}/${msgId}`), { text: newText, edited: true, editedAt: Date.now() });
}
export async function deleteMessage(roomId, msgId) {
  await remove(ref(db, `chat/${roomId}/${msgId}`));
}

// ── Group member management ───────────────────────────────────
export async function updateGroupMembers(groupId, members) {
  await update(ref(db, `chatGroups/${groupId}`), { members });
}
export async function getGroupData(groupId) {
  const snap = await get(ref(db, `chatGroups/${groupId}`));
  return snap.val();
}

// ── Presence (online/offline) ─────────────────────────────────
export function setPresence(uid, online) {
  return set(ref(db, `presence/${uid}`), {
    online,
    lastSeen: Date.now()
  });
}
export function subscribePresence(callback) {
  return onValue(ref(db, "presence"), snap => {
    callback(snap.val() || {});
  });
}

// ── Unread message counts ─────────────────────────────────────
export async function markRoomRead(uid, roomId) {
  await set(ref(db, `unread/${uid}/${roomId}`), 0);
}
export async function incrementUnread(uid, roomId) {
  // Use atomic server-side increment — no read-then-write round trip
  await update(ref(db, `unread/${uid}`), { [roomId]: increment(1) });
}
export function subscribeUnread(uid, callback) {
  return onValue(ref(db, `unread/${uid}`), snap => {
    callback(snap.val() || {});
  });
}
