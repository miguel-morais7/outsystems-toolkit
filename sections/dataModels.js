/**
 * sections/dataModels.js — Entities & Structures section
 *
 * Displays entity and structure Rec definitions parsed from model.js files,
 * grouped by defining module. Each item is expandable to show attributes.
 */

import { esc, escAttr, debounce } from '../utils/helpers.js';
import { show, hide } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allModels = [];          // Array of { name, module, kind, attributes: [{name, type}] }
let collapsedModules = {};   // module -> bool
let expandedModels = {};     // "module.name" -> bool (true = expanded; default is collapsed)

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const inputSearch  = document.getElementById("input-search-data-models");
const selectModule = document.getElementById("select-data-model-module");
const selectKind   = document.getElementById("select-data-model-kind");
const listEl       = document.getElementById("data-model-list");
const countEl      = document.getElementById("data-model-count");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("data-model-section");

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));
  selectModule.addEventListener("change", render);
  selectKind.addEventListener("change", render);

  listEl.addEventListener("click", (e) => {
    // Module header collapse
    const moduleHeader = e.target.closest(".module-header");
    if (moduleHeader && !e.target.closest(".data-model-header")) {
      const mod = moduleHeader.dataset.module;
      const body = moduleHeader.nextElementSibling;
      const isCollapsed = moduleHeader.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      collapsedModules[mod] = isCollapsed;
      return;
    }

    // Data model item header collapse
    const modelHeader = e.target.closest(".data-model-header");
    if (modelHeader) {
      const key = modelHeader.dataset.modelModule + "." + modelHeader.dataset.modelName;
      const body = modelHeader.nextElementSibling;
      const isCollapsed = modelHeader.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      expandedModels[key] = !isCollapsed;
      return;
    }
  });
}

/** Replace section data after a scan. */
export function setData(models) {
  allModels = models || [];
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: allModels.length };
}

/** Rebuild the module filter dropdown. */
export function populateModuleFilter() {
  const modules = [...new Set(allModels.map(m => m.module))].sort();
  selectModule.innerHTML = `<option value="">All Modules</option>`;
  for (const mod of modules) {
    const opt = document.createElement("option");
    opt.value = mod;
    opt.textContent = mod;
    selectModule.appendChild(opt);
  }
}

/** Render (or re-render) the data models list. */
export function render() {
  const query = inputSearch.value.toLowerCase().trim();
  const filterMod = selectModule.value;
  const filterKind = selectKind.value;

  // Filter
  let filtered = allModels;
  if (filterMod) {
    filtered = filtered.filter(m => m.module === filterMod);
  }
  if (filterKind) {
    filtered = filtered.filter(m => m.kind === filterKind);
  }
  if (query) {
    filtered = filtered.filter(m =>
      m.name.toLowerCase().includes(query) ||
      m.module.toLowerCase().includes(query) ||
      m.attributes.some(a => a.name.toLowerCase().includes(query))
    );
  }

  countEl.textContent = filtered.length;

  if (filtered.length === 0 && allModels.length > 0) {
    listEl.innerHTML = `<div class="no-results">No entities or structures match your filter.</div>`;
    show(sectionEl);
    return;
  }

  if (filtered.length === 0) {
    listEl.innerHTML = "";
    hide(sectionEl);
    return;
  }

  // Group by module
  const groups = {};
  for (const model of filtered) {
    if (!groups[model.module]) groups[model.module] = [];
    groups[model.module].push(model);
  }

  let html = "";
  for (const mod of Object.keys(groups).sort()) {
    const models = groups[mod];
    const isModCollapsed = !!collapsedModules[mod];

    html += `<div class="module-group" data-module="${esc(mod)}">`;
    html += `<div class="module-header ${isModCollapsed ? 'collapsed' : ''}" data-module="${esc(mod)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(mod)}</span>`;
    html += `<span class="count-badge">${models.length}</span>`;
    html += `</div>`;

    html += `<div class="module-body ${isModCollapsed ? 'collapsed' : ''}">`;
    for (const model of models) {
      html += buildModelItem(model);
    }
    html += `</div></div>`;
  }

  listEl.innerHTML = html;
  show(sectionEl);
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

const TYPE_MAP = { DateTime: "Date Time", LongInteger: "Long Integer", PhoneNumber: "Phone Number" };

function buildModelItem(model) {
  const key = model.module + "." + model.name;
  const isExpanded = !!expandedModels[key];
  const kindClass = model.kind === "Entity" ? "kind-entity" : "kind-structure";

  let html = `<div class="data-model-group">`;

  // Item header
  html += `<div class="data-model-header ${isExpanded ? '' : 'collapsed'}" data-model-module="${escAttr(model.module)}" data-model-name="${escAttr(model.name)}">`;
  html += `<svg class="chevron data-model-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  html += `<span class="data-model-name">${esc(model.name)}</span>`;
  html += `<span class="data-model-kind ${kindClass}">${esc(model.kind)}</span>`;
  html += `<span class="count-badge">${model.attributes.length}</span>`;
  html += `</div>`;

  // Item body (attribute rows)
  html += `<div class="data-model-body ${isExpanded ? '' : 'collapsed'}">`;
  for (const attr of model.attributes) {
    const displayType = TYPE_MAP[attr.type] || attr.type;
    html += `<div class="var-row data-model-attr-row">`;
    html += `<div class="var-info">`;
    html += `<span class="var-name">${esc(attr.name)}</span>`;
    html += `<span class="var-type">${esc(displayType)}</span>`;
    html += `</div></div>`;
  }
  html += `</div></div>`;

  return html;
}
