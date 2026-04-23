// ── Firebase Storage helper ────────────────────────────────────────────────
// Uploads a File object to Firebase Storage and returns the public download URL.
// All base64 is eliminated — only the URL is stored in the Realtime Database.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getStorage, ref as sref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Re-use the already-initialised Firebase app from firebase.js
function getApp() {
  const apps = getApps();
  if (apps.length) return apps[0];
  throw new Error("Firebase app not initialised — import firebase.js first");
}

function getStore() {
  return getStorage(getApp());
}

/**
 * Upload a File/Blob to Firebase Storage.
 * @param {File} file  — the raw File object from an <input type="file">
 * @param {string} path — storage path, e.g. "projects/abc123/attachment"
 * @returns {Promise<{url: string, path: string}>}
 */
export async function uploadFile(file, path) {
  const storage  = getStore();
  const fileRef  = sref(storage, path);
  const snap     = await uploadBytes(fileRef, file, { contentType: file.type });
  const url      = await getDownloadURL(snap.ref);
  return { url, path };
}

/**
 * Delete a file from Firebase Storage by its storage path.
 * @param {string} path — the same path used when uploading
 */
export async function deleteStorageFile(path) {
  try {
    const storage = getStore();
    await deleteObject(sref(storage, path));
  } catch (e) {
    // File may already be gone — ignore
    console.warn("[Storage] deleteStorageFile:", e.message);
  }
}

/**
 * Upload a project card attachment.
 * Returns { url, path, fileName, fileType, fileSize }
 */
export async function uploadProjectFile(projectId, file) {
  const path = `projects/${projectId}/${Date.now()}_${file.name}`;
  const { url } = await uploadFile(file, path);
  return { url, path, fileName: file.name, fileType: file.type, fileSize: file.size };
}

/**
 * Upload a checklist item attachment.
 */
export async function uploadChecklistFile(projectId, checkId, file) {
  const path = `checklists/${projectId}/${checkId}_${Date.now()}_${file.name}`;
  const { url } = await uploadFile(file, path);
  return { url, path, fileName: file.name, fileType: file.type, fileSize: file.size };
}

/**
 * Upload a file to the file library.
 */
export async function uploadLibraryFile(file, uploader) {
  const path = `library/${uploader}/${Date.now()}_${file.name}`;
  const { url } = await uploadFile(file, path);
  return { url, path, fileName: file.name, fileType: file.type, fileSize: file.size };
}

/**
 * Upload a chat image.
 */
export async function uploadChatImage(roomId, sender, file) {
  const path = `chat/${roomId}/${sender}_${Date.now()}_${file.name}`;
  const { url } = await uploadFile(file, path);
  return { url, path };
}
