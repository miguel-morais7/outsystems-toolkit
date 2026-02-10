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

  if (message.action === "FETCH_ROLES") {
    handleFetchRoles()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === "FETCH_SCREEN_DETAILS") {
    handleFetchScreenDetails(message.baseUrl, message.moduleName, message.flow, message.screenName)
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
/*  FETCH ROLES (via controller.js)                                    */
/* ------------------------------------------------------------------ */
async function handleFetchRoles() {
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
  // Convert module name to the controller script format
  const controllerFileName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1).toLowerCase() + ".controller.js";
  const controllerUrl = `${url.origin}/${moduleName}/scripts/${controllerFileName}`;

  let response;
  try {
    response = await fetch(controllerUrl, { credentials: "include" });
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `Failed to fetch controller.js (HTTP ${response.status}).` };
  }

  let scriptText;
  try {
    scriptText = await response.text();
  } catch (e) {
    return { ok: false, error: "Failed to read controller.js content." };
  }

  // Extract roles from Controller.prototype.roles = { ... }
  // Check if roles block exists
  if (!scriptText.includes("Controller.prototype.roles")) {
    return { ok: true, roles: [], moduleName };
  }

  const roles = [];

  // Match each role entry: RoleName: { roleKey: "...", roleException: new OS.Exceptions.Exceptions.NotRegisteredException("...", "message") }
  const rolePattern = /(\w+)\s*:\s*\{\s*roleKey\s*:\s*"[^"]*"\s*,\s*roleException\s*:\s*new\s+OS\.Exceptions\.Exceptions\.NotRegisteredException\s*\([^)]*\)/g;
  let match;
  while ((match = rolePattern.exec(scriptText)) !== null) {
    roles.push({
      name: match[1]
    });
  }

  return {
    ok: true,
    roles,
    moduleName,
  };
}

/* ------------------------------------------------------------------ */
/*  FETCH SCREEN DETAILS (via mvc.js)                                  */
/* ------------------------------------------------------------------ */
async function handleFetchScreenDetails(baseUrl, moduleName, flow, screenName) {
  // Construct the MVC file URL: {baseUrl}/scripts/{Module}.{Flow}.{Screen}.mvc.js
  const mvcUrl = `${baseUrl}/scripts/${moduleName}.${flow}.${screenName}.mvc.js`;

  let response;
  try {
    response = await fetch(mvcUrl, { credentials: "include" });
  } catch (e) {
    return { ok: false, error: `Network error: ${e.message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `Failed to fetch MVC file (HTTP ${response.status}).` };
  }

  let scriptText;
  try {
    scriptText = await response.text();
  } catch (e) {
    return { ok: false, error: "Failed to read MVC file content." };
  }

  const result = {
    ok: true,
    inputParameters: [],
    localVariables: [],
    aggregates: [],
    dataActions: [],
    serverActions: [],
    screenActions: [],
  };

  // ----------------------------------------------------------------
  // Extract Input Parameter names from Model.prototype.setInputs
  // Pattern: if("ParamName" in inputs) { ... }
  // ----------------------------------------------------------------
  const inputParamNames = new Set();
  const setInputsMatch = scriptText.match(/Model\.prototype\.setInputs\s*=\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\n\};/);
  if (setInputsMatch) {
    const setInputsBody = setInputsMatch[1];
    const inputPattern = /if\s*\(\s*"([^"]+)"\s*in\s+inputs\s*\)/g;
    let inputMatch;
    while ((inputMatch = inputPattern.exec(setInputsBody)) !== null) {
      inputParamNames.add(inputMatch[1]);
    }
  }

  // ----------------------------------------------------------------
  // Parse Screen Variables from VariablesRecord.attributesToDeclare
  // Pattern: this.attr("DisplayName", "internalName", "...", true, false, OS.DataTypes.DataTypes.TypeName, ...)
  // ----------------------------------------------------------------
  const varPattern = /this\.attr\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
  let match;
  const seenVars = new Set();
  while ((match = varPattern.exec(scriptText)) !== null) {
    const displayName = match[1];
    const internalName = match[2];
    const rawType = match[3];
    // Normalize OutSystems DataTypes to display names (e.g. "DateTime" → "Date Time")
    const TYPE_MAP = { DateTime: "Date Time", LongInteger: "Long Integer" };
    const dataType = TYPE_MAP[rawType] || rawType;
    // Skip aggregate/data action outputs (they have "Aggr" or "DataAct" in internal name)
    // Skip internal DataFetchStatus variables
    if (!seenVars.has(displayName) && !internalName.includes("Aggr") && !internalName.includes("DataAct") && !displayName.startsWith("_")) {
      if (inputParamNames.has(displayName)) {
        result.inputParameters.push({ name: displayName, internalName, type: dataType });
      } else {
        result.localVariables.push({ name: displayName, internalName, type: dataType });
      }
      seenVars.add(displayName);
    }
  }

  // ----------------------------------------------------------------
  // Parse Aggregates and Data Actions from dataFetchActionNames
  // Pattern: Controller.prototype.dataFetchActionNames = ["name1$AggrRefresh", "name2$DataActRefresh"];
  // ----------------------------------------------------------------
  const dataFetchMatch = scriptText.match(/dataFetchActionNames\s*=\s*\[([\s\S]*?)\]/);
  if (dataFetchMatch) {
    const namesStr = dataFetchMatch[1];
    const namePattern = /"([^"]+)"/g;
    while ((match = namePattern.exec(namesStr)) !== null) {
      const rawName = match[1];
      const isAggregate = rawName.endsWith("$AggrRefresh");
      const isDataAction = rawName.endsWith("$DataActRefresh");
      // Clean up the name (remove suffix)
      let name = rawName.replace(/\$AggrRefresh$/, "").replace(/\$DataActRefresh$/, "");
      // Convert camelCase to readable: getProducts -> GetProducts
      name = name.charAt(0).toUpperCase() + name.slice(1);
      if (isAggregate) {
        result.aggregates.push({ name });
      } else if (isDataAction) {
        result.dataActions.push({ name });
      }
    }
  }

  // ----------------------------------------------------------------
  // Parse Server Actions
  // Pattern: Controller.prototype.actionName$ServerAction = function
  // ----------------------------------------------------------------
  const serverActionPattern = /Controller\.prototype\.(\w+)\$ServerAction\s*=/g;
  while ((match = serverActionPattern.exec(scriptText)) !== null) {
    const name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    result.serverActions.push({ name });
  }

  // ----------------------------------------------------------------
  // Parse Screen Actions (Client Actions)
  // Pattern: Controller.prototype._actionName$Action = function
  // We look for the underscore-prefixed versions which are the actual implementations
  // ----------------------------------------------------------------
  const screenActionPattern = /Controller\.prototype\._(\w+)\$Action\s*=/g;
  while ((match = screenActionPattern.exec(scriptText)) !== null) {
    const name = match[1];
    // Convert camelCase: onSort -> OnSort
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    result.screenActions.push({ name: displayName });
  }

  return result;
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
