/**
 * sections/producers.js — Producers section
 *
 * Manages state, rendering, and event delegation for the
 * producer-references panel.
 */

import { esc, debounce } from '../utils/helpers.js';
import { show, hide } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allProducers             = [];
let producerModuleList       = [];
let collapsedProducerModules = {};

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const inputSearch  = document.getElementById("input-search-producers");
const selectModule = document.getElementById("select-producer-module");
const producerList = document.getElementById("producer-list");
const producerCount = document.getElementById("producer-count");
const emptyState   = document.getElementById("empty-state");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("producer-section");

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));
  selectModule.addEventListener("change", render);

  producerList.addEventListener("click", (e) => {
    const header = e.target.closest(".module-header");
    if (header) {
      const mod  = header.dataset.module;
      const body = header.nextElementSibling;
      const isCollapsed = header.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      collapsedProducerModules[mod] = isCollapsed;
    }
  });
}

/** Replace section data after a scan. */
export function setData(producers, modules) {
  allProducers       = producers;
  producerModuleList = modules;
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: allProducers.length, moduleCount: producerModuleList.length };
}

/** Rebuild the module filter dropdown. */
export function populateModuleFilter() {
  selectModule.innerHTML = `<option value="">All Modules</option>`;
  producerModuleList.forEach((mod) => {
    const opt = document.createElement("option");
    opt.value       = mod;
    opt.textContent = mod;
    selectModule.appendChild(opt);
  });
}

/** Render (or re-render) the producer list. */
export function render() {
  const query     = inputSearch.value.toLowerCase().trim();
  const filterMod = selectModule.value;

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
    show(sectionEl);
    return;
  }

  if (filtered.length === 0) {
    hide(sectionEl);
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
    const producers  = groups[mod];
    const isCollapsed = !!collapsedProducerModules[mod];

    html += `<div class="module-group" data-module="${esc(mod)}">`;
    html += `<div class="module-header ${isCollapsed ? "collapsed" : ""}" data-module="${esc(mod)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(mod)}</span>`;
    html += `<span class="count-badge">${producers.length}</span>`;
    html += `</div>`;

    html += `<div class="module-body ${isCollapsed ? "collapsed" : ""}">`;
    for (const p of producers) {
      html += buildProducerRow(p);
    }
    html += `</div>`;
    html += `</div>`;
  }

  producerList.innerHTML = html;
  show(sectionEl);
  hide(emptyState);
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

function buildProducerRow(p) {
  const id          = `${p.module}__${p.producer}`;
  const statusClass = p.status === "OK" ? "status-ok" : "status-broken";

  return `
    <div class="var-row producer-row" data-id="${esc(id)}">
      <div class="var-info">
        <span class="var-name">${esc(p.producer)}</span>
        <span class="var-type status-badge ${statusClass}">${esc(p.status)}</span>
      </div>
    </div>`;
}
