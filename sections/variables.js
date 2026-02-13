/**
 * sections/variables.js — Client Variables section
 *
 * Manages state, rendering, inline editing, and event delegation
 * for the Client Variables panel.
 */

import { esc, escAttr, debounce, sendMessage, formatDateForInput } from '../utils/helpers.js';
import { show, hide, flashRow, toast } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allVariables     = [];
let moduleList       = [];
let collapsedModules = {};

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const inputSearch  = document.getElementById("input-search");
const selectModule = document.getElementById("select-module");
const varList      = document.getElementById("var-list");
const varCount     = document.getElementById("var-count");
const emptyState   = document.getElementById("empty-state");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("var-section");

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));
  selectModule.addEventListener("change", render);

  /* Keyboard: Enter → save, Escape → revert */
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

  /* Blur → save if value changed */
  varList.addEventListener("focusout", (e) => {
    const input = e.target.closest("input.var-value:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitInput(input);
    }
  });

  /* Date/time/datetime pickers fire "change" */
  varList.addEventListener("change", (e) => {
    const input = e.target.closest("input.var-value-date:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitInput(input);
    }
  });

  /* Click: boolean toggle + module-header collapse */
  varList.addEventListener("click", (e) => {
    const btn = e.target.closest(".bool-toggle:not([disabled])");
    if (btn) {
      const isActive = btn.classList.contains("active");
      const newVal   = !isActive;
      btn.classList.toggle("active", newVal);
      const row = btn.closest(".var-row");
      doSet(btn.dataset.module, btn.dataset.name, newVal, "Boolean", row);
      return;
    }

    const header = e.target.closest(".module-header");
    if (header) {
      const mod  = header.dataset.module;
      const body = header.nextElementSibling;
      const isCollapsed = header.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      collapsedModules[mod] = isCollapsed;
    }
  });
}

/** Replace section data after a scan. */
export function setData(variables, modules) {
  allVariables = variables;
  moduleList   = modules;
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: allVariables.length, moduleCount: moduleList.length };
}

/** Rebuild the module filter dropdown. */
export function populateModuleFilter() {
  selectModule.innerHTML = `<option value="">All Modules</option>`;
  moduleList.forEach((mod) => {
    const opt = document.createElement("option");
    opt.value       = mod;
    opt.textContent = mod;
    selectModule.appendChild(opt);
  });
}

/** Render (or re-render) the variable list. */
export function render() {
  const query     = inputSearch.value.toLowerCase().trim();
  const filterMod = selectModule.value;

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
    show(sectionEl);
    return;
  }

  if (filtered.length === 0) {
    hide(sectionEl);
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
    html += `</div>`;

    html += `<div class="module-body ${isCollapsed ? "collapsed" : ""}">`;
    for (const v of vars) {
      html += buildVarRow(v);
    }
    html += `</div>`;
    html += `</div>`;
  }

  varList.innerHTML = html;
  show(sectionEl);
  hide(emptyState);
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

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
  } else if (v.type === "Date" || v.type === "Time" || v.type === "Date Time") {
    const inputType = v.type === "Date" ? "date" : v.type === "Time" ? "time" : "datetime-local";
    const displayValue = formatDateForInput(v.value, v.type);
    valueControl = `
      <input class="var-value var-value-date"
             type="${inputType}"
             value="${escAttr(displayValue)}"
             data-module="${esc(v.module)}"
             data-name="${esc(v.name)}"
             data-type="${esc(v.type)}"
             data-original="${escAttr(displayValue)}"
             ${v.readOnly ? "readonly" : ""}
             ${v.type === "Time" ? 'step="1"' : ""}
             title="${v.readOnly ? "Read-only" : "Edit to save"}" />`;
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

/** Send a SET message and update local state. */
async function doSet(moduleName, varName, rawValue, varType, rowEl) {
  try {
    const result = await sendMessage({
      action: "SET",
      module: moduleName,
      name:   varName,
      value:  rawValue,
      type:   varType,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to set value.");
    }

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

/** Commit an input's value to the server. */
async function commitInput(input) {
  const row = input.closest(".var-row");
  const ok  = await doSet(
    input.dataset.module, input.dataset.name,
    input.value, input.dataset.type, row
  );
  if (ok) {
    input.dataset.original = input.value;
  } else {
    input.value = input.dataset.original;
  }
}
