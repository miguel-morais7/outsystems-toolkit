/**
 * sections/staticEntities.js — Static Entities section
 *
 * Displays static entities from moduleinfo, grouped by module.
 * Each entity shows its records with copyable GUIDs.
 */

import { esc, escAttr, debounce } from '../utils/helpers.js';
import { show, hide, toast } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allEntities = [];        // Array of { module, entityGuid, records: [{guid, name}] }
let collapsedModules = {};   // module -> bool
let collapsedEntities = {};  // entityGuid -> bool

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const inputSearch  = document.getElementById("input-search-static-entities");
const selectModule = document.getElementById("select-static-entity-module");
const listEl       = document.getElementById("static-entity-list");
const countEl      = document.getElementById("static-entity-count");
const emptyState   = document.getElementById("empty-state");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("static-entity-section");

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));
  selectModule.addEventListener("change", render);

  listEl.addEventListener("click", (e) => {
    // Module header collapse
    const moduleHeader = e.target.closest(".module-header");
    if (moduleHeader && !e.target.closest(".entity-header")) {
      const mod = moduleHeader.dataset.module;
      const body = moduleHeader.nextElementSibling;
      const isCollapsed = moduleHeader.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      collapsedModules[mod] = isCollapsed;
      return;
    }

    // Entity header collapse
    const entityHeader = e.target.closest(".entity-header");
    if (entityHeader) {
      const entityGuid = entityHeader.dataset.entityGuid;
      const body = entityHeader.nextElementSibling;
      const isCollapsed = entityHeader.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      collapsedEntities[entityGuid] = isCollapsed;
      return;
    }

    // Copy GUID to clipboard
    const copyBtn = e.target.closest(".btn-copy-guid");
    if (copyBtn) {
      e.stopPropagation();
      navigator.clipboard.writeText(copyBtn.dataset.guid).then(() => {
        toast("GUID copied", "success");
      });
    }
  });
}

/** Replace section data after a scan. */
export function setData(entities) {
  allEntities = entities || [];
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: allEntities.length };
}

/** Rebuild the module filter dropdown. */
export function populateModuleFilter() {
  const modules = [...new Set(allEntities.map(e => e.module))].sort();
  selectModule.innerHTML = `<option value="">All Modules</option>`;
  for (const mod of modules) {
    const opt = document.createElement("option");
    opt.value = mod;
    opt.textContent = mod;
    selectModule.appendChild(opt);
  }
}

/** Render (or re-render) the static entities list. */
export function render() {
  const query = inputSearch.value.toLowerCase().trim();
  const filterMod = selectModule.value;

  // Filter entities
  let filtered = allEntities;
  if (filterMod) {
    filtered = filtered.filter(e => e.module === filterMod);
  }
  if (query) {
    filtered = filtered.filter(e =>
      e.module.toLowerCase().includes(query) ||
      e.entityGuid.toLowerCase().includes(query) ||
      (e.entityName && e.entityName.toLowerCase().includes(query)) ||
      e.records.some(r =>
        r.name.toLowerCase().includes(query) ||
        r.guid.toLowerCase().includes(query) ||
        (r.recordName && r.recordName.toLowerCase().includes(query))
      )
    );
  }

  countEl.textContent = filtered.length;

  if (filtered.length === 0 && allEntities.length > 0) {
    listEl.innerHTML = `<div class="no-results">No static entities match your filter.</div>`;
    show(sectionEl);
    return;
  }

  if (filtered.length === 0) {
    hide(sectionEl);
    return;
  }

  // Group by module
  const groups = {};
  for (const entity of filtered) {
    if (!groups[entity.module]) groups[entity.module] = [];
    groups[entity.module].push(entity);
  }

  let html = "";
  for (const mod of Object.keys(groups).sort()) {
    const entities = groups[mod];
    const isModCollapsed = !!collapsedModules[mod];

    html += `<div class="module-group" data-module="${esc(mod)}">`;
    html += `<div class="module-header ${isModCollapsed ? 'collapsed' : ''}" data-module="${esc(mod)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(mod)}</span>`;
    html += `<span class="count-badge">${entities.length}</span>`;
    html += `</div>`;

    html += `<div class="module-body ${isModCollapsed ? 'collapsed' : ''}">`;
    for (let i = 0; i < entities.length; i++) {
      html += buildEntityGroup(entities[i], i + 1);
    }
    html += `</div></div>`;
  }

  listEl.innerHTML = html;
  show(sectionEl);
  hide(emptyState);
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

const COPY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

function buildEntityGroup(entity, index) {
  const isCollapsed = !!collapsedEntities[entity.entityGuid];
  const displayName = entity.entityName || `Entity ${index}`;

  let html = `<div class="static-entity-group">`;

  // Entity header
  html += `<div class="entity-header ${isCollapsed ? 'collapsed' : ''}" data-entity-guid="${escAttr(entity.entityGuid)}">`;
  html += `<svg class="chevron entity-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  html += `<span class="entity-name">${esc(displayName)}</span>`;
  const attrSummary = entity.attributes && entity.attributes.length > 0
    ? entity.attributes.map(a => a.name).join(", ")
    : "";
  html += `<span class="entity-attrs-hint"${attrSummary ? ` title="${escAttr(attrSummary)}"` : ''}>${esc(attrSummary)}</span>`;
  html += `<span class="count-badge">${entity.records.length}</span>`;
  html += `<button class="btn-icon btn-copy-guid" data-guid="${escAttr(entity.entityGuid)}" title="Copy entity GUID">${COPY_SVG}</button>`;
  html += `</div>`;

  // Entity body (record list)
  html += `<div class="entity-body ${isCollapsed ? 'collapsed' : ''}">`;
  for (const record of entity.records) {
    html += buildRecordRow(record);
  }
  html += `</div></div>`;

  return html;
}

function buildRecordRow(record) {
  const label = record.recordName || record.name;
  const showId = record.recordName && record.name !== record.recordName;
  return `
    <div class="var-row static-entity-record-row" data-record-guid="${escAttr(record.guid)}">
      <div class="var-info">
        <span class="var-name">${esc(label)}</span>
        ${showId ? `<span class="record-id">${esc(record.name)}</span>` : ''}
      </div>
      <div class="var-value-wrap">
        <button class="btn-icon btn-copy-guid" data-guid="${escAttr(record.guid)}" title="Copy record GUID">${COPY_SVG}</button>
      </div>
    </div>`;
}
