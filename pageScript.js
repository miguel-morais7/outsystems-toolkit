/**
 * pageScript.js — Injected into the page's MAIN world.
 * Has access to the page's `require()` AMD loader, `performance` API,
 * and all OutSystems runtime globals.
 *
 * Exposes three operations as global functions called directly by the
 * service worker via chrome.scripting.executeScript({ world: "MAIN" }):
 *   - _osClientVarsScan(): discover all clientVariables modules and read every getter
 *   - _osClientVarsSet():  call a specific setter on a loaded module
 *   - _osClientVarsGet():  call a specific getter on a loaded module (refresh single value)
 *
 * Because executeScript returns the function's return value directly to
 * the service worker, no postMessage bridge is needed.
 */

/* ------------------------------------------------------------------ */
/*  SCAN — discover modules & read all client variable values          */
/* ------------------------------------------------------------------ */
function _osClientVarsScan() {
  return new Promise(async (resolve) => {
    const SCAN_TIMEOUT_MS = 10000;

    // Scan client variables, producers, and app definition in parallel
    const producersPromise = _osProducersScan();
    const appDefPromise = _osAppDefinitionScan();

    // 1. Find all *.clientVariables.js resource entries
    const scripts = performance.getEntriesByType("resource");
    const moduleMap = new Map();

    scripts.forEach((entry) => {
      if (
        entry.initiatorType === "script" &&
        entry.name.includes("clientVariables.js")
      ) {
        const matches = entry.name.match(/([^\/]+)\.clientVariables\.js/);
        if (matches && matches[1]) {
          const moduleName = matches[1] + ".clientVariables";
          moduleMap.set(moduleName, entry.name);
        }
      }
    });

    if (moduleMap.size === 0) {
      // Still wait for parallel scans even if no client vars
      const [producersData, appDefData] = await Promise.all([producersPromise, appDefPromise]);
      resolve({
        ok: true,
        modules: [],
        variables: [],
        producerModules: producersData.producerModules || [],
        producers: producersData.producers || [],
        appDefinition: appDefData.appDefinition || null
      });
      return;
    }

    // 2. require() each module (AMD / async)
    const moduleNames = Array.from(moduleMap.keys());
    const allVars = [];
    let remaining = moduleNames.length;
    let resolved = false;

    async function finalize() {
      if (resolved) return;
      resolved = true;
      const moduleList = [...new Set(allVars.map((v) => v.module))].sort();
      allVars.sort((a, b) =>
        a.module === b.module
          ? a.name.localeCompare(b.name)
          : a.module.localeCompare(b.module)
      );

      // Wait for parallel scans to complete
      const [producersData, appDefData] = await Promise.all([producersPromise, appDefPromise]);

      resolve({
        ok: true,
        modules: moduleList,
        variables: allVars,
        producerModules: producersData.producerModules || [],
        producers: producersData.producers || [],
        appDefinition: appDefData.appDefinition || null
      });
    }
    // Capture the OutSystems runtime reference for date/time conversion
    try {
      require(["OutSystems/ClientRuntime/Main"], function (OutSystems) {
        window.__osRuntime = OutSystems.Internal;
      });
    } catch (e) { /* runtime not available */ }
    // Safety timeout — resolve with whatever we’ve collected so far
    setTimeout(() => {
      if (!resolved) {
        console.warn("[OS ClientVars] Scan timed out after " + SCAN_TIMEOUT_MS + "ms. Returning partial results.");
        finalize();
      }
    }, SCAN_TIMEOUT_MS);

    moduleNames.forEach((moduleName) => {
      try {
        require([moduleName], function (mod) {
          const shortName = moduleName.split(".")[0];

          // Expose on window so setters can be called later
          window["__osCV_" + shortName] = mod;

          for (const key in mod) {
            if (typeof mod[key] === "function" && key.startsWith("get")) {
              const varName = key.substring(3);

              // Check if a corresponding setter exists
              const hasSetter = typeof mod["set" + varName] === "function";

              let value;
              let valueType = "Text"; // default
              try {
                // Detect exact Date/Time/DateTime type from getter source code
                // (the OS runtime embeds DataTypes.Date, DataTypes.Time, DataTypes.DateTime)
                try {
                  const getterSrc = mod[key].toString();
                  if (getterSrc.includes("DataTypes.DateTime")) valueType = "Date Time";
                  else if (getterSrc.includes("DataTypes.Date")) valueType = "Date";
                  else if (getterSrc.includes("DataTypes.Time")) valueType = "Time";
                  else if (getterSrc.includes("DataTypes.Currency")) valueType = "Currency";
                  else if (getterSrc.includes("DataTypes.LongInteger")) valueType = "Long Integer";
                  else if (getterSrc.includes("DataTypes.Decimal")) valueType = "Decimal";
                } catch (srcErr) { /* source inspection failed, will detect from value */ }

                value = mod[key]();

                // If type wasn't detected from source, detect from value
                if (valueType === "Text") {
                  valueType = _detectOsType(value);
                }
              } catch (e) {
                value = null;
                valueType = "Error";
              }

              allVars.push({
                module: shortName,
                name: varName,
                value: _safeSerialize(value),
                type: valueType,
                readOnly: !hasSetter,
              });
            }
          }

          remaining--;
          if (remaining === 0) finalize();
        });
      } catch (e) {
        remaining--;
        if (remaining === 0) finalize();
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/*  SET — call a setter on a previously-loaded module                  */
/* ------------------------------------------------------------------ */
function _osClientVarsSet(moduleName, varName, rawValue, varType) {
  try {
    const mod = window["__osCV_" + moduleName];
    if (!mod) return { ok: false, error: "Module not loaded: " + moduleName };

    const setterName = "set" + varName;
    if (typeof mod[setterName] !== "function")
      return { ok: false, error: "Setter not found: " + setterName };

    const coerced = _coerceValue(rawValue, varType);
    if (coerced.error) return { ok: false, error: coerced.error };
    mod[setterName](coerced.value);

    // Read back the value to confirm
    const getterName = "get" + varName;
    let newValue = null;
    if (typeof mod[getterName] === "function") {
      newValue = _safeSerialize(mod[getterName]());
    }
    return { ok: true, newValue: newValue };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  GET — refresh a single variable's value                            */
/* ------------------------------------------------------------------ */
function _osClientVarsGet(moduleName, varName) {
  try {
    const mod = window["__osCV_" + moduleName];
    if (!mod) return { ok: false, error: "Module not loaded: " + moduleName };

    const getterName = "get" + varName;
    if (typeof mod[getterName] !== "function")
      return { ok: false, error: "Getter not found: " + getterName };

    const value = mod[getterName]();
    return { ok: true, value: _safeSerialize(value), type: _detectOsType(value) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  SCAN PRODUCERS — discover producer references from referencesHealth.js */
/* ------------------------------------------------------------------ */
function _osProducersScan() {
  return new Promise((resolve) => {
    const SCAN_TIMEOUT_MS = 10000;

    // 1. Find all *.referencesHealth.js resource entries
    const scripts = performance.getEntriesByType("resource");
    const resourceMap = new Map();

    scripts.forEach((entry) => {
      if (
        entry.initiatorType === "script" &&
        entry.name.includes("referencesHealth.js")
      ) {
        const matches = entry.name.match(/([^\/]+)\.referencesHealth\.js/);
        if (matches && matches[1]) {
          const moduleName = matches[1];
          resourceMap.set(moduleName, entry.name);
        }
      }
    });

    if (resourceMap.size === 0) {
      resolve({ ok: true, producerModules: [], producers: [] });
      return;
    }

    // 2. Fetch each referencesHealth.js file and parse producer references
    const allProducers = [];
    let remaining = resourceMap.size;
    let resolved = false;

    function finalize() {
      if (resolved) return;
      resolved = true;
      const producerModuleList = [...new Set(allProducers.map((p) => p.module))].sort();
      allProducers.sort((a, b) =>
        a.module === b.module
          ? a.producer.localeCompare(b.producer)
          : a.module.localeCompare(b.module)
      );
      resolve({ ok: true, producerModules: producerModuleList, producers: allProducers });
    }

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        console.warn("[OS Producers] Scan timed out after " + SCAN_TIMEOUT_MS + "ms. Returning partial results.");
        finalize();
      }
    }, SCAN_TIMEOUT_MS);

    resourceMap.forEach((url, moduleName) => {
      fetch(url)
        .then((response) => response.text())
        .then((content) => {
          // Parse define() calls: define("ModuleName.referencesHealth$ProducerName", [], function () { ... })
          // with comment: // Reference to producer 'ProducerName' is OK.
          const definePattern = /define\s*\(\s*["']([^"']+\.referencesHealth\$([^"']+))["']\s*,\s*\[[^\]]*\]\s*,\s*function\s*\([^)]*\)\s*\{([^}]*)\}/g;
          let match;

          while ((match = definePattern.exec(content)) !== null) {
            const producerName = match[2];
            const functionBody = match[3];

            // Extract status from comment inside function body
            let status = "Unknown";
            const statusMatch = functionBody.match(/\/\/\s*Reference to producer ['"]([^'"]+)['"] is (\w+)\./);
            if (statusMatch) {
              status = statusMatch[2]; // "OK" or other status
            }

            allProducers.push({
              module: moduleName,
              producer: producerName,
              status: status,
            });
          }

          remaining--;
          if (remaining === 0) finalize();
        })
        .catch((err) => {
          console.warn("[OS Producers] Failed to fetch " + url + ": " + err.message);
          remaining--;
          if (remaining === 0) finalize();
        });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  SCAN APP DEFINITION — discover appDefinition module metadata       */
/* ------------------------------------------------------------------ */
function _osAppDefinitionScan() {
  return new Promise((resolve) => {
    const SCAN_TIMEOUT_MS = 5000;

    // 1. Find *.appDefinition.js resource entry
    const scripts = performance.getEntriesByType("resource");
    let moduleName = null;

    for (const entry of scripts) {
      if (
        entry.initiatorType === "script" &&
        entry.name.includes("appDefinition.js")
      ) {
        const matches = entry.name.match(/([^\/]+)\.appDefinition\.js/);
        if (matches && matches[1]) {
          moduleName = matches[1] + ".appDefinition";
          break; // One appDefinition per app
        }
      }
    }

    if (!moduleName) {
      resolve({ ok: true, appDefinition: null });
      return;
    }

    let resolved = false;

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: true, appDefinition: null });
      }
    }, SCAN_TIMEOUT_MS);

    // 2. require() the AMD module
    try {
      require([moduleName], function (mod) {
        if (resolved) return;
        resolved = true;

        // Clone to a plain object for safe serialization across worlds
        const appDef = {};
        for (const key in mod) {
          if (Object.prototype.hasOwnProperty.call(mod, key)) {
            const val = mod[key];
            if (val === null || typeof val !== "object") {
              appDef[key] = val;
            } else {
              try {
                appDef[key] = JSON.parse(JSON.stringify(val));
              } catch {
                appDef[key] = String(val);
              }
            }
          }
        }

        resolve({ ok: true, appDefinition: appDef });
      });
    } catch (e) {
      if (!resolved) {
        resolved = true;
        resolve({ ok: true, appDefinition: null });
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/*  GET SCREEN VARS — read live values from the current screen         */
/* ------------------------------------------------------------------ */
/**
 * Finds the live OutSystems View component via React fiber traversal,
 * then reads all variable values from controller.model.variables.
 *
 * @param {Array} varDefs - Array of {name, internalName, type, isInput} from
 *        the parsed .mvc.js file (provided by background.js).
 * @returns {Object} { ok, variables: [{name, internalName, type, isInput, value, readOnly}] }
 */
function _osScreenVarsGet(varDefs) {
  try {
    const model = _findCurrentScreenModel();
    if (!model) {
      return { ok: false, error: "Could not find the active screen's model. Is the screen loaded?" };
    }

    const READ_ONLY_TYPES = ["RecordList", "Record", "Object", "BinaryData"];
    const variables = [];

    for (const def of varDefs) {
      const isReadOnly = READ_ONLY_TYPES.includes(def.type);
      let value = null;
      try {
        const raw = model.variables[def.internalName];
        value = isReadOnly ? ("[" + def.type + "]") : _safeSerialize(raw);
      } catch (e) {
        value = null;
      }

      variables.push({
        name: def.name,
        internalName: def.internalName,
        type: def.type,
        isInput: def.isInput,
        value: value,
        readOnly: isReadOnly,
      });
    }

    return { ok: true, variables };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  SET SCREEN VAR — write a value to a live screen variable           */
/* ------------------------------------------------------------------ */
/**
 * Sets a screen variable value on the live model and triggers re-render.
 *
 * @param {string} internalName - The internal variable name (e.g. "thisIsMyTextVarVar")
 * @param {*} rawValue - The new value
 * @param {string} dataType - The OS data type (Text, Integer, Boolean, etc.)
 * @returns {Object} { ok, newValue }
 */
function _osScreenVarsSet(internalName, rawValue, dataType) {
  try {
    const viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
    }

    const model = viewInstance.model;
    if (!model || !model.variables) {
      return { ok: false, error: "Screen model not found." };
    }

    // Coerce the value to the appropriate type
    const coerced = _coerceValue(rawValue, dataType);
    if (coerced.error) return { ok: false, error: coerced.error };

    // Set the variable value
    model.variables[internalName] = coerced.value;

    // Trigger re-render — OutSystems BaseViewModel has a refresh mechanism
    // Try multiple approaches to ensure the UI updates
    try {
      if (typeof viewInstance.forceUpdate === "function") {
        viewInstance.forceUpdate();
      } else if (typeof viewInstance.setState === "function") {
        viewInstance.setState({});
      }
    } catch (renderErr) {
      // Silently continue — value is set even if re-render fails
    }

    // Read back the value to confirm
    const newValue = _safeSerialize(model.variables[internalName]);
    return { ok: true, newValue: newValue };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  INTROSPECT SCREEN VAR — deep-read complex variable structure       */
/* ------------------------------------------------------------------ */
/**
 * Introspects a screen variable through the reactive model layer,
 * recursively walking records and lists to build a serializable tree.
 *
 * @param {string} internalName - The internal variable name
 * @param {number} [maxListItems=50] - Max items to read from lists
 * @returns {Object} { ok, tree }
 */
function _osScreenVarIntrospect(internalName, maxListItems) {
  try {
    const model = _findCurrentScreenModel();
    if (!model) {
      return { ok: false, error: "Could not find the active screen's model." };
    }

    const raw = model.variables[internalName];
    if (raw === undefined) {
      return { ok: false, error: "Variable '" + internalName + "' not found on model." };
    }

    const tree = _introspectValue(raw, internalName, 0, maxListItems || 50);
    return { ok: true, tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  List abstraction helpers — support both old and new OS runtime APIs  */
/* ------------------------------------------------------------------ */

/** Detect if a value is an OutSystems reactive list. */
function _isList(value) {
  if (!value || typeof value !== "object") return false;
  // New API: .count() function + .get() function
  if (typeof value.count === "function" && typeof value.get === "function") return true;
  // Legacy API: numeric .length + .getItem() function
  if (typeof value.length === "number" && typeof value.getItem === "function") return true;
  return false;
}

/** Get the item count from a list (supports both APIs). */
function _listCount(list) {
  if (typeof list.count === "function") return list.count();
  return list.length;
}

/** Get an item by index from a list (supports both APIs). */
function _listGet(list, index) {
  if (typeof list.get === "function") return list.get(index);
  return list.getItem(index);
}

/**
 * Recursively introspect a reactive model value.
 * Detects lists (.count + .get or .length + .getItem), records, and primitives.
 *
 * @param {*} value - The reactive model value to introspect
 * @param {string} key - The property key name
 * @param {number} depth - Current recursion depth
 * @param {number} maxListItems - Max list items to enumerate
 * @returns {Object} Tree node: { kind, key, ... }
 */
function _introspectValue(value, key, depth, maxListItems) {
  const MAX_DEPTH = 10;

  // Null / undefined
  if (value === null || value === undefined) {
    return { kind: "primitive", key, value: value, type: "null" };
  }

  // Depth guard
  if (depth >= MAX_DEPTH) {
    return { kind: "primitive", key, value: "[max depth]", type: "truncated" };
  }

  // Primitive JS types
  if (typeof value !== "object" && typeof value !== "function") {
    return { kind: "primitive", key, value: value, type: typeof value };
  }

  // Date objects (native or OS DateTime wrapper with .getTime())
  if (value instanceof Date) {
    return { kind: "primitive", key, value: value.toISOString(), type: "Date Time" };
  }
  // OutSystems DateTime wrapper: has .getTime() and date-part getters (year/month/day)
  if (typeof value.getTime === "function") {
    try {
      const ts = value.getTime();
      if (!isNaN(ts)) {
        return { kind: "primitive", key, value: new Date(ts).toISOString(), type: "Date Time" };
      }
    } catch (_) { /* fall through */ }
  }

  // OutSystems LongInteger wrapper: has own .internalValue property
  if (value.hasOwnProperty("internalValue") && typeof value.toString === "function") {
    try {
      return { kind: "primitive", key, value: String(value), type: "Long Integer" };
    } catch (_) { /* fall through */ }
  }

  // OutSystems numeric wrapper objects (have .toString() and internal value)
  // Constructor name may be minified, so also check via Number() coercion
  if (typeof value === "object" && value !== null &&
      typeof value.toString === "function" && typeof value.valueOf === "function") {
    // Named constructor check (non-minified builds)
    if (value.constructor && /^(Decimal|Currency|Long Integer)/.test(value.constructor.name || "")) {
      try {
        return { kind: "primitive", key, value: Number(value), type: value.constructor.name };
      } catch (e) {
        return { kind: "primitive", key, value: String(value), type: "number" };
      }
    }
  }

  // Detect list-like: new API (.count() + .get()) or legacy (.length + .getItem())
  try {
    if (_isList(value)) {
      const count = _listCount(value);
      const items = [];
      const limit = Math.min(count, maxListItems);
      for (let i = 0; i < limit; i++) {
        try {
          const item = _listGet(value, i);
          items.push(_introspectValue(item, String(i), depth + 1, maxListItems));
        } catch (e) {
          items.push({ kind: "primitive", key: String(i), value: "[error: " + e.message + "]", type: "error" });
        }
      }
      return { kind: "list", key, count, items, truncated: count > limit };
    }
  } catch (e) {
    // Not a list — continue
  }

  // Detect record-like: object with enumerable properties
  try {
    const proto = Object.getPrototypeOf(value);
    if (!proto) {
      // Plain object or null prototype — serialize as-is
      return { kind: "primitive", key, value: _safeSerialize(value), type: "Object" };
    }

    // Collect properties from the prototype chain (reactive models define getters on prototypes)
    const fields = [];
    const seen = new Set();
    const SKIP = new Set(["constructor", "toString", "valueOf", "toJSON", "hasOwnProperty",
      "isPrototypeOf", "propertyIsEnumerable", "__defineGetter__", "__defineSetter__",
      "__lookupGetter__", "__lookupSetter__", "__proto__"]);

    // Walk prototype chain to find getter properties (reactive model pattern)
    let obj = proto;
    while (obj && obj !== Object.prototype) {
      const descriptors = Object.getOwnPropertyDescriptors(obj);
      for (const [propName, desc] of Object.entries(descriptors)) {
        if (seen.has(propName)) continue;
        if (SKIP.has(propName)) continue;
        if (propName.startsWith("_")) continue;
        // Only include properties with getters (reactive model pattern) or data properties
        if (desc.get || (!desc.set && desc.value !== undefined && typeof desc.value !== "function")) {
          seen.add(propName);
          try {
            const propVal = value[propName];
            fields.push(_introspectValue(propVal, propName, depth + 1, maxListItems));
          } catch (e) {
            fields.push({ kind: "primitive", key: propName, value: "[error: " + e.message + "]", type: "error" });
          }
        }
      }
      obj = Object.getPrototypeOf(obj);
    }

    // Also check own enumerable properties (for plain data objects)
    if (fields.length === 0) {
      const ownKeys = Object.keys(value);
      for (const propName of ownKeys) {
        if (seen.has(propName)) continue;
        if (SKIP.has(propName)) continue;
        if (propName.startsWith("_")) continue;
        seen.add(propName);
        try {
          const propVal = value[propName];
          fields.push(_introspectValue(propVal, propName, depth + 1, maxListItems));
        } catch (e) {
          fields.push({ kind: "primitive", key: propName, value: "[error: " + e.message + "]", type: "error" });
        }
      }
    }

    if (fields.length > 0) {
      return { kind: "record", key, fields };
    }

    // Fallback: try to serialize
    return { kind: "primitive", key, value: _safeSerialize(value), type: "Object" };
  } catch (e) {
    return { kind: "primitive", key, value: "[error: " + e.message + "]", type: "error" };
  }
}

/* ------------------------------------------------------------------ */
/*  Path Navigation Helper                                              */
/* ------------------------------------------------------------------ */
/**
 * Navigate a reactive model variable along a path of property/index steps.
 *
 * @param {Object} variables - model.variables object
 * @param {string} internalName - Root variable key
 * @param {Array} path - Steps to walk, e.g. ["listOut", {index:0}, "nameAttr"]
 * @returns {{ target: * } | { error: string }}
 */
function _navigateToTarget(variables, internalName, path) {
  let target = variables[internalName];
  if (target === undefined) {
    return { error: "Variable '" + internalName + "' not found." };
  }

  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (typeof step === "object" && "index" in step) {
      if (!_isList(target)) {
        return { error: "Expected list at step " + i + ", got " + typeof target };
      }
      target = _listGet(target, step.index);
    } else {
      // Property access: try record .get() first, then direct property
      if (target && typeof target.get === "function" && !_isList(target)) {
        try {
          const val = target.get(step);
          if (val !== undefined) { target = val; continue; }
        } catch (_) { /* fall through to direct access */ }
      }
      target = target[step];
    }
    if (target === undefined || target === null) {
      return { error: "Path navigation failed at step " + i + " (" + JSON.stringify(step) + ")" };
    }
  }

  return { target };
}

/**
 * Flush the reactive model and force a UI re-render.
 */
function _flushAndRerender(model, viewInstance) {
  if (typeof model.flush === "function") {
    model.flush();
  }
  try {
    if (typeof viewInstance.forceUpdate === "function") {
      viewInstance.forceUpdate();
    }
  } catch (_) {
    // Silently continue
  }
}

/* ------------------------------------------------------------------ */
/*  DEEP SET SCREEN VAR — write to a nested path in the reactive model */
/* ------------------------------------------------------------------ */
/**
 * Navigates a screen variable's reactive model along a path and sets
 * the leaf value via the reactive setter, then flushes to update UI.
 *
 * @param {string} internalName - Root variable internal name
 * @param {Array} path - Array of steps, e.g. ["listOut", {index:0}, "productAttr", "nameAttr"]
 * @param {*} rawValue - The new value
 * @param {string} dataType - OS data type for coercion
 * @returns {Object} { ok, newValue }
 */
function _osScreenVarDeepSet(internalName, path, rawValue, dataType) {
  try {
    const viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
    }

    const model = viewInstance.model;
    if (!model || !model.variables) {
      return { ok: false, error: "Screen model not found." };
    }

    // Navigate to the parent of the leaf
    const parentPath = path.slice(0, -1);
    const nav = _navigateToTarget(model.variables, internalName, parentPath);
    if (nav.error) return { ok: false, error: nav.error };

    const target = nav.target;

    // Set the leaf value through the reactive setter
    const leafKey = path[path.length - 1];
    if (typeof leafKey === "object" && "index" in leafKey) {
      // Primitive list item: set by index using setItem() / set()
      if (!_isList(target)) {
        return { ok: false, error: "Expected list at leaf but got " + typeof target };
      }
      const coerced = _coerceValue(rawValue, dataType);
      if (coerced.error) return { ok: false, error: coerced.error };

      if (typeof target.setItem === "function") {
        target.setItem(leafKey.index, coerced.value);
      } else if (typeof target.data === "object" && typeof target.data.set === "function") {
        target.data.set(leafKey.index, coerced.value);
      } else {
        return { ok: false, error: "No setItem/set method found on the list." };
      }

      _flushAndRerender(model, viewInstance);

      const newValue = _safeSerialize(_listGet(target, leafKey.index));
      return { ok: true, newValue };
    }

    const coerced = _coerceValue(rawValue, dataType);
    if (coerced.error) return { ok: false, error: coerced.error };

    // Set via record .set() method if available, otherwise direct property assignment
    if (target && typeof target.set === "function" && !_isList(target)) {
      target.set(leafKey, coerced.value);
    } else {
      target[leafKey] = coerced.value;
    }

    _flushAndRerender(model, viewInstance);

    // Read back the value to confirm
    let readBack;
    if (target && typeof target.get === "function" && !_isList(target)) {
      readBack = target.get(leafKey);
    } else {
      readBack = target[leafKey];
    }
    const newValue = _safeSerialize(readBack);
    return { ok: true, newValue };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  LIST APPEND — add a new record to a reactive list                  */
/* ------------------------------------------------------------------ */
/**
 * Navigate to a list inside a screen variable, create a new default
 * record, and append it to the list.
 *
 * @param {string} internalName - Root variable internal name
 * @param {Array} path - Path to the list (e.g. [] for root, ["ordersAttr"] for nested)
 * @param {number} [maxListItems=50] - Max items for re-introspection
 * @returns {Object} { ok, tree }
 */
function _osScreenVarListAppend(internalName, path, maxListItems) {
  try {
    const viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
    }

    const model = viewInstance.model;
    if (!model || !model.variables) {
      return { ok: false, error: "Screen model not found." };
    }

    const nav = _navigateToTarget(model.variables, internalName, path);
    if (nav.error) return { ok: false, error: nav.error };

    const list = nav.target;
    if (!_isList(list)) {
      return { ok: false, error: "Target is not a list." };
    }

    // Create a new default item.
    // IMPORTANT: Use `=== null` checks (not truthiness) because primitive
    // list items like "" or 0 are valid but falsy.
    let newItem = null;
    const listLen = _listCount(list);

    // Strategy 1: Use list.getEmptyListItem() — the OS runtime's built-in template
    if (typeof list.getEmptyListItem === "function") {
      try {
        const template = list.getEmptyListItem();
        if (template !== null && template !== undefined) {
          if (typeof template !== "object" && typeof template !== "function") {
            // Primitive value (string, number, boolean) — use directly
            newItem = template;
          } else if (typeof template.clone === "function") {
            newItem = template.clone();
          } else if (template.constructor && template.constructor !== Object) {
            newItem = new template.constructor();
          } else {
            newItem = template; // push may handle cloning internally
          }
        }
      } catch (_) { /* fall through */ }
    }

    // Strategy 2: Use the emptyListItem property directly
    if (newItem === null) {
      try {
        const template = list.emptyListItem;
        if (template !== null && template !== undefined) {
          if (typeof template !== "object" && typeof template !== "function") {
            newItem = template;
          } else if (typeof template.clone === "function") {
            newItem = template.clone();
          } else if (template.constructor && template.constructor !== Object) {
            newItem = new template.constructor();
          } else {
            newItem = template;
          }
        }
      } catch (_) { /* fall through */ }
    }

    // Strategy 3: Use the constructor of an existing item (objects only)
    if (newItem === null && listLen > 0) {
      try {
        const sample = _listGet(list, 0);
        if (sample !== null && typeof sample === "object" &&
            sample.constructor && sample.constructor !== Object) {
          newItem = new sample.constructor();
        }
      } catch (_) { /* fall through */ }
    }

    // Strategy 4: For primitive lists, infer a default from an existing item
    if (newItem === null && listLen > 0) {
      try {
        const sample = _listGet(list, 0);
        if (sample === null || sample === undefined || typeof sample !== "object") {
          if (typeof sample === "boolean") newItem = false;
          else if (typeof sample === "number") newItem = 0;
          else newItem = "";
        }
      } catch (_) { /* fall through */ }
    }

    if (newItem === null) {
      return { ok: false, error: "Cannot create a new record — no item template or constructor found." };
    }

    // Append to list — probe available methods
    let appended = false;
    if (typeof list.push === "function") {
      list.push(newItem);
      appended = true;
    } else if (typeof list.append === "function") {
      list.append(newItem);
      appended = true;
    } else if (typeof list.add === "function") {
      list.add(newItem);
      appended = true;
    } else if (typeof list.insert === "function") {
      list.insert(newItem, listLen);
      appended = true;
    }

    if (!appended) {
      return { ok: false, error: "No append method found on the list (tried push, append, add, insert)." };
    }

    _flushAndRerender(model, viewInstance);

    // Re-introspect the full variable tree
    const tree = _introspectValue(model.variables[internalName], internalName, 0, maxListItems || 50);
    return { ok: true, tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  LIST DELETE — remove a record from a reactive list by index         */
/* ------------------------------------------------------------------ */
/**
 * Navigate to a list inside a screen variable and remove the item at
 * the given index.
 *
 * @param {string} internalName - Root variable internal name
 * @param {Array} path - Path to the list
 * @param {number} index - Index of the item to remove
 * @param {number} [maxListItems=50] - Max items for re-introspection
 * @returns {Object} { ok, tree }
 */
function _osScreenVarListDelete(internalName, path, index, maxListItems) {
  try {
    const viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
    }

    const model = viewInstance.model;
    if (!model || !model.variables) {
      return { ok: false, error: "Screen model not found." };
    }

    const nav = _navigateToTarget(model.variables, internalName, path);
    if (nav.error) return { ok: false, error: nav.error };

    const list = nav.target;
    if (!_isList(list)) {
      return { ok: false, error: "Target is not a list." };
    }

    const listLen = _listCount(list);
    if (index < 0 || index >= listLen) {
      return { ok: false, error: "Index " + index + " out of bounds (list has " + listLen + " items)." };
    }

    // Remove from list — probe available methods
    let removed = false;
    if (typeof list.remove === "function") {
      list.remove(index);
      removed = true;
    } else if (typeof list.removeAt === "function") {
      list.removeAt(index);
      removed = true;
    } else if (typeof list.splice === "function") {
      list.splice(index, 1);
      removed = true;
    } else if (typeof list.deleteItem === "function") {
      list.deleteItem(index);
      removed = true;
    }

    if (!removed) {
      return { ok: false, error: "No delete method found on the list (tried remove, removeAt, splice, deleteItem)." };
    }

    _flushAndRerender(model, viewInstance);

    // Re-introspect the full variable tree
    const tree = _introspectValue(model.variables[internalName], internalName, 0, maxListItems || 50);
    return { ok: true, tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  React Fiber Traversal — find the live screen model                 */
/* ------------------------------------------------------------------ */

/**
 * Find the current screen's model object by traversing the React fiber tree.
 */
function _findCurrentScreenModel() {
  const viewInstance = _findCurrentScreenViewInstance();
  if (!viewInstance) return null;
  return viewInstance.model || null;
}

/**
 * Find the current screen's View component instance (React class component)
 * by traversing the React fiber tree from the root DOM element.
 */
function _findCurrentScreenViewInstance() {
  // OutSystems renders into a specific root element
  const root = document.querySelector("[data-container]") ||
    document.getElementById("os-root") ||
    document.querySelector(".screen") ||
    document.body;

  // Try to find React fiber from any DOM element
  const fiber = _getReactFiber(root);
  if (!fiber) {
    // Fallback: try to find any element with a fiber
    return _findViewInstanceByDOMSearch();
  }

  // Walk up the fiber tree to find the BaseWebScreen instance
  return _walkFiberForView(fiber);
}

/**
 * Get the React fiber node from a DOM element.
 */
function _getReactFiber(element) {
  if (!element) return null;
  // React 16+ uses __reactFiber$ or __reactInternalInstance$
  const keys = Object.keys(element);
  for (const key of keys) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return element[key];
    }
  }
  return null;
}

/**
 * Walk the fiber tree (up and down) to find a View component instance
 * that has a `controller` with a `model` containing `variables`.
 */
function _walkFiberForView(startFiber) {
  // First walk up to the root
  let root = startFiber;
  while (root.return) {
    root = root.return;
  }

  // Then DFS down through the tree
  return _dfsForView(root);
}

/**
 * DFS through the fiber tree looking for the screen View component.
 */
function _dfsForView(fiber) {
  if (!fiber) return null;

  // Check if this fiber's stateNode is the View we're looking for
  const instance = fiber.stateNode;
  if (instance && instance.controller && instance.model && instance.model.variables) {
    // Found a component with controller.model.variables — this is our screen View
    return instance;
  }

  // Check child
  let result = _dfsForView(fiber.child);
  if (result) return result;

  // Check siblings
  let sibling = fiber.sibling;
  while (sibling) {
    result = _dfsForView(sibling);
    if (result) return result;
    sibling = sibling.sibling;
  }

  return null;
}

/**
 * Fallback: search the DOM for elements with React fiber properties,
 * then walk each fiber tree to find the View instance.
 */
function _findViewInstanceByDOMSearch() {
  // Try common OutSystems root selectors
  const candidates = document.querySelectorAll("div[data-block], div[class*='screen'], #renderContainerId, body > div");

  for (const el of candidates) {
    const fiber = _getReactFiber(el);
    if (fiber) {
      const result = _walkFiberForView(fiber);
      if (result) return result;
    }
  }

  // Last resort: walk all direct children of body
  for (const el of document.body.children) {
    const fiber = _getReactFiber(el);
    if (fiber) {
      const result = _walkFiberForView(fiber);
      if (result) return result;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Detect the OutSystems basic data type from a JS value.
 * OS basic types: Text, Integer, Long Integer, Decimal, Boolean,
 *                 Date, Time, Date Time, Phone Number, Email, Currency.
 * At runtime they map to JS primitives — we infer what we can.
 */
function _detectOsType(value) {
  if (value === null || value === undefined) return "Text";
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "Integer" : "Decimal";
  }
  if (value instanceof Date) return "Date Time";
  // Duck-type Date-like objects (cross-frame Date or OutSystems date wrappers)
  if (typeof value === "object" && typeof value.getTime === "function" && !isNaN(value.getTime())) {
    return "Date Time";
  }
  if (typeof value === "string") {
    // Try to detect date / time patterns
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "Date Time";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date";
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return "Time";
    return "Text";
  }
  return "Text";
}

/**
 * Coerce a raw string value (from the UI) into the appropriate JS type
 * before calling the OutSystems setter.
 */
function _coerceValue(raw, varType) {
  switch (varType) {
    case "Boolean":
      if (typeof raw === "boolean") return { value: raw };
      return { value: raw === "true" || raw === "True" || raw === "1" };
    case "Integer": {
      const parsed = parseInt(raw, 10);
      if (isNaN(parsed)) return { error: "Invalid integer: " + raw };
      return { value: parsed };
    }
    case "Long Integer":
    case "Decimal":
    case "Currency":
      return _coerceNumericValue(raw, varType);
    case "Date":
    case "Time":
    case "Date Time":
      return _coerceDateValue(raw, varType);
    default:
      return { value: String(raw) };
  }
}

/**
 * Convert a raw numeric string into the OS-internal representation for
 * Currency, Decimal, and Long Integer types.
 * The OutSystems runtime wraps these in special objects — plain JS numbers
 * are rejected by clientVarsService.setVariable().
 */
function _coerceNumericValue(raw, varType) {
  // Validate it looks like a number first
  const parsed = varType === "Long Integer" ? parseInt(raw, 10) : parseFloat(raw);
  if (isNaN(parsed)) return { error: "Invalid number: " + raw };

  // Use the OS runtime converter to produce the correct wrapper type
  const OS = window.__osRuntime;
  if (OS && OS.DataConversion && OS.DataConversion.ServerDataConverter) {
    try {
      const typeEnum =
        varType === "Long Integer" ? OS.DataTypes.DataTypes.LongInteger :
          varType === "Currency" ? OS.DataTypes.DataTypes.Currency :
            OS.DataTypes.DataTypes.Decimal;

      const converted = OS.DataConversion.ServerDataConverter.from(String(raw), typeEnum);
      if (converted !== undefined && converted !== null) {
        return { value: converted };
      }
    } catch (e) { /* fall through to plain number */ }
  }

  return { value: parsed };
}

/**
 * Convert a raw date/time string from the HTML input into the value
 * expected by the OutSystems clientVarsService.setVariable().
 *
 * Strategy:
 *  1. Use the OS runtime ServerDataConverter.from() when available — this
 *     produces the exact internal representation the platform expects.
 *  2. Fall back to constructing a Date with explicit numeric components
 *     (matching the pattern the OS built-ins like CurrDate() use).
 */
function _coerceDateValue(raw, varType) {
  // --- Attempt 1: OutSystems ServerDataConverter.from() -----------------
  const OS = window.__osRuntime;
  if (OS && OS.DataConversion && OS.DataConversion.ServerDataConverter) {
    try {
      const typeEnum =
        varType === "Date" ? OS.DataTypes.DataTypes.Date :
          varType === "Time" ? OS.DataTypes.DataTypes.Time :
            OS.DataTypes.DataTypes.DateTime;

      // Build a server-format string from the HTML input value
      let serverStr;
      if (varType === "Date") {
        // HTML date input: "YYYY-MM-DD"
        serverStr = raw;
      } else if (varType === "Time") {
        // HTML time input: "HH:MM" or "HH:MM:SS"
        serverStr = raw.length === 5 ? raw + ":00" : raw;
      } else {
        // HTML datetime-local input: "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS"
        serverStr = raw;
      }

      const converted = OS.DataConversion.ServerDataConverter.from(serverStr, typeEnum);
      if (converted !== undefined && converted !== null) {
        return { value: converted };
      }
    } catch (e) {
      // ServerDataConverter.from() failed — fall through to manual
    }
  }

  // --- Attempt 2: construct Date with numeric components ----------------
  if (varType === "Date") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { error: "Invalid date: " + raw };
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(d.getTime())) return { error: "Invalid date: " + raw };
    return { value: d };
  }

  if (varType === "Time") {
    const m = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return { error: "Invalid time: " + raw };
    const d = new Date(1900, 0, 1, +m[1], +m[2], m[3] ? +m[3] : 0);
    if (isNaN(d.getTime())) return { error: "Invalid time: " + raw };
    return { value: d };
  }

  // Date Time
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return { error: "Invalid date/time: " + raw };
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  if (isNaN(d.getTime())) return { error: "Invalid date/time: " + raw };
  return { value: d };
}

/**
 * Ensure a value is JSON-serializable for transport back to the extension.
 */
function _safeSerialize(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  // Duck-type Date-like objects (cross-frame Date or OutSystems date wrappers)
  if (typeof value === "object" && typeof value.getTime === "function") {
    try {
      const ts = value.getTime();
      if (!isNaN(ts)) return new Date(ts).toISOString();
    } catch (e) { /* fall through */ }
  }
  if (typeof value === "object" && typeof value.toISOString === "function") {
    try { return value.toISOString(); } catch (e) { /* fall through */ }
  }
  // OutSystems Decimal/Currency/LongInteger wrapper objects
  if (typeof value === "object" && value !== null) {
    try {
      const num = Number(value);
      if (!isNaN(num)) return num;
    } catch (e) { /* fall through */ }
    if (typeof value.toString === "function") {
      const str = value.toString();
      if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str);
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
