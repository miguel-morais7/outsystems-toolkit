/**
 * pageScript/clientVars.js — Client variable discovery and CRUD.
 *
 * Depends on: helpers.js (_safeSerialize, _detectOsType, _coerceValue)
 *
 * Provides:
 *   - _osClientVarsScan()       (Reactive)
 *   - _osClientVarsSet()        (Reactive)
 *   - _osClientVarsGet()        (Reactive)
 *   - _osOdcClientVarsScan()    (ODC)
 *   - _osOdcClientVarsSet()     (ODC)
 *   - _osOdcClientVarsGet()     (ODC)
 */

/* ------------------------------------------------------------------ */
/*  SCAN — discover modules & read all client variable values          */
/* ------------------------------------------------------------------ */
function _osClientVarsScan() {
  return new Promise(async (resolve) => {
    const SCAN_TIMEOUT_MS = 10000;

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
      resolve({ ok: true, modules: [], variables: [] });
      return;
    }

    // 2. require() each module (AMD / async)
    const moduleNames = Array.from(moduleMap.keys());
    const allVars = [];
    let remaining = moduleNames.length;
    let resolved = false;

    function finalize() {
      if (resolved) return;
      resolved = true;
      const moduleList = [...new Set(allVars.map((v) => v.module))].sort();
      allVars.sort((a, b) =>
        a.module === b.module
          ? a.name.localeCompare(b.name)
          : a.module.localeCompare(b.module)
      );

      resolve({ ok: true, modules: moduleList, variables: allVars });
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

    const getterName = "get" + varName;
    const currentValue = typeof mod[getterName] === "function" ? mod[getterName]() : undefined;
    const coerced = _coerceValue(rawValue, varType, currentValue);
    if (coerced.error) return { ok: false, error: coerced.error };
    mod[setterName](coerced.value);

    // Read back the value to confirm
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

/* ================================================================== */
/*  ODC — Client variable discovery and CRUD                           */
/* ================================================================== */

/** Map PascalCase type names from ODC getter source to display names. */
var _ODC_TYPE_MAP = {
  DateTime: "Date Time",
  LongInteger: "Long Integer",
  PhoneNumber: "Phone Number",
};

/**
 * Scan ODC client variables by finding _oschunk-*.js scripts,
 * dynamic-importing those containing "ClientVariables", and
 * enumerating getter/setter methods on each instance.
 */
function _osOdcClientVarsScan() {
  return new Promise(async (resolve) => {
    try {
      // 1. Collect unique _oschunk-*.js URLs from performance entries
      var urls = _osOdcCollectChunkUrls();
      if (urls.length === 0) {
        resolve({ ok: true, variables: [], modules: [] });
        return;
      }

      // 2. Import all chunks in parallel, filter for ClientVariables exports
      var modules = await Promise.all(urls.map(function (url) {
        return import(url).catch(function () { return null; });
      }));

      var allVars = [];
      var moduleSet = {};

      for (var m = 0; m < modules.length; m++) {
        var mod = modules[m];
        if (!mod) continue;

        // 4. Find exports where constructor.name === "ClientVariables"
        var exportKeys = Object.keys(mod);
        for (var ek = 0; ek < exportKeys.length; ek++) {
          var val = mod[exportKeys[ek]];
          if (!val || typeof val !== "object") continue;
          if (!val.constructor || val.constructor.name !== "ClientVariables") continue;

          // 5. Enumerate getter methods on the prototype
          var proto = Object.getPrototypeOf(val);
          var methods = Object.getOwnPropertyNames(proto);
          for (var mi = 0; mi < methods.length; mi++) {
            var methodName = methods[mi];
            if (methodName === "constructor" || !methodName.startsWith("get")) continue;
            if (typeof proto[methodName] !== "function") continue;

            var varName = methodName.substring(3);
            var hasSetter = typeof proto["set" + varName] === "function";

            // Parse getter source for metadata
            var moduleName = "ClientVariables";
            var typeName = "Text";
            try {
              var src = proto[methodName].toString();
              var match = src.match(/getVariable\("([^"]+)","([^"]+)",\w+\.DataTypes\.(\w+)\)/);
              if (match) {
                varName = match[1];
                moduleName = match[2];
                typeName = _ODC_TYPE_MAP[match[3]] || match[3];
              }
            } catch (pe) { /* source parse failed */ }

            // Read current value
            var value = null;
            try {
              value = val[methodName]();

              // Cache wrapper constructors for types that need them
              if ((typeName === "Date Time" || typeName === "Date" || typeName === "Time") && value && typeof value === "object") {
                if (!window.__osODC_Ctors) window.__osODC_Ctors = {};
                window.__osODC_Ctors.DateTime = value.constructor;
              }
              if ((typeName === "Decimal" || typeName === "Currency") && value && typeof value === "object") {
                if (!window.__osODC_Ctors) window.__osODC_Ctors = {};
                window.__osODC_Ctors.Decimal = value.constructor;
              }
              if (typeName === "Long Integer" && value && typeof value === "object") {
                if (!window.__osODC_Ctors) window.__osODC_Ctors = {};
                window.__osODC_Ctors.LongInteger = value.constructor;
              }

              value = _safeSerialize(value);
            } catch (ve) { value = null; }

            // Cache the instance for later set/get calls
            window["__osODC_CV_" + moduleName] = val;
            moduleSet[moduleName] = true;

            allVars.push({
              module: moduleName,
              name: varName,
              value: value,
              type: typeName,
              readOnly: !hasSetter,
            });
          }
        }
      }

      var moduleList = Object.keys(moduleSet).sort();
      allVars.sort(function (a, b) {
        return a.module === b.module
          ? a.name.localeCompare(b.name)
          : a.module.localeCompare(b.module);
      });

      resolve({ ok: true, variables: allVars, modules: moduleList });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

/**
 * Set an ODC client variable value.
 */
function _osOdcClientVarsSet(moduleName, varName, rawValue, varType) {
  try {
    var inst = window["__osODC_CV_" + moduleName];
    if (!inst) return { ok: false, error: "Module not loaded: " + moduleName };

    var setterName = "set" + varName;
    if (typeof inst[setterName] !== "function")
      return { ok: false, error: "Setter not found: " + setterName };

    var coerced;
    var ctors = window.__osODC_Ctors || {};

    switch (varType) {
      case "Boolean":
        coerced = rawValue === "true" || rawValue === true || rawValue === "1";
        break;
      case "Integer":
        coerced = parseInt(rawValue, 10);
        if (isNaN(coerced)) return { ok: false, error: "Invalid integer: " + rawValue };
        break;
      case "Decimal":
      case "Currency":
        if (ctors.Decimal) {
          coerced = new ctors.Decimal(parseFloat(rawValue));
        } else {
          coerced = parseFloat(rawValue);
        }
        if (isNaN(typeof coerced === "object" ? parseFloat(rawValue) : coerced))
          return { ok: false, error: "Invalid number: " + rawValue };
        break;
      case "Long Integer":
        if (ctors.LongInteger) {
          coerced = new ctors.LongInteger(parseInt(rawValue, 10));
        } else {
          coerced = parseInt(rawValue, 10);
        }
        if (isNaN(parseInt(rawValue, 10)))
          return { ok: false, error: "Invalid integer: " + rawValue };
        break;
      case "Date": {
        var dm = String(rawValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dm) return { ok: false, error: "Invalid date: " + rawValue };
        var dd = new Date(+dm[1], +dm[2] - 1, +dm[3]);
        coerced = ctors.DateTime ? new ctors.DateTime(dd) : dd;
        break;
      }
      case "Time": {
        var tm = String(rawValue).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!tm) return { ok: false, error: "Invalid time: " + rawValue };
        var td = new Date(1900, 0, 1, +tm[1], +tm[2], tm[3] ? +tm[3] : 0);
        coerced = ctors.DateTime ? new ctors.DateTime(td) : td;
        break;
      }
      case "Date Time": {
        var dtm = String(rawValue).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!dtm) return { ok: false, error: "Invalid date/time: " + rawValue };
        var dtd = new Date(+dtm[1], +dtm[2] - 1, +dtm[3], +dtm[4], +dtm[5], dtm[6] ? +dtm[6] : 0);
        coerced = ctors.DateTime ? new ctors.DateTime(dtd) : dtd;
        break;
      }
      default:
        coerced = String(rawValue);
    }

    inst[setterName](coerced);

    // Read back
    var getterName = "get" + varName;
    var newValue = null;
    if (typeof inst[getterName] === "function") {
      newValue = _safeSerialize(inst[getterName]());
    }
    return { ok: true, newValue: newValue };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get a single ODC client variable's current value.
 */
function _osOdcClientVarsGet(moduleName, varName) {
  try {
    var inst = window["__osODC_CV_" + moduleName];
    if (!inst) return { ok: false, error: "Module not loaded: " + moduleName };

    var getterName = "get" + varName;
    if (typeof inst[getterName] !== "function")
      return { ok: false, error: "Getter not found: " + getterName };

    var value = inst[getterName]();
    return { ok: true, value: _safeSerialize(value), type: _detectOsType(value) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

