/**
 * sidepanel.js — Side Panel orchestrator
 *
 * Bootstraps section modules, handles scanning, section collapse,
 * and auto-scan on tab navigation.
 *
 * Each section (variables, producers, screens, …) is a self-contained
 * ES module under sections/.  To add a new section:
 *   1. Create sections/mySection.js exporting { sectionEl, init, setData, getState, render }
 *   2. Import it here and add it to the `sections` array
 *   3. Feed it data inside doScan()
 */

import { sendMessage } from './utils/helpers.js';
import { show, hide, showStatus, hideStatus } from './utils/ui.js';

import * as appmetadata from './sections/appmetadata.js';
import * as variables from './sections/variables.js';
import * as producers from './sections/producers.js';
import * as screens from './sections/screens/index.js';
import * as roles from './sections/roles.js';

/* ================================================================== */
/*  Section registry                                                   */
/*  Add new sections here — showLoading / showEmptyState pick them up  */
/* ================================================================== */
const sections = [appmetadata, variables, screens, roles, producers];

/* ================================================================== */
/*  DOM references (orchestrator-level only)                           */
/* ================================================================== */
const btnScan = document.getElementById("btn-scan");
const emptyState = document.getElementById("empty-state");
const loading = document.getElementById("loading");

/* ================================================================== */
/*  Init                                                               */
/* ================================================================== */
btnScan.addEventListener("click", doScan);

// Initialize all section modules (event listeners, etc.)
sections.forEach((s) => s.init());

// Section expand/collapse — generic handler for any section header
document.addEventListener("click", (e) => {
  const sectionHeader = e.target.closest(".section-header[data-section]");
  if (sectionHeader) {
    const section = sectionHeader.closest(".section");
    section.classList.toggle("collapsed");
  }
});

/* ================================================================== */
/*  SCAN                                                               */
/* ================================================================== */
async function doScan() {
  showLoading(true);
  hideStatus();

  try {
    const [result, screenResult, rolesResult] = await Promise.all([
      sendMessage({ action: "SCAN" }),
      sendMessage({ action: "FETCH_SCREENS" }).catch(() => null),
      sendMessage({ action: "FETCH_ROLES" }).catch(() => null),
    ]);

    if (!result || !result.ok) {
      throw new Error(result?.error || "Unknown error during scan.");
    }

    // Feed data into section modules
    appmetadata.setData(result.appDefinition || null);
    appmetadata.render();

    variables.setData(result.variables || [], result.modules || []);
    variables.populateModuleFilter();
    variables.render();

    // Screens
    if (screenResult && screenResult.ok) {
      screens.setData(
        screenResult.screens || [],
        screenResult.baseUrl || "",
        screenResult.moduleName || "",
        screenResult.currentScreen || ""
      );
      screens.render();
    } else {
      screens.setData([], "", "", "");
      hide(screens.sectionEl);
    }

    // Roles
    if (rolesResult && rolesResult.ok) {
      roles.setData(rolesResult.roles || []);
      roles.render();
    } else {
      roles.setData([]);
      hide(roles.sectionEl);
    }

    // Producers
    producers.setData(result.producers || [], result.producerModules || []);
    producers.populateModuleFilter();
    producers.render();

    // Build status message from section states
    const varState = variables.getState();
    const prodState = producers.getState();
    const scrState = screens.getState();
    const rolesState = roles.getState();

    const parts = [];
    if (varState.count > 0) {
      const varText = varState.count === 1 ? "client variable" : "client variables";
      const modText = varState.moduleCount === 1 ? "module" : "modules";
      parts.push(`${varState.count} ${varText} in ${varState.moduleCount} ${modText}`);
    }
    if (scrState.count > 0) {
      const scrText = scrState.count === 1 ? "screen" : "screens";
      parts.push(`${scrState.count} ${scrText}`);
    }
    if (rolesState.count > 0) {
      const rolesText = rolesState.count === 1 ? "role" : "roles";
      parts.push(`${rolesState.count} ${rolesText}`);
    }
    if (prodState.count > 0) {
      const prodText = prodState.count === 1 ? "producer" : "producers";
      const modText = prodState.moduleCount === 1 ? "module" : "modules";
      parts.push(`${prodState.count} ${prodText} in ${prodState.moduleCount} ${modText}`);
    }

    if (parts.length > 0) {
      showStatus(`Found ${parts.join(", ")}.`, "success");
    } else {
      showStatus("No client variables, producers, screens, or roles found on this page.", "error");
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
/*  UI helpers (orchestrator-level)                                    */
/* ================================================================== */
function showLoading(on) {
  if (on) {
    hide(emptyState);
    sections.forEach((s) => hide(s.sectionEl));
    show(loading);
    btnScan.disabled = true;
  } else {
    hide(loading);
    btnScan.disabled = false;
  }
}

function showEmptyState() {
  show(emptyState);
  sections.forEach((s) => hide(s.sectionEl));
}

/* ================================================================== */
/*  Auto-scan on panel open & re-scan on tab navigation                */
/* ================================================================== */
doScan();

const AUTO_SCAN_DELAY_MS = 1500;
const AUTO_SCAN_RETRIES = 3;
const AUTO_SCAN_RETRY_MS = 2000;

let autoScanTimer = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "TAB_UPDATED") {
    clearTimeout(autoScanTimer);
    autoScanTimer = setTimeout(() => {
      doScanWithRetry(AUTO_SCAN_RETRIES);
    }, AUTO_SCAN_DELAY_MS);
  }
});

async function doScanWithRetry(retriesLeft) {
  await doScan();

  const hasData = sections.some((s) => s.getState().count > 0);
  if (!hasData && retriesLeft > 0) {
    autoScanTimer = setTimeout(() => {
      doScanWithRetry(retriesLeft - 1);
    }, AUTO_SCAN_RETRY_MS);
  }
}
