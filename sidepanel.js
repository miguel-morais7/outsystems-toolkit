/**
 * sidepanel.js — Side Panel UI logic
 *
 * Renders the interactive variable table, handles search/filter,
 * inline editing, and communicates with the service worker via
 * chrome.runtime.sendMessage.
 */

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allVariables = [];       // full dataset from last scan
let moduleList   = [];       // list of module names
let collapsedModules = {};   // { moduleName: true/false }

let allProducers = [];       // full producer dataset from last scan
let producerModuleList = []; // list of consumer module names
let collapsedProducerModules = {}; // { moduleName: true/false }

let allScreens = [];         // screen list from moduleinfo
let screenBaseUrl = "";      // base URL for navigation
let currentScreen = "";      // currently active screen
let collapsedScreenFlows = {}; // { flowName: true/false }

let collapsedSections = {};  // { sectionName: true/false }

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const btnScan      = document.getElementById("btn-scan");
const inputSearch  = document.getElementById("input-search");
const selectModule = document.getElementById("select-module");
const statusBar    = document.getElementById("status-bar");
const statusText   = document.getElementById("status-text");
const emptyState   = document.getElementById("empty-state");
const loading      = document.getElementById("loading");
const varSection   = document.getElementById("var-section");
const varList      = document.getElementById("var-list");
const varCount     = document.getElementById("var-count");
const producerSection = document.getElementById("producer-section");
const producerList = document.getElementById("producer-list");
const producerCount = document.getElementById("producer-count");
const inputSearchProducers = document.getElementById("input-search-producers");
const selectProducerModule = document.getElementById("select-producer-module");
const screenSection = document.getElementById("screen-section");
const screenList = document.getElementById("screen-list");
const screenCount = document.getElementById("screen-count");
const inputSearchScreens = document.getElementById("input-search-screens");
const toastBox     = document.getElementById("toast-container");

/* ================================================================== */
/*  Event listeners                                                    */
/* ================================================================== */
btnScan.addEventListener("click", doScan);
inputSearch.addEventListener("input", debounce(renderVariables, 150));
selectModule.addEventListener("change", renderVariables);
inputSearchProducers.addEventListener("input", debounce(renderProducers, 150));
selectProducerModule.addEventListener("change", renderProducers);
inputSearchScreens.addEventListener("input", debounce(renderScreens, 150));

// Section expand/collapse
document.addEventListener("click", (e) => {
  const sectionHeader = e.target.closest(".section-header[data-section]");
  if (sectionHeader) {
    const sectionName = sectionHeader.dataset.section;
    const section = sectionHeader.closest(".section");
    const isCollapsed = section.classList.toggle("collapsed");
    collapsedSections[sectionName] = isCollapsed;
  }
});

/* ================================================================== */
/*  SCAN                                                               */
/* ================================================================== */
async function doScan() {
  showLoading(true);
  hideStatus();

  try {
    const [result, screenResult] = await Promise.all([
      sendMessage({ action: "SCAN" }),
      sendMessage({ action: "FETCH_SCREENS" }).catch(() => null),
    ]);

    if (!result || !result.ok) {
      throw new Error(result?.error || "Unknown error during scan.");
    }

    allVariables = result.variables || [];
    moduleList   = result.modules || [];
    allProducers = result.producers || [];
    producerModuleList = result.producerModules || [];

    populateModuleFilter();
    populateProducerModuleFilter();
    renderVariables();
    renderProducers();

    // Screens
    if (screenResult && screenResult.ok) {
      allScreens = screenResult.screens || [];
      screenBaseUrl = screenResult.baseUrl || "";
      currentScreen = screenResult.currentScreen || "";
      renderScreens();
    } else {
      allScreens = [];
      hide(screenSection);
    }

    // Build status message
    const parts = [];
    if (allVariables.length > 0) {
      const varText = allVariables.length === 1 ? "variable" : "variables";
      const modText = moduleList.length === 1 ? "module" : "modules";
      parts.push(`${allVariables.length} ${varText} in ${moduleList.length} ${modText}`);
    }
    if (allProducers.length > 0) {
      const prodText = allProducers.length === 1 ? "producer" : "producers";
      const modText = producerModuleList.length === 1 ? "module" : "modules";
      parts.push(`${allProducers.length} ${prodText} in ${producerModuleList.length} ${modText}`);
    }
    if (allScreens.length > 0) {
      const scrText = allScreens.length === 1 ? "screen" : "screens";
      parts.push(`${allScreens.length} ${scrText}`);
    }

    if (parts.length > 0) {
      showStatus(`Found ${parts.join(", ")}.`, "success");
    } else {
      showStatus("No client variables, producers, or screens found on this page.", "error");
      showEmptyState();
    }
  } catch (err) {
    showStatus(err.message, "error");
    showEmptyState();
  } finally {
    showLoading(false);
  }
}

/* ================================================================== */
/*  SET variable                                                       */
/* ================================================================== */
async function doSet(moduleName, varName, rawValue, varType, rowEl) {
  try {
    const result = await sendMessage({
      action: "SET",
      module: moduleName,
      name: varName,
      value: rawValue,
      type: varType,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to set value.");
    }

    // Update local state
    const entry = allVariables.find(
      (v) => v.module === moduleName && v.name === varName
    );
    if (entry) entry.value = result.newValue;

    flashRow(rowEl, "saved");
    toast(`${varName} updated`, "success");
    return true;
  } catch (err) {
    flashRow(rowEl, "error");
    toast(err.message, "error");
    return false;
  }
}

/* ================================================================== */
/*  Render                                                             */
/* ================================================================== */
function renderVariables() {
  const query       = inputSearch.value.toLowerCase().trim();
  const filterMod   = selectModule.value;

  // Filter
  let filtered = allVariables;
  if (filterMod) {
    filtered = filtered.filter((v) => v.module === filterMod);
  }
  if (query) {
    filtered = filtered.filter(
      (v) =>
        v.name.toLowerCase().includes(query) ||
        v.module.toLowerCase().includes(query) ||
        String(v.value).toLowerCase().includes(query)
    );
  }

  varCount.textContent = filtered.length;

  if (filtered.length === 0 && allVariables.length > 0) {
    varList.innerHTML = `<div class="no-results">No variables match your filter.</div>`;
    show(varSection);
    return;
  }

  if (filtered.length === 0) {
    hide(varSection);
    return;
  }

  // Group by module
  const groups = {};
  filtered.forEach((v) => {
    if (!groups[v.module]) groups[v.module] = [];
    groups[v.module].push(v);
  });

  // Build HTML
  let html = "";
  for (const mod of Object.keys(groups).sort()) {
    const vars       = groups[mod];
    const isCollapsed = !!collapsedModules[mod];

    html += `<div class="module-group" data-module="${esc(mod)}">`;
    html += `<div class="module-header ${isCollapsed ? "collapsed" : ""}" data-module="${esc(mod)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(mod)}</span>`;
    html += `<span class="count-badge">${vars.length}</span>`;
    html += `</div>`; // module-header

    html += `<div class="module-body ${isCollapsed ? "collapsed" : ""}">`;
    for (const v of vars) {
      html += buildVarRow(v);
    }
    html += `</div>`; // module-body
    html += `</div>`; // module-group
  }

  varList.innerHTML = html;
  show(varSection);
  hide(emptyState);
  
  // Restore section collapsed state
  if (collapsedSections["variables"]) {
    varSection.classList.add("collapsed");
  }
}

function buildVarRow(v) {
  const id = `${v.module}__${v.name}`;
  let valueControl;

  if (v.type === "Boolean" && !v.readOnly) {
    const active = v.value === true || v.value === "true" || v.value === "True";
    valueControl = `
      <button class="bool-toggle ${active ? "active" : ""}"
              data-module="${esc(v.module)}" data-name="${esc(v.name)}" data-type="Boolean"
              ${v.readOnly ? "disabled" : ""}>
        <span class="knob"></span>
      </button>`;
  } else {
    const displayValue = v.value === null ? "" : String(v.value);
    valueControl = `
      <input class="var-value"
             type="text"
             value="${escAttr(displayValue)}"
             data-module="${esc(v.module)}"
             data-name="${esc(v.name)}"
             data-type="${esc(v.type)}"
             data-original="${escAttr(displayValue)}"
             ${v.readOnly ? "readonly" : ""}
             title="${v.readOnly ? "Read-only" : "Press Enter to save"}" />`;
  }

  return `
    <div class="var-row" data-id="${esc(id)}">
      <div class="var-info">
        <span class="var-name">${esc(v.name)}</span>
        <span class="var-type">${esc(v.type)}${v.readOnly ? " · read-only" : ""}</span>
      </div>
      <div class="var-value-wrap">
        ${valueControl}
      </div>
    </div>`;
}

/* ================================================================== */
/*  Render Producers                                                   */
/* ================================================================== */
function renderProducers() {
  const query = inputSearchProducers.value.toLowerCase().trim();
  const filterMod = selectProducerModule.value;

  // Filter
  let filtered = allProducers;
  if (filterMod) {
    filtered = filtered.filter((p) => p.module === filterMod);
  }
  if (query) {
    filtered = filtered.filter(
      (p) =>
        p.producer.toLowerCase().includes(query) ||
        p.module.toLowerCase().includes(query) ||
        p.status.toLowerCase().includes(query)
    );
  }

  producerCount.textContent = filtered.length;

  if (filtered.length === 0 && allProducers.length > 0) {
    producerList.innerHTML = `<div class="no-results">No producers match your filter.</div>`;
    show(producerSection);
    return;
  }

  if (filtered.length === 0) {
    hide(producerSection);
    return;
  }

  // Group by module
  const groups = {};
  filtered.forEach((p) => {
    if (!groups[p.module]) groups[p.module] = [];
    groups[p.module].push(p);
  });

  // Build HTML
  let html = "";
  for (const mod of Object.keys(groups).sort()) {
    const producers = groups[mod];
    const isCollapsed = !!collapsedProducerModules[mod];

    html += `<div class="module-group" data-module="${esc(mod)}">`;
    html += `<div class="module-header ${isCollapsed ? "collapsed" : ""}" data-module="${esc(mod)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(mod)}</span>`;
    html += `<span class="count-badge">${producers.length}</span>`;
    html += `</div>`; // module-header

    html += `<div class="module-body ${isCollapsed ? "collapsed" : ""}">`;
    for (const p of producers) {
      html += buildProducerRow(p);
    }
    html += `</div>`; // module-body
    html += `</div>`; // module-group
  }

  producerList.innerHTML = html;
  show(producerSection);
  hide(emptyState);
  
  // Restore section collapsed state
  if (collapsedSections["producers"]) {
    producerSection.classList.add("collapsed");
  }
}

function buildProducerRow(p) {
  const id = `${p.module}__${p.producer}`;
  const statusClass = p.status === "OK" ? "status-ok" : "status-broken";

  return `
    <div class="var-row producer-row" data-id="${esc(id)}">
      <div class="var-info">
        <span class="var-name">${esc(p.producer)}</span>
        <span class="var-type status-badge ${statusClass}">${esc(p.status)}</span>
      </div>
    </div>`;
}

/* ================================================================== */
/*  Event delegation on #var-list                                      */
/* ================================================================== */
varList.addEventListener("keydown", (e) => {
  const input = e.target.closest("input.var-value:not([readonly])");
  if (!input) return;

  if (e.key === "Enter") {
    e.preventDefault();
    commitInput(input);
  }
  if (e.key === "Escape") {
    input.value = input.dataset.original;
    input.blur();
  }
});

varList.addEventListener("focusout", (e) => {
  const input = e.target.closest("input.var-value:not([readonly])");
  if (!input) return;
  if (input.value !== input.dataset.original) {
    commitInput(input);
  }
});

varList.addEventListener("click", (e) => {
  // Boolean toggles
  const btn = e.target.closest(".bool-toggle:not([disabled])");
  if (btn) {
    const isActive = btn.classList.contains("active");
    const newVal   = !isActive;
    btn.classList.toggle("active", newVal);
    const row = btn.closest(".var-row");
    doSet(btn.dataset.module, btn.dataset.name, newVal, "Boolean", row);
    return;
  }

  // Module header collapse
  const header = e.target.closest(".module-header");
  if (header) {
    const mod  = header.dataset.module;
    const body = header.nextElementSibling;
    const isCollapsed = header.classList.toggle("collapsed");
    body.classList.toggle("collapsed", isCollapsed);
    collapsedModules[mod] = isCollapsed;
  }
});

async function commitInput(input) {
  const row = input.closest(".var-row");
  const ok = await doSet(input.dataset.module, input.dataset.name, input.value, input.dataset.type, row);
  if (ok) {
    // Update data-original only on success so blur doesn't re-trigger
    input.dataset.original = input.value;
  } else {
    // Revert to the last known-good value on failure
    input.value = input.dataset.original;
  }
}

/* ================================================================== */
/*  Event delegation on #producer-list                                 */
/* ================================================================== */
producerList.addEventListener("click", (e) => {
  // Module header collapse
  const header = e.target.closest(".module-header");
  if (header) {
    const mod  = header.dataset.module;
    const body = header.nextElementSibling;
    const isCollapsed = header.classList.toggle("collapsed");
    body.classList.toggle("collapsed", isCollapsed);
    collapsedProducerModules[mod] = isCollapsed;
  }
});

/* ================================================================== */
/*  Render Screens                                                     */
/* ================================================================== */
function renderScreens() {
  const query = inputSearchScreens.value.toLowerCase().trim();

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
    show(screenSection);
    return;
  }

  if (filtered.length === 0) {
    hide(screenSection);
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
  show(screenSection);
  hide(emptyState);

  if (collapsedSections["screens"]) {
    screenSection.classList.add("collapsed");
  }
}

function buildScreenRow(s) {
  const isCurrent = s.screenUrl === currentScreen;
  const navUrl = screenBaseUrl + "/" + s.screenUrl;

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

/* ================================================================== */
/*  Event delegation on #screen-list                                   */
/* ================================================================== */
screenList.addEventListener("click", (e) => {
  // Navigate button
  const navBtn = e.target.closest(".btn-navigate");
  if (navBtn) {
    const url = navBtn.dataset.url;
    sendMessage({ action: "NAVIGATE", url });
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

/* ================================================================== */
/*  Module filter dropdown                                             */
/* ================================================================== */
function populateModuleFilter() {
  selectModule.innerHTML = `<option value="">All Modules</option>`;
  moduleList.forEach((mod) => {
    const opt = document.createElement("option");
    opt.value = mod;
    opt.textContent = mod;
    selectModule.appendChild(opt);
  });
}

function populateProducerModuleFilter() {
  selectProducerModule.innerHTML = `<option value="">All Modules</option>`;
  producerModuleList.forEach((mod) => {
    const opt = document.createElement("option");
    opt.value = mod;
    opt.textContent = mod;
    selectProducerModule.appendChild(opt);
  });
}

/* ================================================================== */
/*  UI helpers                                                         */
/* ================================================================== */
function showLoading(on) {
  if (on) {
    hide(emptyState);
    hide(varSection);
    hide(producerSection);
    hide(screenSection);
    show(loading);
    btnScan.disabled = true;
  } else {
    hide(loading);
    btnScan.disabled = false;
  }
}

function showEmptyState() {
  show(emptyState);
  hide(varSection);
  hide(producerSection);
  hide(screenSection);
}

function showStatus(msg, type) {
  statusText.textContent = msg;
  statusBar.className = "status-bar " + (type || "");
  show(statusBar);
}

function hideStatus() {
  hide(statusBar);
}

function show(el) {
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
}

function flashRow(rowEl, cls) {
  if (!rowEl) return;
  rowEl.classList.remove("saved", "error");
  // force reflow
  void rowEl.offsetWidth;
  rowEl.classList.add(cls);
  setTimeout(() => rowEl.classList.remove(cls), 700);
}

function toast(msg, type) {
  const el = document.createElement("div");
  el.className = "toast " + (type || "info");
  el.textContent = msg;
  toastBox.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ================================================================== */
/*  Messaging helper                                                   */
/* ================================================================== */
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/* ================================================================== */
/*  Escaping                                                           */
/* ================================================================== */
function esc(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escAttr(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ================================================================== */
/*  Debounce                                                           */
/* ================================================================== */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/* ================================================================== */
/*  Auto-scan on panel open & re-scan on tab navigation                */
/* ================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  doScan();
});

/**
 * When a tab finishes loading, OutSystems AMD modules may not yet be
 * registered in the performance resource-timing buffer.  We wait a bit
 * and retry up to a few times so the scan doesn't come back empty.
 */
const AUTO_SCAN_DELAY_MS  = 1500;
const AUTO_SCAN_RETRIES   = 3;
const AUTO_SCAN_RETRY_MS  = 2000;

let autoScanTimer = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "TAB_UPDATED") {
    // Cancel any pending auto-scan from a previous navigation
    clearTimeout(autoScanTimer);

    autoScanTimer = setTimeout(() => {
      doScanWithRetry(AUTO_SCAN_RETRIES);
    }, AUTO_SCAN_DELAY_MS);
  }
});

async function doScanWithRetry(retriesLeft) {
  await doScan();

  if (allVariables.length === 0 && allProducers.length === 0 && allScreens.length === 0 && retriesLeft > 0) {
    autoScanTimer = setTimeout(() => {
      doScanWithRetry(retriesLeft - 1);
    }, AUTO_SCAN_RETRY_MS);
  }
}
