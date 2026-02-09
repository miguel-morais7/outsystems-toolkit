/**
 * sections/screens.js — Screens section
 *
 * Manages state, rendering, and event delegation for the
 * screen-navigation panel.
 */

import { esc, escAttr, debounce, sendMessage } from '../utils/helpers.js';
import { show, hide } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allScreens          = [];
let screenBaseUrl       = "";
let currentScreen       = "";
let collapsedScreenFlows = {};

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const inputSearch = document.getElementById("input-search-screens");
const screenList  = document.getElementById("screen-list");
const screenCount = document.getElementById("screen-count");
const emptyState  = document.getElementById("empty-state");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("screen-section");

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));

  screenList.addEventListener("click", (e) => {
    // Navigate button
    const navBtn = e.target.closest(".btn-navigate");
    if (navBtn) {
      sendMessage({ action: "NAVIGATE", url: navBtn.dataset.url });
      return;
    }

    // Module header collapse
    const header = e.target.closest(".module-header");
    if (header) {
      const mod  = header.dataset.module;
      const body = header.nextElementSibling;
      const isCollapsed = header.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      collapsedScreenFlows[mod] = isCollapsed;
    }
  });
}

/** Replace section data after a scan. */
export function setData(screens, baseUrl, current) {
  allScreens    = screens;
  screenBaseUrl = baseUrl || "";
  currentScreen = current || "";
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: allScreens.length };
}

/** Render (or re-render) the screens list. */
export function render() {
  const query = inputSearch.value.toLowerCase().trim();

  let filtered = allScreens;
  if (query) {
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.screenUrl.toLowerCase().includes(query) ||
        s.flow.toLowerCase().includes(query)
    );
  }

  screenCount.textContent = filtered.length;

  if (filtered.length === 0 && allScreens.length > 0) {
    screenList.innerHTML = `<div class="no-results">No screens match your filter.</div>`;
    show(sectionEl);
    return;
  }

  if (filtered.length === 0) {
    hide(sectionEl);
    return;
  }

  // Group by flow
  const groups = {};
  filtered.forEach((s) => {
    const flow = s.flow || "Other";
    if (!groups[flow]) groups[flow] = [];
    groups[flow].push(s);
  });

  let html = "";
  for (const flow of Object.keys(groups).sort()) {
    const screens     = groups[flow];
    const isCollapsed = !!collapsedScreenFlows[flow];

    html += `<div class="module-group" data-module="${esc(flow)}">`;
    html += `<div class="module-header ${isCollapsed ? "collapsed" : ""}" data-module="${esc(flow)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(flow)}</span>`;
    html += `<span class="count-badge">${screens.length}</span>`;
    html += `</div>`;

    html += `<div class="module-body ${isCollapsed ? "collapsed" : ""}">`;
    for (const s of screens) {
      html += buildScreenRow(s);
    }
    html += `</div>`;
    html += `</div>`;
  }

  screenList.innerHTML = html;
  show(sectionEl);
  hide(emptyState);
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

function buildScreenRow(s) {
  const isCurrent = s.screenUrl === currentScreen;
  const navUrl    = screenBaseUrl + "/" + s.screenUrl;

  return `
    <div class="var-row screen-row ${isCurrent ? "screen-current" : ""}" data-screen-url="${esc(s.screenUrl)}">
      <div class="var-info">
        <span class="var-name">${esc(s.name)}</span>
        ${isCurrent ? '<span class="var-type screen-current-badge">CURRENT</span>' : ''}
      </div>
      <div class="var-value-wrap">
        <button class="btn-icon btn-navigate" data-url="${escAttr(navUrl)}" title="Navigate to ${esc(s.name)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      </div>
    </div>`;
}
