/**
 * background.js — MV3 Service Worker
 *
 * Orchestrates communication between the Side Panel UI and the page's
 * MAIN world.  Receives action messages from sidepanel.js, injects the
 * appropriate function into the active tab via chrome.scripting.executeScript,
 * and returns the result.
 *
 * Uses a dispatch table to map message actions to page-script functions,
 * eliminating repetitive handler boilerplate.
 */

import { fetchScreens, fetchRoles, fetchScreenDetails, fetchProducers } from './background/parsers.js';

/* ------------------------------------------------------------------ */
/*  Open the side panel when the toolbar icon is clicked                */
/* ------------------------------------------------------------------ */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found.");
  return tab;
}

/**
 * Safely extract the result from chrome.scripting.executeScript.
 * Returns undefined when the injection target is restricted (chrome://,
 * edge://, etc.) or the results array is empty.
 */
function extractScriptResult(results) {
  if (!Array.isArray(results) || results.length === 0) return undefined;
  return results[0].result;
}

/* ------------------------------------------------------------------ */
/*  Page script injection (cached per tab)                             */
/* ------------------------------------------------------------------ */

/** Tabs where page scripts have been successfully injected. */
const injectedTabs = new Set();

/** Detected platform type per tab: 'reactive' | 'odc' | 'unknown'. */
const tabPlatform = new Map();

/**
 * In-flight injection promises, keyed by tabId.
 * Prevents duplicate concurrent injections when multiple executeInPage
 * calls race on the same tab (e.g. 5 parallel enrichment calls).
 */
const pendingInjections = new Map();

/**
 * Ensure page scripts are injected into the given tab.
 *
 * After the first successful injection the tab is cached so subsequent
 * calls return immediately.  Concurrent calls for the same tab share a
 * single injection promise.
 *
 * Cache is cleared on tab removal and page navigation (scripts are lost
 * when the page reloads).  Service-worker restart naturally empties the
 * in-memory Set.
 */
async function ensurePageScriptInjected(tabId) {
  if (injectedTabs.has(tabId)) return;

  if (pendingInjections.has(tabId)) {
    return pendingInjections.get(tabId);
  }

  const promise = doInjection(tabId);
  pendingInjections.set(tabId, promise);

  try {
    await promise;
  } finally {
    pendingInjections.delete(tabId);
  }
}

async function doInjection(tabId) {
  // Detect platform type before injecting page scripts
  if (!tabPlatform.has(tabId)) {
    await detectPlatform(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => typeof _osClientVarsScan === "function",
  });

  if (!extractScriptResult(results)) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: [
        "pageScript/helpers.js",
        "pageScript/fiber.js",
        "pageScript/clientVars.js",
        "pageScript/screenVars.js",
        "pageScript/screenActions.js",
        "pageScript/actionParams.js",
        "pageScript/dataActions.js",
        "pageScript/aggregates.js",
        "pageScript/serverActions.js",
        "pageScript/builtinFunctions.js",
        "pageScript/roles.js",
        "pageScript/producers.js",
        "pageScript/appDefinition.js",
      ],
    });
  }

  injectedTabs.add(tabId);
}

/**
 * Detect whether the page is an OutSystems Reactive or ODC app.
 * Injects a lightweight check into the page's MAIN world and caches
 * the result in tabPlatform.
 */
async function detectPlatform(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        // OSManifestLoader is unique to Reactive apps
        if (typeof OSManifestLoader !== "undefined") return "reactive";
        // indexVersionToken meta tag is unique to ODC apps
        if (document.querySelector('meta[name="indexVersionToken"]')) return "odc";
        return "unknown";
      },
    });
    tabPlatform.set(tabId, extractScriptResult(results) || "unknown");
  } catch {
    tabPlatform.set(tabId, "unknown");
  }
}

/**
 * Execute a function in the page's MAIN world and return the result.
 * Handles injection, execution, and error wrapping.
 */
async function executeInPage(func, args = []) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  // Chrome's executeScript requires JSON-serializable args; undefined is not.
  // Convert undefined values to null (page scripts already handle null === undefined).
  const safeArgs = args.map(a => a === undefined ? null : a);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func,
    args: safeArgs,
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  Dispatch tables                                                    */
/* ------------------------------------------------------------------ */

/**
 * Actions that execute a function in the page's MAIN world.
 * Each entry maps an action name to:
 *   - func: the function to execute in the page context
 *   - args: extracts arguments from the incoming message
 */
const PAGE_ACTIONS = {
  SCAN:                     { func: (p) => p === "odc" ? _osOdcClientVarsScan() : _osClientVarsScan(),              args: msg => [msg._platform] },
  SET:                      { func: (p, m, n, v, t) => p === "odc" ? _osOdcClientVarsSet(m, n, v, t) : _osClientVarsSet(m, n, v, t), args: msg => [msg._platform, msg.module, msg.name, msg.value, msg.type] },
  GET:                      { func: (p, m, n) => p === "odc" ? _osOdcClientVarsGet(m, n) : _osClientVarsGet(m, n), args: msg => [msg._platform, msg.module, msg.name] },
  GET_SCREEN_VARS:          { func: (defs, vi) => _osScreenVarsGet(defs, vi),                                      args: msg => [msg.varDefs, msg.viewIndex] },
  SET_SCREEN_VAR:           { func: (n, v, t, vi) => _osScreenVarsSet(n, v, t, vi),                                args: msg => [msg.internalName, msg.value, msg.dataType, msg.viewIndex] },
  INTROSPECT_SCREEN_VAR:    { func: (n, m, vi) => _osScreenVarIntrospect(n, m, vi),                                args: msg => [msg.internalName, msg.maxListItems || 50, msg.viewIndex] },
  SET_SCREEN_VAR_DEEP:      { func: (n, p, v, t, vi) => _osScreenVarDeepSet(n, p, v, t, vi),                      args: msg => [msg.internalName, msg.path, msg.value, msg.dataType, msg.viewIndex] },
  LIST_APPEND:              { func: (n, p, m, vi) => _osScreenVarListAppend(n, p, m, vi),                          args: msg => [msg.internalName, msg.path || [], msg.maxListItems || 50, msg.viewIndex] },
  LIST_DELETE:              { func: (n, p, i, m, vi) => _osScreenVarListDelete(n, p, i, m, vi),                    args: msg => [msg.internalName, msg.path || [], msg.index, msg.maxListItems || 50, msg.viewIndex] },
  CHECK_USER_ROLES:         { func: (roles) => _osUserRolesCheck(roles),                                            args: msg => [msg.roles] },
  ODC_SCAN_ROLES:            { func: () => _osOdcRolesScan(),                                                        args: () => [] },
  ODC_CHECK_USER_ROLES:      { func: (roles) => _osOdcUserRolesCheck(roles),                                         args: msg => [msg.roles] },
  GET_SCREEN_ACTIONS:       { func: (vi) => _osScreenActionsGet(vi),                                               args: msg => [msg.viewIndex] },
  INVOKE_SCREEN_ACTION:     { func: (m, p, vi) => _osScreenActionInvoke(m, p, vi),                                 args: msg => [msg.methodName, msg.paramValues || [], msg.viewIndex] },
  INIT_ACTION_PARAM:        { func: (m, a, mx, vi) => _osActionParamInit(m, a, mx, vi),                            args: msg => [msg.methodName, msg.attrName, msg.maxListItems || 50, msg.viewIndex] },
  INTROSPECT_ACTION_PARAM:  { func: (m, a, mx) => _osActionParamIntrospect(m, a, mx),                              args: msg => [msg.methodName, msg.attrName, msg.maxListItems || 50] },
  SET_ACTION_PARAM_DEEP:    { func: (m, a, p, v, t) => _osActionParamDeepSet(m, a, p, v, t),                      args: msg => [msg.methodName, msg.attrName, msg.path, msg.value, msg.dataType] },
  ACTION_PARAM_LIST_APPEND: { func: (m, a, p, mx) => _osActionParamListAppend(m, a, p, mx),                        args: msg => [msg.methodName, msg.attrName, msg.path || [], msg.maxListItems || 50] },
  ACTION_PARAM_LIST_DELETE:  { func: (m, a, p, i, mx) => _osActionParamListDelete(m, a, p, i, mx),                 args: msg => [msg.methodName, msg.attrName, msg.path || [], msg.index, msg.maxListItems || 50] },
  GET_DATA_ACTIONS:          { func: (vi) => _osDataActionsGet(vi),                                                args: msg => [msg.viewIndex] },
  REFRESH_DATA_ACTION:       { func: (m, vi) => _osDataActionRefresh(m, vi),                                       args: msg => [msg.refreshMethodName, msg.viewIndex] },
  GET_AGGREGATES:            { func: (vi) => _osAggregatesGet(vi),                                                 args: msg => [msg.viewIndex] },
  REFRESH_AGGREGATE:         { func: (m, vi) => _osAggregateRefresh(m, vi),                                        args: msg => [msg.refreshMethodName, msg.viewIndex] },
  GET_SERVER_ACTIONS:        { func: (vi) => _osServerActionsGet(vi),                                              args: msg => [msg.viewIndex] },
  INVOKE_SERVER_ACTION:      { func: (m, p, vi) => _osServerActionInvoke(m, p, vi),                               args: msg => [msg.methodName, msg.paramValues || [], msg.viewIndex] },
  DISCOVER_BLOCKS:           { func: () => _osDiscoverBlocks(),                                                     args: () => [] },
  GET_BLOCK_TREE:            { func: () => _osGetBlockTree(),                                                       args: () => [] },
  GET_BUILTIN_FUNCTIONS:     { func: () => _osBuiltinFunctionsGet(),                                                args: () => [] },
  OVERRIDE_BUILTIN_FUNCTIONS:{ func: (o) => _osBuiltinFunctionsOverride(o),                                         args: msg => [msg.overrides] },
  RESTORE_BUILTIN_FUNCTIONS: { func: (n) => _osBuiltinFunctionRestore(n),                                           args: msg => [msg.name] },
  DISCOVER_PRODUCER_RESOURCES:{ func: () => _osProducerResourceUrls(),                                                args: () => [] },
  SCAN_APP_DEFINITION:       { func: () => _osAppDefinitionScan(),                                                   args: () => [] },
};

/**
 * Actions handled outside the page context (fetch/parse, navigation).
 * Each entry returns a Promise.
 */
const SPECIAL_ACTIONS = {
  FETCH_SCREENS:        () => getActiveTab().then(tab => fetchScreens(tab.url)),
  FETCH_ROLES:          () => getActiveTab().then(tab => fetchRoles(tab.url)),
  FETCH_PRODUCERS:      msg => fetchProducers(msg.resources),
  FETCH_SCREEN_DETAILS: msg => fetchScreenDetails(msg.baseUrl, msg.moduleName, msg.flow, msg.screenName, msg.controllerModuleName),
  FETCH_BLOCK_DETAILS:  msg => fetchScreenDetails(msg.baseUrl, msg.moduleName, null, null, msg.controllerModuleName),
  NAVIGATE:             msg => handleNavigate(msg.url),
};

/* ------------------------------------------------------------------ */
/*  Message handler                                                    */
/* ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { action } = message;

  // Page-execution actions (inject + run in MAIN world)
  const pageAction = PAGE_ACTIONS[action];
  if (pageAction) {
    // For platform-aware actions, resolve platform before building args
    const prepare = (action === "SCAN" || action === "SET" || action === "GET")
      ? getActiveTab().then(tab => { message._platform = tabPlatform.get(tab.id) || "unknown"; }).catch(() => { message._platform = "unknown"; })
      : Promise.resolve();

    prepare.then(() => executeInPage(pageAction.func, pageAction.args(message)))
      .then(async (data) => {
        // Enrich SCAN response with detected platform type
        if (action === "SCAN" && data && data.ok) {
          try {
            const tab = await getActiveTab();
            data.platform = tabPlatform.get(tab.id) || "unknown";
          } catch {
            data.platform = "unknown";
          }
        }
        sendResponse(data);
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Special handlers (fetch/parse, navigation)
  const specialHandler = SPECIAL_ACTIONS[action];
  if (specialHandler) {
    specialHandler(message)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

/* ------------------------------------------------------------------ */
/*  NAVIGATE                                                           */
/* ------------------------------------------------------------------ */
async function handleNavigate(url) {
  const tab = await getActiveTab();
  await chrome.tabs.update(tab.id, { url });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Re-scan on tab navigation / refresh                                */
/* ------------------------------------------------------------------ */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Clear injection and platform cache — scripts are lost when the page reloads.
  if (changeInfo.status === "loading") {
    injectedTabs.delete(tabId);
    pendingInjections.delete(tabId);
    tabPlatform.delete(tabId);
  }

  if (changeInfo.status === "complete" && tab.active) {
    // Notify the side panel so it can re-scan automatically
    chrome.runtime.sendMessage({ action: "TAB_UPDATED", tabId }).catch(() => {
      // Side panel may not be open — ignore
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  pendingInjections.delete(tabId);
  tabPlatform.delete(tabId);
});
