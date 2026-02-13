/**
 * background.js — MV3 Service Worker
 *
 * Orchestrates communication between the Side Panel UI and the page's
 * MAIN world.  Receives action messages from sidepanel.js, injects the
 * appropriate function into the active tab via chrome.scripting.executeScript,
 * and returns the result.
 */

import { fetchScreens, fetchRoles, fetchScreenDetails } from './background/parsers.js';

/* ------------------------------------------------------------------ */
/*  Open the side panel when the toolbar icon is clicked                */
/* ------------------------------------------------------------------ */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

/* ------------------------------------------------------------------ */
/*  Message handler                                                    */
/* ------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "SCAN") {
    handleScan().then(sendResponse).catch((err) =>
      sendResponse({ ok: false, error: err.message })
    );
    return true; // keep the message channel open for async response
  }

  if (message.action === "SET") {
    handleSet(message.module, message.name, message.value, message.type)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "GET") {
    handleGet(message.module, message.name)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "FETCH_SCREENS") {
    getActiveTab().then(tab => fetchScreens(tab.url))
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "NAVIGATE") {
    handleNavigate(message.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "FETCH_ROLES") {
    getActiveTab().then(tab => fetchRoles(tab.url))
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "FETCH_SCREEN_DETAILS") {
    fetchScreenDetails(message.baseUrl, message.moduleName, message.flow, message.screenName)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "GET_SCREEN_VARS") {
    handleGetScreenVars(message.varDefs)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "SET_SCREEN_VAR") {
    handleSetScreenVar(message.internalName, message.value, message.dataType)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "INTROSPECT_SCREEN_VAR") {
    handleIntrospectScreenVar(message.internalName, message.maxListItems)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "SET_SCREEN_VAR_DEEP") {
    handleSetScreenVarDeep(message.internalName, message.path, message.value, message.dataType)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "LIST_APPEND") {
    handleListAppend(message.internalName, message.path, message.maxListItems)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "LIST_DELETE") {
    handleListDelete(message.internalName, message.path, message.index, message.maxListItems)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

/* ------------------------------------------------------------------ */
/*  Helpers — get the active tab                                       */
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
 * Inject pageScript.js helpers into the page (idempotent — we check
 * whether _osClientVarsScan is already defined).
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
      files: ["pageScript.js"],
    });
  }
}

/* ------------------------------------------------------------------ */
/*  SCAN                                                               */
/* ------------------------------------------------------------------ */
async function handleScan() {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: () => _osClientVarsScan(),
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  SET                                                                */
/* ------------------------------------------------------------------ */
async function handleSet(moduleName, varName, value, varType) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (m, n, v, t) => _osClientVarsSet(m, n, v, t),
    args: [moduleName, varName, value, varType],
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  GET (refresh single)                                               */
/* ------------------------------------------------------------------ */
async function handleGet(moduleName, varName) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (m, n) => _osClientVarsGet(m, n),
    args: [moduleName, varName],
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  GET SCREEN VARS (live runtime values via React fiber)              */
/* ------------------------------------------------------------------ */
async function handleGetScreenVars(varDefs) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (defs) => _osScreenVarsGet(defs),
    args: [varDefs],
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  SET SCREEN VAR (write a value via React fiber)                     */
/* ------------------------------------------------------------------ */
async function handleSetScreenVar(internalName, value, dataType) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (name, val, type) => _osScreenVarsSet(name, val, type),
    args: [internalName, value, dataType],
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  INTROSPECT SCREEN VAR (deep-read complex variable structure)       */
/* ------------------------------------------------------------------ */
async function handleIntrospectScreenVar(internalName, maxListItems) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (name, max) => _osScreenVarIntrospect(name, max),
    args: [internalName, maxListItems || 50],
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  SET SCREEN VAR DEEP (write to nested path in reactive model)       */
/* ------------------------------------------------------------------ */
async function handleSetScreenVarDeep(internalName, path, value, dataType) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (name, p, val, type) => _osScreenVarDeepSet(name, p, val, type),
    args: [internalName, path, value, dataType],
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  LIST APPEND (add a new record to a reactive list)                   */
/* ------------------------------------------------------------------ */
async function handleListAppend(internalName, path, maxListItems) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (name, p, max) => _osScreenVarListAppend(name, p, max),
    args: [internalName, path || [], maxListItems || 50],
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  LIST DELETE (remove a record from a reactive list by index)         */
/* ------------------------------------------------------------------ */
async function handleListDelete(internalName, path, index, maxListItems) {
  const tab = await getActiveTab();
  await ensurePageScriptInjected(tab.id);

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (name, p, idx, max) => _osScreenVarListDelete(name, p, idx, max),
    args: [internalName, path || [], index, maxListItems || 50],
  });

  const data = extractScriptResult(results);
  if (data === undefined) {
    return { ok: false, error: "Could not access page — is it a restricted URL?" };
  }
  return data;
}

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
