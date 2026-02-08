/**
 * background.js — MV3 Service Worker
 *
 * Orchestrates communication between the Side Panel UI and the page's
 * MAIN world.  Receives action messages from sidepanel.js, injects the
 * appropriate function into the active tab via chrome.scripting.executeScript,
 * and returns the result.
 */

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
    handleFetchScreens()
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
/*  FETCH SCREENS (via moduleinfo)                                     */
/* ------------------------------------------------------------------ */
async function handleFetchScreens() {
  const tab = await getActiveTab();
  const pageUrl = tab.url;

  if (!pageUrl || !pageUrl.startsWith("http")) {
    return { ok: false, error: "Cannot access tab URL." };
  }

  const url = new URL(pageUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length === 0) {
    return { ok: false, error: "Cannot determine module name from URL." };
  }

  const moduleName = pathParts[0];
  const moduleInfoUrl = `${url.origin}/${moduleName}/moduleservices/moduleinfo`;
  const currentScreen = pathParts.length > 1 ? pathParts[1] : "";

  let response;
  try {
    response = await fetch(moduleInfoUrl, { credentials: "include" });
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `Failed to fetch moduleinfo (HTTP ${response.status}).` };
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return { ok: false, error: "Invalid JSON in moduleinfo response." };
  }

  // Extract screens from urlMappings
  const urlMappings = data?.manifest?.urlMappings || {};
  const prefix = `/${moduleName}/`;
  const screenUrlSet = new Set();

  for (const key of Object.keys(urlMappings)) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.substring(prefix.length);
    // Skip empty (root), files (.html), sub-paths, query params
    if (!rest || rest.includes("/") || rest.includes(".") || rest.includes("?")) continue;
    screenUrlSet.add(rest);
  }

  // Enrich with flow info from data.modules.screens
  const screenMap = {};
  const modules = data?.data?.modules || {};
  for (const moduleData of Object.values(modules)) {
    if (moduleData.screens) {
      for (const screen of moduleData.screens) {
        screenMap[screen.screenUrl] = screen.screenName;
      }
    }
  }

  const screens = [...screenUrlSet].sort().map((screenUrl) => {
    const fullName = screenMap[screenUrl] || screenUrl;
    const nameParts = fullName.split(".");
    return {
      screenUrl,
      name: nameParts.length > 1 ? nameParts.slice(1).join(".") : fullName,
      flow: nameParts.length > 1 ? nameParts[0] : "",
    };
  });

  return {
    ok: true,
    screens,
    moduleName,
    baseUrl: `${url.origin}/${moduleName}`,
    currentScreen,
  };
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
