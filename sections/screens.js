/**
 * sections/screens.js — Screens section
 *
 * Manages state, rendering, and event delegation for the
 * screen-navigation panel. Supports expandable screen rows
 * that display screen variables, aggregates, and actions.
 */

import { esc, escAttr, debounce, sendMessage } from '../utils/helpers.js';
import { show, hide } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allScreens = [];
let screenBaseUrl = "";
let moduleName = "";
let currentScreen = "";
let collapsedScreenFlows = {};
let expandedScreens = {};  // screenUrl -> true/false
let screenDetailsCache = {};  // screenUrl -> { variables, aggregates, serverActions, screenActions }
let loadingScreens = {};  // screenUrl -> true (while fetching)

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const inputSearch = document.getElementById("input-search-screens");
const screenList = document.getElementById("screen-list");
const screenCount = document.getElementById("screen-count");
const emptyState = document.getElementById("empty-state");

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
      e.stopPropagation();
      sendMessage({ action: "NAVIGATE", url: navBtn.dataset.url });
      return;
    }

    // Screen row expand/collapse (click on the row itself, not navigate button)
    const screenRow = e.target.closest(".screen-row");
    if (screenRow && !e.target.closest(".btn-navigate")) {
      const screenUrl = screenRow.dataset.screenUrl;
      const flow = screenRow.dataset.flow;
      const name = screenRow.dataset.name;
      toggleScreenExpand(screenUrl, flow, name);
      return;
    }

    // Module header collapse
    const header = e.target.closest(".module-header");
    if (header) {
      const mod = header.dataset.module;
      const body = header.nextElementSibling;
      const isCollapsed = header.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      collapsedScreenFlows[mod] = isCollapsed;
    }
  });
}

/** Replace section data after a scan. */
export function setData(screens, baseUrl, modName, current) {
  allScreens = screens;
  screenBaseUrl = baseUrl || "";
  moduleName = modName || "";
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
    const screens = groups[flow];
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
  const isExpanded = !!expandedScreens[s.screenUrl];
  const isLoading = !!loadingScreens[s.screenUrl];
  const navUrl = screenBaseUrl + "/" + s.screenUrl;
  const details = screenDetailsCache[s.screenUrl];

  let html = `
    <div class="var-row screen-row screen-row-expandable ${isCurrent ? "screen-current" : ""} ${isExpanded ? "expanded" : ""}" 
         data-screen-url="${esc(s.screenUrl)}" data-flow="${esc(s.flow)}" data-name="${esc(s.name)}">
      <div class="var-info">
        <svg class="screen-expand-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
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

  // Add details panel if expanded
  if (isExpanded) {
    html += `<div class="screen-details">`;
    if (isLoading) {
      html += `<div class="screen-details-loading"><span class="mini-spinner"></span> Loading...</div>`;
    } else if (details) {
      html += buildScreenDetails(details);
    }
    html += `</div>`;
  }

  return html;
}

function buildScreenDetails(details) {
  let html = "";

  // Input Parameters
  if (details.inputParameters.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Input Parameters</div>`;
    for (const v of details.inputParameters) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(v.name)}</span>
        <span class="screen-detail-type">${esc(v.type)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Local Variables
  if (details.localVariables.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Local Variables</div>`;
    for (const v of details.localVariables) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(v.name)}</span>
        <span class="screen-detail-type">${esc(v.type)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Aggregates
  if (details.aggregates.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Aggregates</div>`;
    for (const a of details.aggregates) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(a.name)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Data Actions
  if (details.dataActions && details.dataActions.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Data Actions</div>`;
    for (const da of details.dataActions) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(da.name)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Server Actions
  if (details.serverActions.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Server Actions</div>`;
    for (const sa of details.serverActions) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(sa.name)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // Screen Actions
  if (details.screenActions.length > 0) {
    html += `<div class="screen-detail-section">`;
    html += `<div class="screen-detail-header">Screen Actions</div>`;
    for (const ca of details.screenActions) {
      html += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(ca.name)}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // If no details at all
  const hasDataActions = details.dataActions && details.dataActions.length > 0;
  if (details.inputParameters.length === 0 && details.localVariables.length === 0 &&
    details.aggregates.length === 0 && !hasDataActions && details.serverActions.length === 0 &&
    details.screenActions.length === 0) {
    html += `<div class="screen-details-empty">No details found for this screen.</div>`;
  }

  return html;
}

async function toggleScreenExpand(screenUrl, flow, screenName) {
  // Toggle expansion
  expandedScreens[screenUrl] = !expandedScreens[screenUrl];

  // If collapsing, just re-render
  if (!expandedScreens[screenUrl]) {
    render();
    return;
  }

  // If already cached, just re-render
  if (screenDetailsCache[screenUrl]) {
    render();
    return;
  }

  // Fetch details
  loadingScreens[screenUrl] = true;
  render();

  try {
    const response = await sendMessage({
      action: "FETCH_SCREEN_DETAILS",
      baseUrl: screenBaseUrl,
      moduleName: moduleName,
      flow: flow,
      screenName: screenName,
    });

    if (response.ok) {
      screenDetailsCache[screenUrl] = {
        inputParameters: response.inputParameters || [],
        localVariables: response.localVariables || [],
        aggregates: response.aggregates || [],
        dataActions: response.dataActions || [],
        serverActions: response.serverActions || [],
        screenActions: response.screenActions || [],
      };
    } else {
      screenDetailsCache[screenUrl] = {
        inputParameters: [],
        localVariables: [],
        aggregates: [],
        dataActions: [],
        serverActions: [],
        screenActions: [],
        error: response.error,
      };
    }
  } catch (e) {
    screenDetailsCache[screenUrl] = {
      inputParameters: [],
      localVariables: [],
      aggregates: [],
      dataActions: [],
      serverActions: [],
      screenActions: [],
      error: e.message,
    };
  }

  loadingScreens[screenUrl] = false;
  render();
}
