/**
 * sections/tracer.js — Action Trace section
 *
 * Chronological timeline of client-side logic recorded by
 * pageScript/actionTracer.js: screen actions, event handlers, server
 * actions, data actions, and aggregate refreshes, with arguments,
 * duration, and errors. Polls while the section is expanded.
 */

import { esc, escAttr, sendMessage, debounce } from '../utils/helpers.js';
import { show, hide, toast } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
const MAX_PANEL_ENTRIES = 400;
const POLL_MS = 1200;

let entries = [];
let lastSeq = 0;
let enabled = true;
let scanned = false;
let searchTerm = "";
let pollInFlight = false;
const expandedIds = new Set();

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const listEl = document.getElementById("tracer-list");
const countEl = document.getElementById("tracer-count");
const searchInput = document.getElementById("input-search-tracer");
const toggleBtn = document.getElementById("btn-tracer-toggle");
const toggleLabel = document.getElementById("tracer-toggle-label");
const clearBtn = document.getElementById("btn-tracer-clear");

export const sectionEl = document.getElementById("tracer-section");

/* ================================================================== */
/*  Kind badges                                                        */
/* ================================================================== */
const KIND_LABEL = {
  "screen-action": "Action",
  "event": "Event",
  "server-action": "Server",
  "data-action": "Data",
  "aggregate": "Aggregate",
};

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

export function init() {
  searchInput.addEventListener("input", debounce(() => {
    searchTerm = searchInput.value.trim().toLowerCase();
    render();
  }, 200));

  toggleBtn.addEventListener("click", handleToggle);
  clearBtn.addEventListener("click", handleClear);

  listEl.addEventListener("click", (e) => {
    const rowMain = e.target.closest(".trace-row-main");
    if (rowMain) {
      const id = rowMain.closest(".trace-row").dataset.id;
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      render();
    }
  });

  setInterval(poll, POLL_MS);
}

/** No scan payload — data arrives via polling. Kept for the section interface. */
export function setData() {}

export function getState() {
  return { count: entries.length };
}

/**
 * Called after every successful scan: (re-)arm tracing on the page.
 * A fresh page (log newly created) starts with an empty panel.
 */
export async function onScanned() {
  const wasFresh = lastSeq === 0;
  const result = await sendMessage({ action: "TRACER_START" }).catch(() => null);
  if (result?.ok) {
    scanned = true;
    enabled = true;
    updateToggleUI();
    render();
    show(sectionEl);
    if (!wasFresh) poll();
  } else {
    scanned = false;
    hide(sectionEl);
  }
}

export function render() {
  countEl.textContent = entries.length;

  const filtered = searchTerm
    ? entries.filter(en =>
        (en.name || "").toLowerCase().includes(searchTerm) ||
        (en.source || "").toLowerCase().includes(searchTerm) ||
        (en.kind || "").toLowerCase().includes(searchTerm))
    : entries;

  if (filtered.length === 0) {
    const msg = entries.length === 0
      ? (enabled ? "Tracing — interact with the app to see actions fire…" : "Tracing paused.")
      : "No traced actions match your search.";
    listEl.innerHTML = `<div class="net-empty">${esc(msg)}</div>`;
    return;
  }

  let html = "";
  for (let i = filtered.length - 1; i >= 0; i--) {
    html += buildRow(filtered[i]);
  }
  listEl.innerHTML = html;
}

/* ================================================================== */
/*  Polling                                                            */
/* ================================================================== */

async function poll() {
  if (!scanned || pollInFlight) return;
  if (sectionEl.classList.contains("hidden")) return;
  if (sectionEl.classList.contains("collapsed")) return;

  pollInFlight = true;
  try {
    const result = await sendMessage({ action: "TRACER_GET_ENTRIES", sinceSeq: lastSeq }).catch(() => null);
    if (!result?.ok) return;

    // Page reloaded — its log restarted with lower sequence numbers.
    if (result.lastSeq < lastSeq) {
      entries = [];
      expandedIds.clear();
      lastSeq = 0;
    }

    enabled = !!result.enabled;
    updateToggleUI();

    let changed = false;

    if (result.entries.length > 0) {
      entries.push(...result.entries);
      while (entries.length > MAX_PANEL_ENTRIES) entries.shift();
      lastSeq = result.lastSeq;
      changed = true;
    }

    // Refresh async entries that were still running when drained
    const runningIds = entries.filter(en => en.status === "running").map(en => en.id);
    if (runningIds.length > 0) {
      const refresh = await sendMessage({ action: "TRACER_GET_BY_IDS", ids: runningIds }).catch(() => null);
      if (refresh?.ok) {
        for (const fresh of refresh.entries) {
          const idx = entries.findIndex(en => en.id === fresh.id);
          if (idx !== -1 && entries[idx].status !== fresh.status) {
            entries[idx] = fresh;
            changed = true;
          }
        }
      }
    }

    if (changed) render();
  } finally {
    pollInFlight = false;
  }
}

/* ================================================================== */
/*  Event handlers                                                     */
/* ================================================================== */

async function handleToggle() {
  const result = await sendMessage({ action: "TRACER_SET_ENABLED", enabled: !enabled }).catch(() => null);
  if (result?.ok) {
    enabled = !!result.enabled;
    updateToggleUI();
    toast(enabled ? "Tracing resumed." : "Tracing paused.", "info");
    render();
  } else {
    toast(result?.error || "Could not toggle tracing.", "error");
  }
}

async function handleClear() {
  await sendMessage({ action: "TRACER_CLEAR" }).catch(() => null);
  entries = [];
  expandedIds.clear();
  render();
}

function updateToggleUI() {
  toggleLabel.textContent = enabled ? "Pause" : "Resume";
  toggleBtn.classList.toggle("active", !enabled);
}

/* ================================================================== */
/*  Rendering helpers                                                  */
/* ================================================================== */

function statusIcon(entry) {
  if (entry.status === "running") return `<span class="trace-status trace-status-running" title="Still running">…</span>`;
  if (entry.status === "error") return `<span class="trace-status trace-status-error" title="${escAttr(entry.error || "Error")}">✕</span>`;
  return `<span class="trace-status trace-status-ok">✓</span>`;
}

function timeLabel(iso) {
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return "";
  }
}

function buildRow(entry) {
  const isExpanded = expandedIds.has(entry.id);
  const kindLabel = KIND_LABEL[entry.kind] || entry.kind;
  const duration = entry.durationMs !== null ? `${entry.durationMs} ms` : "";

  let details = "";
  if (isExpanded) {
    const args = (entry.args || []).filter(a => a !== "[callContext]");
    const argsJson = args.length > 0 ? JSON.stringify(args, null, 2) : "(no arguments)";
    const errorBlock = entry.error
      ? `<div class="net-detail-label">Error</div><pre class="net-payload trace-error-payload">${esc(entry.error)}</pre>`
      : "";
    details = `
    <div class="net-details">
      <div class="net-detail-url">${esc(entry.methodName)} — ${esc(entry.source)}</div>
      <div class="net-detail-label">Arguments</div>
      <pre class="net-payload">${esc(argsJson)}</pre>
      ${errorBlock}
    </div>`;
  }

  return `
  <div class="var-row trace-row${isExpanded ? " net-row-expanded" : ""}" data-id="${escAttr(entry.id)}">
    <div class="trace-row-main">
      ${statusIcon(entry)}
      <span class="trace-kind trace-kind-${escAttr(entry.kind)}">${esc(kindLabel)}</span>
      <span class="net-endpoint" title="${escAttr(entry.methodName)}">${esc(entry.name)}</span>
      <span class="trace-source">${esc(entry.source)}</span>
      <span class="net-meta">${esc(duration)}</span>
      <span class="net-meta net-time">${esc(timeLabel(entry.ts))}</span>
    </div>
    ${details}
  </div>`;
}
