/**
 * pageScript/appDefinition.js — App definition metadata discovery.
 *
 * Depends on: (none)
 *
 * Provides:
 *   - _osAppDefinitionScan()        (Reactive)
 *   - _osOdcAppDefinitionScan()     (ODC)
 */

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
        resolve({ ok: false, error: "Scan timed out" });
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
        resolve({ ok: false, error: e.message });
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/*  ODC APP DEFINITION — discover metadata from _oschunk-*.js exports  */
/* ------------------------------------------------------------------ */
async function _osOdcAppDefinitionScan() {
  try {
    // 1. Collect unique _oschunk-*.js URLs
    var urls = _osOdcCollectChunkUrls();
    if (urls.length === 0) {
      return { ok: true, appDefinition: null };
    }

    // 2. Import all chunks (cached by browser)
    var modules = await Promise.all(urls.map(function (url) {
      return import(url).catch(function () { return null; });
    }));

    // 3. Find the export with applicationName + screensDefinition (app definition chunk)
    for (var m = 0; m < modules.length; m++) {
      var mod = modules[m];
      if (!mod) continue;

      var exportKeys = Object.keys(mod);
      for (var ek = 0; ek < exportKeys.length; ek++) {
        var val = mod[exportKeys[ek]];
        if (!val || typeof val !== "object") continue;
        if (typeof val.applicationName !== "string" || !Array.isArray(val.screensDefinition)) continue;

        // Found the app definition — clone serializable properties
        var appDef = {};
        var keys = Object.keys(val);
        for (var ki = 0; ki < keys.length; ki++) {
          var k = keys[ki];
          var v = val[k];
          if (v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            appDef[k] = v;
          }
          // Skip functions (importers), arrays (screensDefinition), and objects (errorPageConfig)
          // to keep the result flat and serializable
        }
        return { ok: true, appDefinition: appDef };
      }
    }

    return { ok: true, appDefinition: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
