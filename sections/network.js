/**
 * sections/network.js — Server Calls section
 *
 * Live log of OutSystems server round-trips (screenservices calls)
 * captured by pageScript/networkInspector.js. Polls the page for new
 * entries while the section is expanded; supports pause/resume, clear,
 * search, expandable request/response payloads, and replay.
 */

import { esc, escAttr, sendMessage, debounce } from '../utils/helpers.js';
import { show, hide, toast } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
const MAX_PANEL_ENTRIES = 300;
const POLL_MS = 1200;

let entries = [];          // captured calls, oldest first
let lastSeq = 0;           // last page-side sequence number seen
let enabled = true;        // capture enabled (mirrors page state)
let scanned = false;       // at least one successful scan happened
let searchTerm = "";
let pollTimer = null;
let pollInFlight = false;
const expandedIds = new Set();

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const listEl = document.getElementById("network-list");
const countEl = document.getElementById("network-count");
const searchInput = document.getElementById("input-search-network");
const toggleBtn = document.getElementById("btn-network-toggle");
const toggleLabel = document.getElementById("network-toggle-label");
const clearBtn = document.getElementById("btn-network-clear");

export const sectionEl = document.getElementById("network-section");

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
    const replayBtn = e.target.closest(".btn-net-replay");
    if (replayBtn) {
      e.stopPropagation();
      handleReplay(replayBtn.dataset.id);
      return;
    }
    // Only toggle expansion from the summary line — clicks inside the
    // payload details (e.g. selecting JSON text) must not collapse the row.
    const rowMain = e.target.closest(".net-row-main");
    if (rowMain) {
      const row = rowMain.closest(".net-row");
      const id = row.dataset.id;
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      render();
    }
  });

  pollTimer = setInterval(poll, POLL_MS);
}

/** No scan payload — data arrives via polling. Kept for the section interface. */
export function setData() {}

export function getState() {
  return { count: entries.length };
}

/**
 * Called after every successful scan: (re-)arm the page hooks.
 * A fresh page (hooks newly installed) clears stale panel entries.
 */
export async function onScanned() {
  scanned = true;
  const result = await sendMessage({ action: "NETWORK_START" }).catch(() => null);
  if (result?.ok) {
    if (!result.alreadyInstalled) {
      entries = [];
      lastSeq = 0;
      expandedIds.clear();
    }
    enabled = true;
    updateToggleUI();
    render();
    show(sectionEl);
  } else {
    scanned = false;
    hide(sectionEl);
  }
}

export function render() {
  countEl.textContent = entries.length;

  const filtered = searchTerm
    ? entries.filter(en =>
        (en.endpoint || "").toLowerCase().includes(searchTerm) ||
        (en.url || "").toLowerCase().includes(searchTerm))
    : entries;

  if (filtered.length === 0) {
    const msg = entries.length === 0
      ? (enabled ? "Listening for server calls — interact with the app…" : "Capture paused.")
      : "No calls match your search.";
    listEl.innerHTML = `<div class="net-empty">${esc(msg)}</div>`;
    return;
  }

  // Newest first
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
    const result = await sendMessage({ action: "NETWORK_GET_ENTRIES", sinceSeq: lastSeq }).catch(() => null);
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
      for (const entry of result.entries) {
        entries.push(entry);
      }
      while (entries.length > MAX_PANEL_ENTRIES) entries.shift();
      lastSeq = result.lastSeq;
      changed = true;
    }

    // Refresh entries whose response hadn't settled when first drained
    const pendingIds = entries.filter(en => en.status === null && !en.error).map(en => en.id);
    if (pendingIds.length > 0) {
      const refresh = await sendMessage({ action: "NETWORK_GET_BY_IDS", ids: pendingIds }).catch(() => null);
      if (refresh?.ok && refresh.entries.length > 0) {
        for (const fresh of refresh.entries) {
          const idx = entries.findIndex(en => en.id === fresh.id);
          if (idx !== -1 && (entries[idx].status !== fresh.status || entries[idx].responseBody !== fresh.responseBody)) {
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
  const result = await sendMessage({ action: "NETWORK_SET_ENABLED", enabled: !enabled }).catch(() => null);
  if (result?.ok) {
    enabled = !!result.enabled;
    updateToggleUI();
    toast(enabled ? "Capture resumed." : "Capture paused.", "info");
    render();
  } else {
    toast(result?.error || "Could not toggle capture.", "error");
  }
}

async function handleClear() {
  await sendMessage({ action: "NETWORK_CLEAR" }).catch(() => null);
  entries = [];
  expandedIds.clear();
  render();
}

async function handleReplay(id) {
  const result = await sendMessage({ action: "NETWORK_REPLAY", id }).catch(() => null);
  if (result?.ok) {
    toast(`Replayed — HTTP ${result.status}`, "success");
    poll();
  } else {
    toast(result?.error || "Replay failed.", "error");
  }
}

function updateToggleUI() {
  toggleLabel.textContent = enabled ? "Pause" : "Resume";
  toggleBtn.classList.toggle("active", !enabled);
}

/* ================================================================== */
/*  Rendering helpers                                                  */
/* ================================================================== */

function statusChip(entry) {
  if (entry.error) return `<span class="net-status net-status-error" title="${escAttr(entry.error)}">ERR</span>`;
  if (entry.status === null) return `<span class="net-status net-status-pending">…</span>`;
  const cls = entry.status >= 200 && entry.status < 400 ? "net-status-ok" : "net-status-error";
  return `<span class="net-status ${cls}">${entry.status}</span>`;
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

function prettyJson(text) {
  if (!text) return "(empty)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function buildRow(entry) {
  const isExpanded = expandedIds.has(entry.id);
  const duration = entry.durationMs !== null ? `${entry.durationMs} ms` : "";
  const replayBadge = entry.replayed ? `<span class="net-replay-badge">replay</span>` : "";

  let details = "";
  if (isExpanded) {
    details = `
    <div class="net-details">
      <div class="net-detail-url">${esc(entry.method)} ${esc(entry.url)}</div>
      <div class="net-detail-label">Request</div>
      <pre class="net-payload">${esc(prettyJson(entry.requestBody))}</pre>
      <div class="net-detail-label">Response</div>
      <pre class="net-payload">${esc(entry.error ? entry.error : prettyJson(entry.responseBody))}</pre>
      <div class="net-detail-actions">
        <button class="btn-trigger-action btn-net-replay" data-id="${escAttr(entry.id)}" title="Re-issue this request">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Replay
        </button>
      </div>
    </div>`;
  }

  return `
  <div class="var-row net-row${isExpanded ? " net-row-expanded" : ""}" data-id="${escAttr(entry.id)}">
    <div class="net-row-main">
      ${statusChip(entry)}
      <span class="net-endpoint" title="${escAttr(entry.url)}">${esc(entry.endpoint)}</span>
      ${replayBadge}
      <span class="net-meta">${esc(duration)}</span>
      <span class="net-meta net-time">${esc(timeLabel(entry.startedAt))}</span>
    </div>
    ${details}
  </div>`;
}
