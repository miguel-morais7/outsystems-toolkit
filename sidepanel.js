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
import * as blocks from './sections/blocks/index.js';
import * as roles from './sections/roles.js';
import * as staticEntities from './sections/staticEntities.js';
import * as dataModels from './sections/dataModels.js';
import * as builtinFunctions from './sections/builtinFunctions.js';

/* ================================================================== */
/*  Section registry                                                   */
/*  Add new sections here — showLoading / showEmptyState pick them up  */
/* ================================================================== */
const sections = [appmetadata, variables, screens, blocks, builtinFunctions, staticEntities, dataModels, roles, producers];

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

/** Detected platform type — updated on each scan. */
let currentPlatform = "unknown";

async function doScan() {
  showLoading(true);
  hideStatus();

  try {
    const result = await sendMessage({ action: "SCAN" });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Unknown error during scan.");
    }

    currentPlatform = result.platform || "unknown";
    const isODC = currentPlatform === "odc";

    if (isODC) {
      await doScanODC(result);
    } else {
      await doScanReactive(result);
    }

    // Build status message from section states
    buildStatusMessage(isODC);
  } catch (err) {
    showStatus(err.message, "error");
    showEmptyState();
  } finally {
    showLoading(false);
  }
}

/**
 * Reactive scan flow: fetch static screen/role data, merge with runtime.
 */
async function doScanReactive(result) {
  const [screenResult, rolesResult, producersResult, appDefResult] = await Promise.all([
    sendMessage({ action: "FETCH_SCREENS" }).catch(() => null),
    sendMessage({ action: "FETCH_ROLES" }).catch(() => null),
    sendMessage({ action: "DISCOVER_PRODUCER_RESOURCES" })
      .then(res => res?.ok && Object.keys(res.resources).length > 0
        ? sendMessage({ action: "FETCH_PRODUCERS", resources: res.resources })
        : { ok: true, producerModules: [], producers: [] })
      .catch(() => null),
    sendMessage({ action: "SCAN_APP_DEFINITION" }).catch(() => null),
  ]);

  // App metadata (from page-injected appDefinition scan)
  appmetadata.setData(appDefResult?.appDefinition || null, result.platform);
  appmetadata.render();

  // Kick off block discovery and user-role checking in parallel.
  const liveBlocksPromise = sendMessage({ action: "DISCOVER_BLOCKS" }).catch(() => null);

  const rolesList = (rolesResult && rolesResult.ok) ? (rolesResult.roles || []) : [];
  const userRolesPromise = (rolesList.length > 0 && rolesList[0].roleKey)
    ? sendMessage({ action: "CHECK_USER_ROLES", roles: rolesList }).catch(() => null)
    : Promise.resolve(null);

  variables.setData(result.variables || [], result.modules || []);
  variables.populateModuleFilter();
  variables.render();

  // Version info (from moduleinfo, separate from appDefinition)
  if (screenResult?.ok && screenResult.versionInfo) {
    appmetadata.setVersionInfo(screenResult.versionInfo);
    appmetadata.render();
  }

  // Screens
  if (screenResult && screenResult.ok) {
    screens.setData(
      screenResult.screens || [],
      screenResult.baseUrl || "",
      screenResult.moduleName || "",
      screenResult.currentScreen || "",
      screenResult.homeScreenName || "",
      "reactive"
    );
    screens.render();
  } else {
    screens.setData([], "", "", "", "", "reactive");
    hide(screens.sectionEl);
  }

  // Await both async operations that were kicked off in parallel above.
  const [liveResult, userRolesResult] = await Promise.all([liveBlocksPromise, userRolesPromise]);

  // Blocks — discover live blocks from the fiber tree, then keep only
  // the static entries that have a live match on the current screen.
  if (screenResult?.ok && screenResult.blocks && screenResult.blocks.length > 0) {
    const liveBlocks = (liveResult?.ok && liveResult.blocks) ? liveResult.blocks : [];

    const liveModulePaths = new Set(
      liveBlocks.map(lb => lb.modulePath).filter(Boolean)
    );
    const liveDataBlockAttrs = new Set(
      liveBlocks.map(lb => lb.dataBlockAttr).filter(Boolean)
    );
    const relevantBlocks = screenResult.blocks.filter(b => {
      const basePath = b.controllerModuleName.replace(/\.mvc\$controller$/, "");
      if (liveModulePaths.has(basePath)) return true;
      for (const attr of liveDataBlockAttrs) {
        if (basePath === attr || basePath.endsWith("." + attr)) return true;
      }
      return false;
    });

    blocks.setData(
      relevantBlocks,
      screenResult.baseUrl || "",
      screenResult.moduleName || "",
      liveBlocks,
      "reactive"
    );
    blocks.render();
  } else {
    blocks.setData([], "", "", [], "reactive");
    hide(blocks.sectionEl);
  }

  // Static Entities
  if (screenResult?.ok && screenResult.staticEntities && screenResult.staticEntities.length > 0) {
    staticEntities.setData(screenResult.staticEntities);
    staticEntities.populateModuleFilter();
    staticEntities.render();
  } else {
    staticEntities.setData([]);
    hide(staticEntities.sectionEl);
  }

  // Entities & Structures
  if (screenResult?.ok && screenResult.dataModels && screenResult.dataModels.length > 0) {
    dataModels.setData(screenResult.dataModels);
    dataModels.populateModuleFilter();
    dataModels.render();
  } else {
    dataModels.setData([]);
    hide(dataModels.sectionEl);
  }

  // Roles
  if (rolesResult && rolesResult.ok) {
    if (userRolesResult && userRolesResult.ok) {
      for (const role of rolesList) {
        role.userHasRole = !!userRolesResult.userRoles[role.name];
      }
    }
    roles.setData(rolesList);
    roles.render();
  } else {
    roles.setData([]);
    hide(roles.sectionEl);
  }

  // Producers
  producers.setData(producersResult?.producers || [], producersResult?.producerModules || []);
  producers.populateModuleFilter();
  producers.render();

  // Built-in Functions — re-apply stored overrides, then fetch current state
  await builtinFunctions.reapplyOverrides();
  const bfResult = await sendMessage({ action: "GET_BUILTIN_FUNCTIONS" }).catch(() => null);
  if (bfResult?.ok) {
    builtinFunctions.setData(bfResult.functions);
    builtinFunctions.render();
  } else {
    builtinFunctions.setData([]);
    hide(builtinFunctions.sectionEl);
  }
}

/**
 * ODC scan flow: no static parsing available, runtime-only discovery.
 * Client variables are discovered via _osOdcClientVarsScan. Hides sections
 * that depend on Reactive-only APIs (built-in functions, static entities,
 * data models, roles, producers).
 */
async function doScanODC(result) {
  // Client variables — now supported on ODC via _osOdcClientVarsScan
  variables.setData(result.variables || [], result.modules || []);
  variables.populateModuleFilter();
  variables.render();
  staticEntities.setData([]);
  hide(staticEntities.sectionEl);
  roles.setData([]);
  hide(roles.sectionEl);
  producers.setData([], []);
  hide(producers.sectionEl);
  // Extract moduleName from URL for ODC_SCAN_DATA_MODELS
  const tab = await chrome.tabs.query({ active: true, currentWindow: true }).then(t => t[0]);
  const pageUrl = tab ? tab.url : "";
  let moduleName = "";
  try {
    const pathParts = new URL(pageUrl).pathname.split("/").filter(Boolean);
    if (pathParts.length > 1) moduleName = pathParts[pathParts.length - 2];
  } catch (_) {}

  // Discover app definition, live blocks, roles, data models, screen list, screen roles, and builtin functions in parallel
  const [appDefResult, liveResult, odcRolesResult, dataModelsResult, screensResult, screenRolesResult, bfResult] = await Promise.all([
    sendMessage({ action: "SCAN_APP_DEFINITION" }).catch(() => null),
    sendMessage({ action: "DISCOVER_BLOCKS" }).catch(() => null),
    sendMessage({ action: "ODC_SCAN_ROLES" }).catch(() => null),
    sendMessage({ action: "ODC_SCAN_DATA_MODELS", moduleName }).catch(() => null),
    sendMessage({ action: "FETCH_SCREENS" }).catch(() => null),
    sendMessage({ action: "ODC_SCAN_SCREEN_ROLES" }).catch(() => null),
    builtinFunctions.reapplyOverrides()
      .then(() => sendMessage({ action: "GET_BUILTIN_FUNCTIONS" }))
      .catch(() => null),
  ]);

  // App metadata (from ODC chunk discovery)
  appmetadata.setData(appDefResult?.appDefinition || null, "odc");
  appmetadata.render();

  // Screen list — use FETCH_SCREENS, bundle route data, or synthetic fallback
  let screenList;
  let screenCurrentUrl;
  let screenBaseUrl = "";
  let homeScreenName = "";

  // Detect current screen path from URL
  let currentScreenPath = "";
  try {
    const pathParts = new URL(pageUrl).pathname.split("/").filter(Boolean);
    if (pathParts.length > 1) currentScreenPath = pathParts[pathParts.length - 1];
  } catch (_) {}

  if (screensResult?.ok) {
    screenList = screensResult.screens || [];
    screenCurrentUrl = screensResult.currentScreen || "";
    screenBaseUrl = screensResult.baseUrl || "";
    homeScreenName = screensResult.homeScreenName || "";
    if (screensResult.versionInfo) {
      appmetadata.setVersionInfo(screensResult.versionInfo);
      appmetadata.render();
    }
  } else if (screenRolesResult?.ok && screenRolesResult.screenRoles?.length > 0) {
    // Build screen list from bundle route data (has screenName, path, roles)
    const seen = {};
    screenList = [];
    for (const sr of screenRolesResult.screenRoles) {
      const key = sr.screenName + "|" + sr.path;
      if (seen[key]) continue;
      seen[key] = true;
      const nameParts = sr.screenName.split(".");
      const name = nameParts.length > 1 ? nameParts.slice(1).join(".") : sr.screenName;
      const flow = nameParts.length > 1 ? nameParts[0] : "";
      screenList.push({
        name,
        screenUrl: sr.path || name,
        flow,
        fullName: sr.screenName,
        roles: sr.roles,
      });
    }
    // Determine which is the default (home) screen — forDefaultPath in the route array
    const defaultScreen = screenRolesResult.screenRoles.find(sr => sr.path === "");
    if (defaultScreen) homeScreenName = defaultScreen.screenName;
    screenCurrentUrl = currentScreenPath || (defaultScreen ? (defaultScreen.path || defaultScreen.screenName.split(".").pop()) : "");
  } else {
    // Last resort: synthetic single-screen entry from URL
    let screenName = currentScreenPath || "Screen";
    screenList = [{ name: screenName, screenUrl: screenName, flow: "Current", roles: [] }];
    screenCurrentUrl = screenName;
  }

  screens.setData(screenList, screenBaseUrl, moduleName, screenCurrentUrl, homeScreenName, "odc");

  // Merge roles into screens that don't already have them
  if (screenRolesResult?.ok && screenRolesResult.screenRoles?.length > 0) {
    const rolesByPath = {};
    const rolesByFullName = {};
    for (const sr of screenRolesResult.screenRoles) {
      rolesByPath[sr.path.toLowerCase()] = sr.roles;
      rolesByFullName[sr.screenName.toLowerCase()] = sr.roles;
    }
    for (const s of screenList) {
      if (s.roles && s.roles.length > 0) continue;
      const urlKey = (s.screenUrl || "").toLowerCase();
      if (urlKey && rolesByPath[urlKey]) { s.roles = rolesByPath[urlKey]; continue; }
      const fullKey = (s.fullName || "").toLowerCase();
      if (fullKey && rolesByFullName[fullKey]) { s.roles = rolesByFullName[fullKey]; continue; }
      const nameKey = (s.name || "").toLowerCase();
      if (nameKey && rolesByPath[nameKey]) { s.roles = rolesByPath[nameKey]; }
    }
  }

  screens.render();
  const liveBlocks = (liveResult?.ok && liveResult.blocks) ? liveResult.blocks : [];

  if (liveBlocks.length > 0) {
    // Build synthetic block entries from live discovery data.
    // Prefer dataBlockAttr for naming (reliable DOM source) over modulePath
    // (extracted from minified source, can be truncated).
    // Append viewIndex to fullName to keep IDs unique when the same block
    // type appears multiple times (e.g. several AccordionItem instances).
    const odcBlocks = liveBlocks.map(lb => {
      const path = lb.dataBlockAttr || lb.modulePath || "";
      const parts = path.split(".");
      const name = parts[parts.length - 1] || `Block ${lb.viewIndex}`;
      const module = parts.length > 1 ? parts.slice(0, -1).join(".") : (parts[0] || "Blocks");
      return {
        name,
        mvcModuleName: path,
        controllerModuleName: path,
        module,
        group: module,
        fullName: (path || "block") + "#" + lb.viewIndex,
        viewIndex: lb.viewIndex,
      };
    });
    blocks.setData(odcBlocks, "", moduleName, liveBlocks, "odc");
    blocks.render();
  } else {
    blocks.setData([], "", "", [], "odc");
    hide(blocks.sectionEl);
  }

  // Entities & Structures — discovered from ODC chunk exports
  if (dataModelsResult?.ok && dataModelsResult.dataModels?.length > 0) {
    dataModels.setData(dataModelsResult.dataModels);
    dataModels.populateModuleFilter();
    dataModels.render();
  } else {
    dataModels.setData([]);
    dataModels.populateModuleFilter();
    hide(dataModels.sectionEl);
  }

  // Roles — discovered from ODC chunk exports
  const odcRolesList = (odcRolesResult && odcRolesResult.ok) ? (odcRolesResult.roles || []) : [];
  if (odcRolesList.length > 0) {
    // Check user membership if roles were found
    const userRolesResult = await sendMessage({
      action: "ODC_CHECK_USER_ROLES",
      roles: odcRolesList,
    }).catch(() => null);

    if (userRolesResult && userRolesResult.ok) {
      for (const role of odcRolesList) {
        role.userHasRole = !!userRolesResult.userRoles[role.name];
      }
    }
    roles.setData(odcRolesList);
    roles.render();
  } else {
    roles.setData([]);
    hide(roles.sectionEl);
  }

  // Built-in Functions
  if (bfResult?.ok && bfResult.functions.length > 0) {
    builtinFunctions.setData(bfResult.functions);
    builtinFunctions.render();
  } else {
    builtinFunctions.setData([]);
    hide(builtinFunctions.sectionEl);
  }
}

/**
 * Build and show the status message from section states.
 */
function buildStatusMessage(isODC) {
  const scrState = screens.getState();
  const blkState = blocks.getState();
  const parts = [];

  const varState = variables.getState();
  if (varState.count > 0) {
    const varText = varState.count === 1 ? "client variable" : "client variables";
    const modText = varState.moduleCount === 1 ? "module" : "modules";
    parts.push(`${varState.count} ${varText} in ${varState.moduleCount} ${modText}`);
  }
  if (scrState.count > 0) {
    const scrText = scrState.count === 1 ? "screen" : "screens";
    parts.push(`${scrState.count} ${scrText}`);
  }
  if (blkState.count > 0) {
    const blkText = blkState.count === 1 ? "block" : "blocks";
    parts.push(`${blkState.count} ${blkText}`);
  }
  const rolesState = roles.getState();
  if (rolesState.count > 0) {
    const rolesText = rolesState.count === 1 ? "role" : "roles";
    parts.push(`${rolesState.count} ${rolesText}`);
  }
  const dmState = dataModels.getState();
  if (dmState.count > 0) {
    const dmText = dmState.count === 1 ? "entity/structure" : "entities/structures";
    parts.push(`${dmState.count} ${dmText}`);
  }
  if (!isODC) {
    const seState = staticEntities.getState();
    const prodState = producers.getState();
    if (seState.count > 0) {
      const seText = seState.count === 1 ? "static entity" : "static entities";
      parts.push(`${seState.count} ${seText}`);
    }
    if (prodState.count > 0) {
      const prodText = prodState.count === 1 ? "producer" : "producers";
      const modText = prodState.moduleCount === 1 ? "module" : "modules";
      parts.push(`${prodState.count} ${prodText} in ${prodState.moduleCount} ${modText}`);
    }
  }

  if (parts.length > 0) {
    showStatus(`Found ${parts.join(", ")}.`, "success");
  } else {
    showStatus("No OutSystems data found on this page.", "error");
    showEmptyState();
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
