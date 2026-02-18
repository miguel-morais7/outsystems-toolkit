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

import { fetchScreens, fetchRoles, fetchScreenDetails } from './background/parsers.js';

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

/**
 * Inject pageScript helpers into the page (idempotent — we check
 * whether _osClientVarsScan is already defined).
 *
 * Files are injected in dependency order: helpers and fiber first,
 * then feature modules that depend on them.
 */
async function ensurePageScriptInjected(tabId) {
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
      ],
    });
  }
}

/**
 * Execute a function in the page's MAIN world and return the result.
 * Handles injection, execution, and error wrapping.
 */
async function executeInPage(func, args = []) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func,
    args,
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
  SCAN:                     { func: () => _osClientVarsScan(),                                            args: () => [] },
  SET:                      { func: (m, n, v, t) => _osClientVarsSet(m, n, v, t),                         args: msg => [msg.module, msg.name, msg.value, msg.type] },
  GET:                      { func: (m, n) => _osClientVarsGet(m, n),                                     args: msg => [msg.module, msg.name] },
  GET_SCREEN_VARS:          { func: (defs) => _osScreenVarsGet(defs),                                     args: msg => [msg.varDefs] },
  SET_SCREEN_VAR:           { func: (n, v, t) => _osScreenVarsSet(n, v, t),                               args: msg => [msg.internalName, msg.value, msg.dataType] },
  INTROSPECT_SCREEN_VAR:    { func: (n, m) => _osScreenVarIntrospect(n, m),                               args: msg => [msg.internalName, msg.maxListItems || 50] },
  SET_SCREEN_VAR_DEEP:      { func: (n, p, v, t) => _osScreenVarDeepSet(n, p, v, t),                     args: msg => [msg.internalName, msg.path, msg.value, msg.dataType] },
  LIST_APPEND:              { func: (n, p, m) => _osScreenVarListAppend(n, p, m),                         args: msg => [msg.internalName, msg.path || [], msg.maxListItems || 50] },
  LIST_DELETE:              { func: (n, p, i, m) => _osScreenVarListDelete(n, p, i, m),                   args: msg => [msg.internalName, msg.path || [], msg.index, msg.maxListItems || 50] },
  CHECK_USER_ROLES:         { func: (roles) => _osUserRolesCheck(roles),                                   args: msg => [msg.roles] },
  GET_SCREEN_ACTIONS:       { func: () => _osScreenActionsGet(),                                           args: () => [] },
  INVOKE_SCREEN_ACTION:     { func: (m, p) => _osScreenActionInvoke(m, p),                                args: msg => [msg.methodName, msg.paramValues || []] },
  INIT_ACTION_PARAM:        { func: (m, a, mx) => _osActionParamInit(m, a, mx),                           args: msg => [msg.methodName, msg.attrName, msg.maxListItems || 50] },
  INTROSPECT_ACTION_PARAM:  { func: (m, a, mx) => _osActionParamIntrospect(m, a, mx),                     args: msg => [msg.methodName, msg.attrName, msg.maxListItems || 50] },
  SET_ACTION_PARAM_DEEP:    { func: (m, a, p, v, t) => _osActionParamDeepSet(m, a, p, v, t),             args: msg => [msg.methodName, msg.attrName, msg.path, msg.value, msg.dataType] },
  ACTION_PARAM_LIST_APPEND: { func: (m, a, p, mx) => _osActionParamListAppend(m, a, p, mx),               args: msg => [msg.methodName, msg.attrName, msg.path || [], msg.maxListItems || 50] },
  ACTION_PARAM_LIST_DELETE:  { func: (m, a, p, i, mx) => _osActionParamListDelete(m, a, p, i, mx),        args: msg => [msg.methodName, msg.attrName, msg.path || [], msg.index, msg.maxListItems || 50] },
  GET_DATA_ACTIONS:          { func: () => _osDataActionsGet(),                                           args: () => [] },
  REFRESH_DATA_ACTION:       { func: (m) => _osDataActionRefresh(m),                                     args: msg => [msg.refreshMethodName] },
};

/**
 * Actions handled outside the page context (fetch/parse, navigation).
 * Each entry returns a Promise.
 */
const SPECIAL_ACTIONS = {
  FETCH_SCREENS:        () => getActiveTab().then(tab => fetchScreens(tab.url)),
  FETCH_ROLES:          () => getActiveTab().then(tab => fetchRoles(tab.url)),
  FETCH_SCREEN_DETAILS: msg => fetchScreenDetails(msg.baseUrl, msg.moduleName, msg.flow, msg.screenName, msg.controllerModuleName),
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
    executeInPage(pageAction.func, pageAction.args(message))
      .then(sendResponse)
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
  if (changeInfo.status === "complete" && tab.active) {
    // Notify the side panel so it can re-scan automatically
    chrome.runtime.sendMessage({ action: "TAB_UPDATED", tabId }).catch(() => {
      // Side panel may not be open — ignore
    });
  }
});
