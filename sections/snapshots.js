/**
 * sections/snapshots.js — Snapshots section
 *
 * Named captures of client + current-screen variable values, persisted
 * in chrome.storage.local per app origin. Restore writes scalars back
 * through the page's setters (complex values are export-only); snapshots
 * can be exported to and imported from JSON files.
 */

import { esc, escAttr, sendMessage } from '../utils/helpers.js';
import { show, hide, toast } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
const STORAGE_KEY = "osSnapshots";

let snapshots = [];       // snapshots for the current origin, newest first
let currentOrigin = "";
let scanned = false;
const expandedIds = new Set();

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const listEl = document.getElementById("snapshot-list");
const countEl = document.getElementById("snapshot-count");
const nameInput = document.getElementById("input-snapshot-name");
const captureBtn = document.getElementById("btn-snapshot-capture");
const importBtn = document.getElementById("btn-snapshot-import");
const fileInput = document.getElementById("input-snapshot-file");

export const sectionEl = document.getElementById("snapshot-section");

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

export function init() {
  captureBtn.addEventListener("click", handleCapture);
  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleImportFile);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCapture();
  });

  listEl.addEventListener("click", (e) => {
    const restoreBtn = e.target.closest(".btn-snapshot-restore");
    if (restoreBtn) { handleRestore(restoreBtn.dataset.id); return; }

    const exportBtn = e.target.closest(".btn-snapshot-export");
    if (exportBtn) { handleExport(exportBtn.dataset.id); return; }

    const deleteBtn = e.target.closest(".btn-snapshot-delete");
    if (deleteBtn) { handleDelete(deleteBtn.dataset.id); return; }

    const rowMain = e.target.closest(".snapshot-row-main");
    if (rowMain) {
      const id = rowMain.closest(".snapshot-row").dataset.id;
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      render();
    }
  });
}

/** No scan payload — snapshots come from storage. Kept for the section interface. */
export function setData() {}

export function getState() {
  return { count: snapshots.length };
}

/** Called after every successful scan: load this origin's snapshots. */
export async function onScanned() {
  scanned = true;
  try {
    const tab = await chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]);
    currentOrigin = tab?.url ? new URL(tab.url).origin : "";
  } catch {
    currentOrigin = "";
  }
  await loadSnapshots();
  render();
  show(sectionEl);
}

export function render() {
  countEl.textContent = snapshots.length;

  if (snapshots.length === 0) {
    listEl.innerHTML = `<div class="net-empty">No snapshots for this app yet — capture one to save the current variable state.</div>`;
    return;
  }

  let html = "";
  for (const snap of snapshots) {
    html += buildRow(snap);
  }
  listEl.innerHTML = html;
}

/* ================================================================== */
/*  Storage                                                            */
/* ================================================================== */

async function loadSnapshots() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const all = stored[STORAGE_KEY] || {};
  snapshots = all[currentOrigin] || [];
}

async function saveSnapshots() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const all = stored[STORAGE_KEY] || {};
  all[currentOrigin] = snapshots;
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
}

/* ================================================================== */
/*  Event handlers                                                     */
/* ================================================================== */

async function handleCapture() {
  if (!scanned) return;

  const result = await sendMessage({ action: "SNAPSHOT_CAPTURE" }).catch(() => null);
  if (!result?.ok) {
    toast(result?.error || "Capture failed.", "error");
    return;
  }

  const snap = result.snapshot;
  const varCount = (snap.clientVars?.length || 0) + (snap.screenVars?.length || 0);
  if (varCount === 0) {
    toast("Nothing to capture — no variables found.", "error");
    return;
  }

  const defaultName = `${snap.context.screenPath || "Snapshot"} — ${new Date().toLocaleString()}`;
  snap.id = "snap" + Date.now();
  snap.name = nameInput.value.trim() || defaultName;

  snapshots.unshift(snap);
  await saveSnapshots();

  nameInput.value = "";
  render();
  toast(`Captured ${varCount} variables.`, "success");
}

async function handleRestore(id) {
  const snap = snapshots.find(s => s.id === id);
  if (!snap) return;

  const result = await sendMessage({ action: "SNAPSHOT_RESTORE", snapshot: snap }).catch(() => null);
  if (!result?.ok) {
    toast(result?.error || "Restore failed.", "error");
    return;
  }

  const skipped = result.skipped || [];
  if (skipped.length === 0) {
    toast(`Restored ${result.restored} variables.`, "success");
  } else {
    toast(`Restored ${result.restored} variables, ${skipped.length} skipped.`, skipped.length > result.restored ? "error" : "info");
    console.warn("[OutSystems Toolkit] Snapshot restore skipped:", skipped);
  }
}

function handleExport(id) {
  const snap = snapshots.find(s => s.id === id);
  if (!snap) return;

  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = snap.name.replace(/[^\w\- ]+/g, "_") + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

async function handleDelete(id) {
  snapshots = snapshots.filter(s => s.id !== id);
  expandedIds.delete(id);
  await saveSnapshots();
  render();
  toast("Snapshot deleted.", "info");
}

async function handleImportFile() {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";
  if (!file) return;

  let snap;
  try {
    snap = JSON.parse(await file.text());
  } catch {
    toast("Invalid JSON file.", "error");
    return;
  }

  if (!snap || !Array.isArray(snap.clientVars) || !Array.isArray(snap.screenVars) || !snap.context) {
    toast("Not a valid snapshot file.", "error");
    return;
  }

  snap.id = "snap" + Date.now();
  snap.name = snap.name || file.name.replace(/\.json$/i, "");
  snapshots.unshift(snap);
  await saveSnapshots();
  render();
  toast(`Imported "${snap.name}".`, "success");
}

/* ================================================================== */
/*  Rendering helpers                                                  */
/* ================================================================== */

function buildRow(snap) {
  const isExpanded = expandedIds.has(snap.id);
  const clientCount = snap.clientVars?.length || 0;
  const screenCount = snap.screenVars?.length || 0;
  const captured = snap.context?.capturedAt ? new Date(snap.context.capturedAt).toLocaleString() : "";

  let details = "";
  if (isExpanded) {
    const varLines = []
      .concat((snap.clientVars || []).map(v => `${v.module}.${v.name} = ${JSON.stringify(v.value)}`))
      .concat((snap.screenVars || []).map(v => `${v.source && v.source !== "Screen" ? v.source + " :: " : ""}${v.name}${v.complex ? " [complex — export only]" : ""} = ${JSON.stringify(v.value)}`));
    details = `
    <div class="net-details">
      <div class="net-detail-url">${esc(snap.context?.url || "")}</div>
      <div class="net-detail-label">Variables</div>
      <pre class="net-payload">${esc(varLines.join("\n") || "(none)")}</pre>
    </div>`;
  }

  return `
  <div class="var-row snapshot-row${isExpanded ? " net-row-expanded" : ""}" data-id="${escAttr(snap.id)}">
    <div class="snapshot-row-main">
      <div class="snapshot-info">
        <span class="var-name">${esc(snap.name)}</span>
        <span class="snapshot-meta">${esc(captured)} · ${clientCount} client + ${screenCount} screen vars</span>
      </div>
      <div class="snapshot-actions">
        <button class="btn-trigger-action btn-snapshot-restore" data-id="${escAttr(snap.id)}" title="Restore this snapshot">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
          Restore
        </button>
        <button class="btn-snapshot-icon btn-snapshot-export" data-id="${escAttr(snap.id)}" title="Export as JSON">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </button>
        <button class="btn-snapshot-icon btn-snapshot-delete" data-id="${escAttr(snap.id)}" title="Delete snapshot">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
    ${details}
  </div>`;
}
