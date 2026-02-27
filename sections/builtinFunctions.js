/**
 * sections/builtinFunctions.js — Built-in Functions section
 *
 * Lets users inspect and override OutSystems environment built-in
 * functions (CurrDateTime, GetUserId, etc.) with hardcoded values.
 * Overrides are stored in-memory and re-applied after each rescan.
 */

import { esc, escAttr, sendMessage } from '../utils/helpers.js';
import { show, hide, toast } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allFunctions = [];

/** Stored overrides — { funcKey: rawStringValue } — survives rescans. */
const overrides = {};

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const funcList = document.getElementById("builtin-list");
const funcCount = document.getElementById("builtin-count");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("builtin-section");

/* ================================================================== */
/*  Input type map                                                     */
/* ================================================================== */
const INPUT_TYPE = {
  date: "date",
  datetime: "datetime-local",
  time: "time",
  text: "text",
};

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
  sectionEl.addEventListener("click", (e) => {
    const btnOverride = e.target.closest(".btn-builtin-override");
    if (btnOverride) {
      handleOverride(btnOverride.dataset.key);
      return;
    }
    const btnRestore = e.target.closest(".btn-builtin-restore");
    if (btnRestore) {
      handleRestore(btnRestore.dataset.key);
      return;
    }
  });

  sectionEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.closest(".builtin-input")) {
      const key = e.target.dataset.key;
      if (key) handleOverride(key);
    }
  });
}

/** Replace section data after a scan. */
export function setData(functions) {
  allFunctions = functions || [];
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: allFunctions.length };
}

/** Return the active overrides map (used by sidepanel.js for re-application). */
export function getOverrides() {
  return { ...overrides };
}

/** Re-apply stored overrides to the page (call after page scripts are injected). */
export async function reapplyOverrides() {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return;
  await sendMessage({ action: "OVERRIDE_BUILTIN_FUNCTIONS", overrides });
}

/** Render (or re-render) the function list. */
export function render() {
  funcCount.textContent = allFunctions.length;

  if (allFunctions.length === 0) {
    hide(sectionEl);
    return;
  }

  let html = "";
  for (const func of allFunctions) {
    html += buildFuncRow(func);
  }

  funcList.innerHTML = html;
  show(sectionEl);
}

/* ================================================================== */
/*  Event handlers                                                     */
/* ================================================================== */

async function handleOverride(key) {
  const input = funcList.querySelector(`.builtin-input[data-key="${key}"]`);
  if (!input) return;

  const rawValue = input.value;
  if (!rawValue && rawValue !== "0") {
    toast("Enter a value to override.", "error");
    return;
  }

  overrides[key] = rawValue;
  const result = await sendMessage({
    action: "OVERRIDE_BUILTIN_FUNCTIONS",
    overrides: { [key]: rawValue },
  });

  if (result?.ok) {
    toast(`Overridden ${displayNameFor(key)}`, "success");
    await refreshAndRender();
  } else {
    toast(result?.error || "Override failed.", "error");
  }
}

async function handleRestore(key) {
  delete overrides[key];
  const result = await sendMessage({
    action: "RESTORE_BUILTIN_FUNCTIONS",
    name: key,
  });

  if (result?.ok) {
    toast(`Restored ${displayNameFor(key)}`, "success");
    await refreshAndRender();
  } else {
    toast(result?.error || "Restore failed.", "error");
  }
}

async function refreshAndRender() {
  const result = await sendMessage({ action: "GET_BUILTIN_FUNCTIONS" });
  if (result?.ok) {
    allFunctions = result.functions;
    render();
  }
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

function displayNameFor(key) {
  const func = allFunctions.find((f) => f.key === key);
  return func ? func.displayName + "()" : key;
}

function buildFuncRow(func) {
  const isOverridden = func.isOverridden || func.key in overrides;
  const inputType = INPUT_TYPE[func.type] || "text";
  const inputValue = isOverridden && overrides[func.key] != null
    ? overrides[func.key]
    : func.currentValue;

  const overriddenClass = isOverridden ? " builtin-overridden" : "";
  const inputClass = func.type === "text" ? "var-value" : "var-value var-value-date";

  const btn = isOverridden
    ? `<button class="btn-builtin-restore" data-key="${escAttr(func.key)}" title="Restore original">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
       </button>`
    : `<button class="btn-builtin-override" data-key="${escAttr(func.key)}" title="Override with this value">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
       </button>`;

  return `
  <div class="var-row${overriddenClass}" data-key="${escAttr(func.key)}">
    <div class="var-info">
      <span class="var-name">${esc(func.displayName)}()</span>
      <span class="var-type">${esc(func.type)}</span>
    </div>
    <div class="builtin-value-wrap">
      <input class="builtin-input ${inputClass}"
             type="${inputType}"
             data-key="${escAttr(func.key)}"
             value="${escAttr(inputValue)}"
             ${func.type === "time" || func.type === "datetime" ? 'step="1"' : ""} />
      ${btn}
    </div>
  </div>`;
}
