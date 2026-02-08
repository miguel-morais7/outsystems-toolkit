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

    // Scan both client variables and producers in parallel
    const producersPromise = _osProducersScan();

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
      // Still wait for producers scan even if no client vars
      const producersData = await producersPromise;
      resolve({ 
        ok: true, 
        modules: [], 
        variables: [],
        producerModules: producersData.producerModules || [],
        producers: producersData.producers || []
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
      
      // Wait for producers scan to complete
      const producersData = await producersPromise;
      
      resolve({ 
        ok: true, 
        modules: moduleList, 
        variables: allVars,
        producerModules: producersData.producerModules || [],
        producers: producersData.producers || []
      });
    }

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
                value = mod[key]();
                valueType = _detectOsType(value);
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
    case "Integer":
    case "Long Integer": {
      const parsed = parseInt(raw, 10);
      if (isNaN(parsed)) return { error: "Invalid integer: " + raw };
      return { value: parsed };
    }
    case "Decimal":
    case "Currency": {
      const parsed = parseFloat(raw);
      if (isNaN(parsed)) return { error: "Invalid number: " + raw };
      return { value: parsed };
    }
    case "Date":
    case "Time":
    case "Date Time":
      return { value: raw }; // OutSystems typically stores these as ISO strings
    default:
      return { value: String(raw) };
  }
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
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
