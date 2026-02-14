/**
 * pageScript/clientVars.js — Client variable discovery and CRUD.
 *
 * Depends on: helpers.js (_safeSerialize, _detectOsType, _coerceValue)
 *
 * Provides:
 *   - _osClientVarsScan()
 *   - _osClientVarsSet()
 *   - _osClientVarsGet()
 *   - _osProducersScan()
 *   - _osAppDefinitionScan()
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
    // Safety timeout — resolve with whatever we've collected so far
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
          const definePattern = /define\s*\(\s*["']([^"']+\.referencesHealth\$([^"']+))["']\s*,\s*\[[^\]]*\]\s*,\s*function\s*\([^)]*\)\s*\{([^}]*)\}/g;
          let match;

          while ((match = definePattern.exec(content)) !== null) {
            const producerName = match[2];
            const functionBody = match[3];

            let status = "Unknown";
            const statusMatch = functionBody.match(/\/\/\s*Reference to producer ['"]([^'"]+)['"] is (\w+)\./);
            if (statusMatch) {
              status = statusMatch[2];
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
          break;
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
