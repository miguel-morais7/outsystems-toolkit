/**
 * background/parsers.js — OutSystems module parsers
 *
 * Fetch and parse OutSystems runtime files (moduleinfo, controller.js,
 * mvc.js) to extract screen lists, roles, and screen details.
 * These functions are pure fetch+parse — no Chrome extension APIs.
 */

/* ------------------------------------------------------------------ */
/*  PARSE STATIC ENTITY METADATA (from model.js)                       */
/* ------------------------------------------------------------------ */

/**
 * Parse a model.js file to extract static entity metadata:
 *   - Entity GUID → entity name (from staticEntities.<name> = {})
 *   - Record GUID → record name (from Object.defineProperty calls)
 *   - Attribute schemas (from Rec.attributesToDeclare)
 *
 * @param {string} text - Content of a *.model.js file
 * @returns {{ entities: Object, schemas: Object }}
 */
function parseModelJsStaticEntities(text) {
  const entities = {};
  const schemas = {};

  // 1. Entity name → GUID mappings
  // Pattern:   .staticEntities.<name> = {};
  //            ...staticEntities["<guid>"][record]
  const entityPattern = /\.staticEntities\.(\w+)\s*=\s*\{\s*\};[\s\S]*?\.staticEntities\["([a-f0-9-]+)"\]\s*\[record\]/g;
  let m;
  while ((m = entityPattern.exec(text)) !== null) {
    const varName = m[1];
    const guid = m[2];
    const entityName = varName.charAt(0).toUpperCase() + varName.slice(1);
    entities[guid] = { entityName, records: {} };
  }

  // 2. Record name → GUID mappings
  // Pattern: Object.defineProperty(...staticEntities.<name>, "<record>", { ...Record("<guid>") })
  const recordPattern = /Object\.defineProperty\([^,]+\.staticEntities\.(\w+)\s*,\s*"(\w+)"\s*,[\s\S]*?Record\("([a-f0-9-]+)"\)/g;
  while ((m = recordPattern.exec(text)) !== null) {
    const varName = m[1];
    const recordName = m[2];
    const recordGuid = m[3];
    for (const data of Object.values(entities)) {
      if (data.entityName.toLowerCase() === varName.toLowerCase()) {
        data.records[recordGuid] = recordName.charAt(0).toUpperCase() + recordName.slice(1);
        break;
      }
    }
  }

  // 3. Rec attribute schemas
  // Pattern: <Name>Rec.attributesToDeclare = function () { return [ this.attr(...) ].concat(
  const recPattern = /(\w+)Rec\.attributesToDeclare\s*=\s*function\s*\(\)\s*\{\s*return\s*\[([\s\S]*?)\]\.concat/g;
  while ((m = recPattern.exec(text)) !== null) {
    const recBaseName = m[1];
    const attrsBody = m[2];
    const attrs = [];
    const attrPattern = /this\.attr\s*\(\s*"([^"]+)"\s*,\s*"[^"]+"\s*,\s*"[^"]*"\s*,[^,]*,[^,]*,\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
    let am;
    while ((am = attrPattern.exec(attrsBody)) !== null) {
      attrs.push({ name: am[1], type: am[2] });
    }
    if (attrs.length > 0) {
      schemas[recBaseName] = attrs;
    }
  }

  // Connect schemas to entities by naming convention (EntityName → EntityNameRec)
  for (const data of Object.values(entities)) {
    if (schemas[data.entityName]) {
      data.attributes = schemas[data.entityName];
    }
  }

  return { entities, schemas };
}

/* ------------------------------------------------------------------ */
/*  PARSE SCREEN ROLES (from mvc.js checkPermissions)                  */
/* ------------------------------------------------------------------ */

/**
 * Parse the checkPermissions function from a screen's mvc.js to extract
 * the roles required to access the screen.
 *
 * Patterns found in the wild:
 *   - Empty body (public):       checkPermissions = function () {};
 *   - Registered users only:     checkPermissions = function () { OS.RolesInfo.checkRegistered(); };
 *   - Specific roles:            checkPermissions = function () { OS.RolesInfo.checkRoles([...Controller.default.roles.Name, ...]); };
 *
 * @param {string} text - Content of a *.mvc.js file
 * @returns {string[]} Array of role names, or special markers ["Public"] / ["Registered"]
 */
function parseMvcRoles(text) {
  const cpMatch = text.match(/checkPermissions\s*=\s*function\s*\(\)\s*\{([\s\S]*?)\};/);
  if (!cpMatch) return null;

  const body = cpMatch[1].trim();
  if (!body) return ["Public"];
  if (body.includes("checkRegistered")) return ["Registered"];

  const roles = [];
  const rolePattern = /\.roles\.(\w+)/g;
  let m;
  while ((m = rolePattern.exec(body)) !== null) {
    roles.push(m[1]);
  }
  return roles.length > 0 ? roles : null;
}

/* ------------------------------------------------------------------ */
/*  FETCH SCREENS (via moduleinfo)                                     */
/* ------------------------------------------------------------------ */
export async function fetchScreens(pageUrl) {
  if (!pageUrl || !pageUrl.startsWith("http")) {
    return { ok: false, error: "Cannot access tab URL." };
  }

  const url = new URL(pageUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length === 0) {
    return { ok: false, error: "Cannot determine module name from URL." };
  }

  const moduleName = pathParts[0];
  const moduleInfoUrl = `${url.origin}/${moduleName}/moduleservices/moduleinfo?${Date.now()}`;
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

  // Enrich with flow info, MVC module names, home screen, and static entities
  const screenMap = {};
  let homeScreenName = null;
  const staticEntities = [];
  const modules = data?.data?.modules || {};

  for (const moduleData of Object.values(modules)) {
    // Screen metadata (name + MVC module references)
    if (moduleData.screens) {
      for (const screen of moduleData.screens) {
        screenMap[screen.screenUrl] = {
          screenName: screen.screenName,
          controllerModuleName: screen.controllerModuleName || null,
        };
      }
    }

    // Home screen (from the module matching the current URL)
    if (!homeScreenName && moduleData.moduleName &&
        moduleData.moduleName.toLowerCase() === moduleName.toLowerCase()) {
      homeScreenName = moduleData.homeScreenName || null;
    }

    // Static entities
    const entities = moduleData.staticEntities || {};
    const modName = moduleData.moduleName || "Unknown";
    for (const [entityGuid, records] of Object.entries(entities)) {
      const recordList = [];
      for (const [recordGuid, recordName] of Object.entries(records)) {
        recordList.push({ guid: recordGuid, name: recordName });
      }
      if (recordList.length > 0) {
        staticEntities.push({
          module: modName,
          entityGuid,
          records: recordList.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
    }
  }

  const screens = [...screenUrlSet].sort().map((screenUrl) => {
    const info = screenMap[screenUrl];
    const fullName = info ? info.screenName : screenUrl;
    const nameParts = fullName.split(".");
    return {
      screenUrl,
      name: nameParts.length > 1 ? nameParts.slice(1).join(".") : fullName,
      flow: nameParts.length > 1 ? nameParts[0] : "",
      fullName,
      controllerModuleName: info?.controllerModuleName || null,
    };
  });

  // Version info from manifest
  const versionInfo = {
    versionToken: data?.manifest?.versionToken || null,
    versionSequence: data?.manifest?.versionSequence ?? null,
  };

  const baseUrl = `${url.origin}/${moduleName}`;

  // Enrich screens with role information from their mvc.js checkPermissions
  const urlVersions = data?.manifest?.urlVersions || {};
  {
    const mvcEntries = [];
    for (const [urlPath, version] of Object.entries(urlVersions)) {
      if (!urlPath.endsWith(".mvc.js")) continue;
      // Match screen mvc.js: /scripts/Module.Flow.ScreenName.mvc.js
      // Screen entries have exactly Module.Flow.Screen (3+ dot-separated parts before .mvc.js)
      const fileMatch = urlPath.match(/\/scripts\/(.+)\.mvc\.js$/);
      if (!fileMatch) continue;
      const mvcModuleName = fileMatch[1];
      // Find which screen this mvc.js belongs to by matching controllerModuleName
      const controllerName = mvcModuleName + ".mvc$controller";
      const screen = screens.find(s => s.controllerModuleName === controllerName);
      if (screen) {
        mvcEntries.push({ screen, url: `${url.origin}${urlPath}${version}` });
      }
    }
    await Promise.all(mvcEntries.map(async ({ screen, url }) => {
      try {
        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) return;
        const text = await resp.text();
        screen.roles = parseMvcRoles(text);
      } catch (_) { /* skip failed fetches */ }
    }));
  }

  // Enrich static entities with names and attribute schemas from model.js files
  if (staticEntities.length > 0) {
    // Discover ALL model.js filenames from the manifest urlVersions.
    // Entity name→GUID mappings live in consumer modules' model.js files,
    // not necessarily in the defining module, so we must scan all of them.
    const modelJsNames = new Set();
    const modelJsPattern = /\/scripts\/(.+)\.model\.js$/;
    for (const urlPath of Object.keys(urlVersions)) {
      const match = urlPath.match(modelJsPattern);
      if (match) modelJsNames.add(match[1]);
    }
    // Also include module names from moduleinfo as a fallback
    for (const m of Object.values(modules)) {
      if (m.moduleName) modelJsNames.add(m.moduleName);
    }

    // Fetch and parse model.js for each module (in parallel)
    const enrichmentMap = {};
    const allSchemas = {};
    const fetches = [...modelJsNames].map(async (modName) => {
      try {
        const modelUrl = `${baseUrl}/scripts/${modName}.model.js?${Date.now()}`;
        const resp = await fetch(modelUrl, { credentials: "include" });
        if (!resp.ok) return;
        const text = await resp.text();
        const { entities, schemas } = parseModelJsStaticEntities(text);
        for (const [guid, eData] of Object.entries(entities)) {
          if (!enrichmentMap[guid]) {
            enrichmentMap[guid] = { ...eData };
          } else {
            Object.assign(enrichmentMap[guid].records, eData.records);
            if (eData.attributes && !enrichmentMap[guid].attributes) {
              enrichmentMap[guid].attributes = eData.attributes;
            }
          }
        }
        Object.assign(allSchemas, schemas);
      } catch (_) { /* skip failed fetches */ }
    });
    await Promise.all(fetches);

    // Second pass: connect orphan schemas to entities by naming convention
    for (const data of Object.values(enrichmentMap)) {
      if (!data.attributes && allSchemas[data.entityName]) {
        data.attributes = allSchemas[data.entityName];
      }
    }

    // Apply enrichment to staticEntities
    for (const entity of staticEntities) {
      const enrichment = enrichmentMap[entity.entityGuid];
      if (enrichment) {
        entity.entityName = enrichment.entityName;
        entity.attributes = enrichment.attributes || [];
        for (const record of entity.records) {
          if (enrichment.records[record.guid]) {
            record.recordName = enrichment.records[record.guid];
          }
        }
      }
    }
  }

  // Discover block .mvc.js files from urlVersions
  // Blocks are any .mvc.js files that don't belong to a known screen
  const screenControllerNames = new Set(
    screens.map(s => s.controllerModuleName).filter(Boolean)
  );
  const blocks = [];
  for (const [urlPath, version] of Object.entries(urlVersions)) {
    if (!urlPath.endsWith(".mvc.js")) continue;
    const fileMatch = urlPath.match(/\/scripts\/(.+)\.mvc\.js$/);
    if (!fileMatch) continue;
    const mvcModuleName = fileMatch[1];
    const controllerName = mvcModuleName + ".mvc$controller";
    // Skip screen mvc.js files (already handled above)
    if (screenControllerNames.has(controllerName)) continue;
    const parts = mvcModuleName.split(".");
    const blockName = parts[parts.length - 1];
    // Group is the parent path (e.g. "MyApp.WebBlocks")
    const group = parts.length > 1 ? parts.slice(0, -1).join(".") : parts[0];
    const module = parts[0];
    blocks.push({
      name: blockName,
      mvcModuleName,
      controllerModuleName: controllerName,
      module,
      group,
      fullName: mvcModuleName,
    });
  }
  blocks.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    screens,
    blocks,
    moduleName,
    baseUrl,
    currentScreen,
    homeScreenName,
    versionInfo,
    staticEntities,
  };
}

/* ------------------------------------------------------------------ */
/*  FETCH ROLES (via controller.js)                                    */
/* ------------------------------------------------------------------ */
export async function fetchRoles(pageUrl) {
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
  const controllerUrl = `${url.origin}/${moduleName}/scripts/${controllerFileName}?${Date.now()}`;

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
  const rolePattern = /(\w+)\s*:\s*\{\s*roleKey\s*:\s*"([^"]*)"\s*,\s*roleException\s*:\s*new\s+OS\.Exceptions\.Exceptions\.NotRegisteredException\s*\([^)]*\)/g;
  let match;
  while ((match = rolePattern.exec(scriptText)) !== null) {
    roles.push({
      name: match[1],
      roleKey: match[2],
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
export async function fetchScreenDetails(baseUrl, moduleName, flow, screenName, controllerModuleName) {
  // Construct the MVC file URL from the exact module name if available, otherwise fall back to convention
  let mvcUrl;
  if (controllerModuleName) {
    const mvcFileName = controllerModuleName.replace(/\$controller$/, '') + '.js';
    mvcUrl = `${baseUrl}/scripts/${mvcFileName}?${Date.now()}`;
  } else {
    mvcUrl = `${baseUrl}/scripts/${moduleName}.${flow}.${screenName}.mvc.js?${Date.now()}`;
  }

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
  // Scope to VariablesRecord block to avoid picking up DataAction/Aggregate
  // output record attributes (e.g. DataAction1DataActRec.attributesToDeclare)
  // ----------------------------------------------------------------
  const varsRecordMatch = scriptText.match(/VariablesRecord\.attributesToDeclare\s*=\s*function\s*\(\)\s*\{([\s\S]*?)\]\.concat/);
  const varsRecordBody = varsRecordMatch ? varsRecordMatch[1] : scriptText;
  const varPattern = /this\.attr\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
  let match;
  const seenVars = new Set();
  while ((match = varPattern.exec(varsRecordBody)) !== null) {
    const displayName = match[1];
    const internalName = match[2];
    const rawType = match[3];
    // Normalize OutSystems DataTypes to display names (e.g. "DateTime" → "Date Time")
    const TYPE_MAP = { DateTime: "Date Time", LongInteger: "Long Integer", PhoneNumber: "Phone Number" };
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
        result.aggregates.push({ name, refreshMethodName: rawName });
      } else if (isDataAction) {
        result.dataActions.push({ name, refreshMethodName: rawName });
      }
    }
  }

  // ----------------------------------------------------------------
  // Enrich Data Actions with output parameter metadata
  // Pattern: {Name}DataActRec.attributesToDeclare = function () {
  //   return [ this.attr("DisplayName", "attrName", ..., OS.DataTypes.DataTypes.TypeName, ...) ]
  // Also find the variable attrName from VariablesRecord
  // ----------------------------------------------------------------
  const TYPE_MAP_DA = { DateTime: "Date Time", LongInteger: "Long Integer", PhoneNumber: "Phone Number" };

  for (const da of result.dataActions) {
    const baseCamel = da.refreshMethodName.replace("$DataActRefresh", "");
    // Match the DataActRec.attributesToDeclare block (case-insensitive on base name)
    const recPattern = new RegExp(
      baseCamel + "DataActRec\\.attributesToDeclare\\s*=\\s*function\\s*\\(\\)\\s*\\{[\\s\\S]*?return\\s*\\[([\\s\\S]*?)\\]\\.concat",
      "i"
    );
    const recMatch = recPattern.exec(scriptText);
    da.outputs = [];
    if (recMatch) {
      const attrsStr = recMatch[1];
      const attrPattern = /this\.attr\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
      let attrMatch;
      while ((attrMatch = attrPattern.exec(attrsStr)) !== null) {
        const rawType = attrMatch[3];
        const dataType = TYPE_MAP_DA[rawType] || rawType;
        da.outputs.push({ name: attrMatch[1], attrName: attrMatch[2], dataType });
      }
    }

    // Find the variable attrName from VariablesRecord
    const varPattern = new RegExp(
      'this\\.attr\\s*\\(\\s*"' + da.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*,\\s*"([^"]+DataAct[^"]*)"'
    );
    const varMatch = varPattern.exec(varsRecordBody);
    da.varAttrName = varMatch ? varMatch[1] : null;
  }

  // ----------------------------------------------------------------
  // Enrich Aggregates with output parameter metadata and variable attrName
  // Standard aggregate output: AggregateRecord with listOut, countOut, dataFetchStatusAttr
  // Also find the variable attrName from VariablesRecord (contains "Aggr")
  // ----------------------------------------------------------------
  for (const aggr of result.aggregates) {
    const baseCamel = aggr.refreshMethodName.replace("$AggrRefresh", "");
    // Match the AggrRec.attributesToDeclare block (case-insensitive on base name)
    const recPattern = new RegExp(
      baseCamel + "AggrRec\\.attributesToDeclare\\s*=\\s*function\\s*\\(\\)\\s*\\{[\\s\\S]*?return\\s*\\[([\\s\\S]*?)\\]\\.concat",
      "i"
    );
    const recMatch = recPattern.exec(scriptText);
    aggr.outputs = [];
    if (recMatch) {
      const attrsStr = recMatch[1];
      const attrPattern = /this\.attr\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
      let attrMatch;
      while ((attrMatch = attrPattern.exec(attrsStr)) !== null) {
        const rawType = attrMatch[3];
        const dataType = TYPE_MAP_DA[rawType] || rawType;
        aggr.outputs.push({ name: attrMatch[1], attrName: attrMatch[2], dataType });
      }
    }

    // Find the variable attrName from VariablesRecord
    const varPattern = new RegExp(
      'this\\.attr\\s*\\(\\s*"' + aggr.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*,\\s*"([^"]+Aggr[^"]*)"'
    );
    const varMatch = varPattern.exec(varsRecordBody);
    aggr.varAttrName = varMatch ? varMatch[1] : null;
  }

  // ----------------------------------------------------------------
  // Parse Server Actions with input/output parameters
  // Pattern: Controller.prototype.actionName$ServerAction = function (params..., callContext) { ... }
  // Inputs:  ExternalName: OS.DataConversion.ServerDataConverter.to(paramVar, OS.DataTypes.DataTypes.TYPE)
  // Outputs: registerVariableGroupType("...$Action{ActionName}", [{ name, attrName, dataType, ... }])
  // ----------------------------------------------------------------
  const TYPE_MAP_SA = { DateTime: "Date Time", LongInteger: "Long Integer", PhoneNumber: "Phone Number" };
  const serverActionFullPattern = /Controller\.prototype\.(\w+\$ServerAction)\s*=\s*function\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\};/g;
  while ((match = serverActionFullPattern.exec(scriptText)) !== null) {
    const methodName = match[1];
    const baseName = methodName.replace("$ServerAction", "");
    const displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
    const sigParams = match[2].split(",").map(p => p.trim()).filter(p => p && p !== "callContext");
    const body = match[3];

    // Parse inputs from ServerDataConverter.to(paramVar, OS.DataTypes.DataTypes.TYPE)
    const inputs = [];
    const inputPattern = /(\w+)\s*:\s*OS\.DataConversion\.ServerDataConverter\.to\s*\(\s*(\w+)\s*,\s*OS\.DataTypes\.DataTypes\.(\w+)\s*\)/g;
    let inputMatch;
    while ((inputMatch = inputPattern.exec(body)) !== null) {
      const rawType = inputMatch[3];
      const dataType = TYPE_MAP_SA[rawType] || rawType;
      inputs.push({ name: inputMatch[1], paramName: inputMatch[2], dataType });
    }

    // Fallback: if no ServerDataConverter pattern, derive from signature params
    if (inputs.length === 0 && sigParams.length > 0) {
      for (const p of sigParams) {
        inputs.push({ name: p, paramName: p, dataType: "Text" });
      }
    }

    // Parse outputs from registerVariableGroupType("...$Action{ActionName}", [...])
    const outputs = [];
    const outputGroupRe = new RegExp(
      'Controller\\.registerVariableGroupType\\s*\\(\\s*"([^"]*\\$Action' +
      displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      ')"\\s*,\\s*\\[([\\s\\S]*?)\\]\\s*\\)',
      'i'
    );
    const outputGroupMatch = outputGroupRe.exec(scriptText);
    if (outputGroupMatch) {
      const entriesStr = outputGroupMatch[2];
      const outParamPattern = /name:\s*"([^"]+)"[\s\S]*?attrName:\s*"([^"]+)"[\s\S]*?mandatory:\s*(true|false)[\s\S]*?dataType:\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
      let outMatch;
      while ((outMatch = outParamPattern.exec(entriesStr)) !== null) {
        const rawType = outMatch[4];
        const dataType = TYPE_MAP_SA[rawType] || rawType;
        outputs.push({
          name: outMatch[1],
          attrName: outMatch[2],
          dataType,
          mandatory: outMatch[3] === "true",
        });
      }
    }

    result.serverActions.push({ name: displayName, methodName, inputs, outputs });
  }

  // ----------------------------------------------------------------
  // Parse Screen Actions (Client Actions)
  // Pattern: Controller.prototype._actionName$Action = function (implementation)
  //          Controller.prototype.actionName$Action = function(params..., callContext) (proxy)
  // ----------------------------------------------------------------

  // Build a map of action name → input param attr names by matching proxy
  // params to internal function assignments (vars.value.ATTR = PARAM)
  const actionInputAttrNames = {};
  const proxyPattern = /Controller\.prototype\.(\w+)\$Action\s*=\s*function\s*\(([^)]*)\)/g;
  let proxyMatch;
  while ((proxyMatch = proxyPattern.exec(scriptText)) !== null) {
    const actionName = proxyMatch[1];
    const sigParams = proxyMatch[2].split(",").map(p => p.trim()).filter(p => p && p !== "callContext");
    // Find the internal function body to map proxy params → attrNames
    const internalRe = new RegExp("Controller\\.prototype\\._" + actionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\$Action\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\};");
    const internalMatch = internalRe.exec(scriptText);
    const resolvedAttrNames = new Set();
    if (internalMatch) {
      const body = internalMatch[1];
      for (const param of sigParams) {
        const assignRe = new RegExp("vars\\.value\\.(\\w+)\\s*=\\s*" + param + "(?:\\.|;|\\s|\\))");
        const assignMatch = assignRe.exec(body);
        if (assignMatch) {
          resolvedAttrNames.add(assignMatch[1]);
        }
      }
    }
    // Use resolved attrNames if found, otherwise fall back to proxy param names
    actionInputAttrNames[actionName.toLowerCase()] = resolvedAttrNames.size > 0 ? resolvedAttrNames : new Set(sigParams);
  }

  // Parse actual action implementations (underscore-prefixed)
  const screenActionPattern = /Controller\.prototype\._(\w+)\$Action\s*=/g;
  while ((match = screenActionPattern.exec(scriptText)) !== null) {
    const name = match[1];
    // Convert camelCase: onSort -> OnSort
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    // The public proxy method name (without underscore prefix)
    const methodName = name + "$Action";
    result.screenActions.push({ name: displayName, methodName, inputs: [], locals: [] });
  }

  // ----------------------------------------------------------------
  // Enrich Screen Actions with parameter metadata
  // Pattern: Controller.registerVariableGroupType("...ActionName$vars", [{
  //   name: "ParamDisplay", attrName: "paramInternal", mandatory: bool,
  //   dataType: OS.DataTypes.DataTypes.TypeName, defaultValue: fn
  // }]);
  // ----------------------------------------------------------------
  const TYPE_MAP_ACTIONS = { DateTime: "Date Time", LongInteger: "Long Integer", PhoneNumber: "Phone Number" };
  const varGroupPattern = /Controller\.registerVariableGroupType\s*\(\s*"([^"]+\$vars)"\s*,\s*\[([\s\S]*?)\]\s*\)/g;
  let varGroupMatch;
  while ((varGroupMatch = varGroupPattern.exec(scriptText)) !== null) {
    const varGroupKey = varGroupMatch[1];
    const entriesStr = varGroupMatch[2];

    // Extract action name from key: "Module.Flow.Screen.ActionName$vars" → "ActionName"
    const keyParts = varGroupKey.replace("$vars", "").split(".");
    const actionNameFromKey = keyParts[keyParts.length - 1];

    // Find the matching screen action
    const action = result.screenActions.find(
      a => a.name.toLowerCase() === actionNameFromKey.toLowerCase()
    );
    if (!action) continue;

    // Get the set of input param attr names for this action
    const inputSet = actionInputAttrNames[actionNameFromKey.toLowerCase()] || new Set();

    // Parse individual entries and classify as input or local
    const paramPattern = /name:\s*"([^"]+)"[\s\S]*?attrName:\s*"([^"]+)"[\s\S]*?mandatory:\s*(true|false)[\s\S]*?dataType:\s*OS\.DataTypes\.DataTypes\.(\w+)/g;
    let paramMatch;
    while ((paramMatch = paramPattern.exec(entriesStr)) !== null) {
      const rawType = paramMatch[4];
      const dataType = TYPE_MAP_ACTIONS[rawType] || rawType;
      const entry = {
        name: paramMatch[1],
        attrName: paramMatch[2],
        dataType,
        mandatory: paramMatch[3] === "true",
      };
      if (inputSet.has(entry.attrName)) {
        action.inputs.push(entry);
      } else {
        action.locals.push(entry);
      }
    }
  }

  return result;
}
