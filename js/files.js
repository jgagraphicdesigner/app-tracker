import { saveFile, deleteFile, subscribeFiles, updateFile } from "./firebase.js";
import { uploadLibraryFile, deleteStorageFile } from "./storage.js";
import { authGuard, getCurrentSpace, setupSidebar, setupNotifBadge, initTheme, updateThemeBtn, toggleTheme } from "./helpers.js";
import { renderSidebar, renderBottomNav } from "./sidebar.js";

const CURRENT_USER = authGuard();
if (!CURRENT_USER) throw new Error("not auth");
document.getElementById("appShell").insertAdjacentHTML("afterbegin", renderSidebar("files", getCurrentSpace()));
document.querySelector(".main").insertAdjacentHTML("beforeend", renderBottomNav("files"));
setupSidebar(CURRENT_USER);
setupNotifBadge(CURRENT_USER);
initTheme(); updateThemeBtn(localStorage.getItem("theme")||"light");
window.toggleTheme = toggleTheme;
window.doLogout = () => { sessionStorage.clear(); window.location.href = "../index.html"; };
window.switchSpace = s => {};

let allFiles    = [];
let activeFolder = "all";

function fileIcon(type) {
  if (!type) return "📄";
  if (type.includes("pdf"))   return "📄";
  if (type.includes("image")) return "🖼";
  if (type.includes("presentation") || type.includes("powerpoint")) return "📊";
  if (type.includes("spreadsheet") || type.includes("excel")) return "📈";
  return "📝";
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024*1024) return (bytes/1024).toFixed(0) + "KB";
  return (bytes/(1024*1024)).toFixed(1) + "MB";
}

window.selectFolder = function(el, folder) {
  activeFolder = folder;
  document.querySelectorAll(".library-folder").forEach(f => f.classList.remove("active"));
  el.classList.add("active");
  renderGrid();
};

function renderGrid() {
  const grid = document.getElementById("libraryGrid");
  const filtered = activeFolder === "all" ? allFiles : allFiles.filter(f => f.folder === activeFolder);
  if (!filtered.length) {
    grid.innerHTML = `<div style="color:var(--text-3);font-size:13px;grid-column:1/-1;padding:2rem 0">No files in this folder yet.</div>`;
    return;
  }
  grid.innerHTML = filtered.map(f => `
    <div class="library-file-card" onclick="openFile('${f.id}')">
      <div class="library-file-icon">${fileIcon(f.type)}</div>
      <div class="library-file-name">${f.name}</div>
      <div class="library-file-meta">${formatBytes(f.size)} · ${f.folder||"All"}</div>
    </div>`).join("");
}

window.openFile = function(id) {
  const f = allFiles.find(x => x.id === id); if (!f) return;
  document.getElementById("fileViewerTitle").textContent = f.name;
  const body = document.getElementById("fileViewerBody");
  if (f.type?.includes("image")) {
    body.innerHTML = `<img src="${f.data}" style="max-width:100%;border-radius:8px"/>`;
  } else if (f.type?.includes("pdf")) {
    body.innerHTML = `<iframe src="${f.data}" style="width:100%;height:500px;border:none;border-radius:8px"></iframe>`;
  } else {
    body.innerHTML = `<div style="text-align:center;padding:2rem"><div style="font-size:48px">${fileIcon(f.type)}</div><div style="margin-top:12px;font-size:14px;color:var(--text-2)">${f.name}</div><a href="${f.data}" download="${f.name}" class="btn-primary" style="display:inline-block;margin-top:14px;text-decoration:none;padding:8px 16px;background:var(--purple);color:white;border-radius:var(--radius-sm)">Download</a></div>`;
  }
  document.getElementById("fileDeleteBtn").onclick = async () => {
    if (!confirm("Delete this file?")) return;
    await deleteFile(id);
    document.getElementById("fileViewerModal").classList.remove("open");
  };
  document.getElementById("fileViewerModal").classList.add("open");
};

window.uploadLibFile = async function(event) {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 4*1024*1024) { alert("File too large — max 4MB"); return; }
  const progress = document.getElementById("uploadProgress");
  progress.textContent = "Uploading..."; progress.style.display = "block";
  const folder = activeFolder === "all" ? "All" : activeFolder;
  const reader  = new FileReader();
  reader.onload = async e => {
    await saveFile({ name:file.name, type:file.type, size:file.size, data:e.target.result, folder, uploadedBy:CURRENT_USER });
    progress.textContent = "File uploaded!";
    setTimeout(() => { progress.style.display = "none"; }, 2000);
    event.target.value = "";
  };
};

subscribeFiles(files => {
  allFiles = files;
  renderGrid();
});
