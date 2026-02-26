/**
 * pageScript/builtinFunctions.js — Built-in function discovery and override
 *
 * Runs in the page's MAIN world.  Discovers OutSystems built-in environment
 * functions, allows overriding them with hardcoded values, and restoring
 * the originals.
 *
 * Depends on: helpers.js, fiber.js (for _flushAndRerender, _findAllViewInstances)
 */

/* ------------------------------------------------------------------ */
/*  Originals backup map                                               */
/* ------------------------------------------------------------------ */
window.__osBuiltinOriginals = window.__osBuiltinOriginals || {};

/* ------------------------------------------------------------------ */
/*  Function metadata                                                  */
/* ------------------------------------------------------------------ */

/**
 * The environment/context built-in functions we expose for override.
 * type: "date" | "datetime" | "time" | "text"
 * displayName: OutSystems-style name shown in the UI
 */
var _builtinFuncMeta = [
  { key: "currDate",            type: "date",     displayName: "CurrDate" },
  { key: "currDateTime",        type: "datetime", displayName: "CurrDateTime" },
  { key: "currTime",            type: "time",     displayName: "CurrTime" },
  { key: "getUserId",           type: "text",     displayName: "GetUserId" },
  { key: "getCurrentLocale",    type: "text",     displayName: "GetCurrentLocale" },
  { key: "getUserAgent",        type: "text",     displayName: "GetUserAgent" },
  { key: "getEntryEspaceName",  type: "text",     displayName: "GetEntryEspaceName" },
  { key: "getOwnerURLPath",     type: "text",     displayName: "GetOwnerURLPath" },
  { key: "getBookmarkableURL",  type: "text",     displayName: "GetBookmarkableURL" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function _builtinGetBF() {
  var OS = require("OutSystems/ClientRuntime/Main");
  return OS.Internal.BuiltinFunctions;
}

/** Cached OutSystems DateTime constructor (resolved lazily). */
var _osDateTimeClass = null;

function _getDateTimeClass() {
  if (_osDateTimeClass) return _osDateTimeClass;
  var bf = _builtinGetBF();
  // Try originals first (in case functions are already overridden)
  var keys = Object.keys(window.__osBuiltinOriginals);
  for (var i = 0; i < keys.length; i++) {
    try {
      var val = window.__osBuiltinOriginals[keys[i]]();
      if (val && typeof val === "object" && typeof val.year !== "undefined") {
        _osDateTimeClass = val.constructor;
        return _osDateTimeClass;
      }
    } catch (e) { /* skip */ }
  }
  // Fall back to a live date/time function
  var dateKeys = ["currDate", "currDateTime", "currTime"];
  for (var j = 0; j < dateKeys.length; j++) {
    try {
      var val2 = bf[dateKeys[j]]();
      if (val2 && typeof val2 === "object" && typeof val2.year !== "undefined") {
        _osDateTimeClass = val2.constructor;
        return _osDateTimeClass;
      }
    } catch (e) { /* skip */ }
  }
  return null;
}

/**
 * Format a raw return value as a display string.
 * Handles both OutSystems DateTime objects (.year/.month/… properties)
 * and plain JS Date instances.
 */
function _builtinFormatValue(val, type) {
  if (val == null) return "";
  if (type === "date" || type === "datetime" || type === "time") {
    // OutSystems DateTime wrapper — has .year, .month, .day, etc.
    if (val && typeof val === "object" && typeof val.year !== "undefined" && !(val instanceof Date)) {
      var pad2 = function (n) { return (n < 10 ? "0" : "") + n; };
      var pad4 = function (n) { var s = String(n); while (s.length < 4) s = "0" + s; return s; };
      if (type === "date") {
        return pad4(val.year) + "-" + pad2(val.month) + "-" + pad2(val.day);
      }
      if (type === "time") {
        return pad2(val.hours) + ":" + pad2(val.minutes) + ":" + pad2(val.seconds);
      }
      // datetime
      return pad4(val.year) + "-" + pad2(val.month) + "-" + pad2(val.day) + "T" +
             pad2(val.hours) + ":" + pad2(val.minutes) + ":" + pad2(val.seconds);
    }
    // Plain JS Date fallback
    if (val instanceof Date) {
      if (type === "date") return val.toISOString().slice(0, 10);
      if (type === "time") return val.toTimeString().slice(0, 8);
      return val.toISOString().slice(0, 19);
    }
  }
  return String(val);
}

/**
 * Convert a raw string value (from the UI input) to the appropriate JS type
 * for the given function.
 *
 * Returns an OutSystems DateTime wrapper when the constructor is available,
 * falling back to a plain JS Date otherwise.
 */
function _builtinConvertValue(rawValue, type) {
  var DT = _getDateTimeClass();

  if (type === "date") {
    // "2020-01-15" → DateTime(year, month, day)
    var parts = rawValue.split("-");
    if (DT) return new DT(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10));
    return new Date(rawValue + "T00:00:00.000Z");
  }
  if (type === "datetime") {
    // "2020-01-15T10:30:00" → DateTime(y, m, d, h, min, s)
    var dtParts = rawValue.replace("T", "-").replace(/:/g, "-").split("-");
    if (DT) return new DT(
      parseInt(dtParts[0], 10), parseInt(dtParts[1], 10), parseInt(dtParts[2], 10),
      parseInt(dtParts[3], 10), parseInt(dtParts[4], 10), parseInt(dtParts[5] || 0, 10)
    );
    var s = rawValue.includes("Z") || rawValue.includes("+") ? rawValue : rawValue + "Z";
    return new Date(s);
  }
  if (type === "time") {
    // "10:30:00" → DateTime(1900, 1, 1, h, min, s)
    var tp = rawValue.split(":");
    if (DT) return new DT(1900, 1, 1, parseInt(tp[0], 10), parseInt(tp[1], 10), parseInt(tp[2] || 0, 10));
    return new Date("1900-01-01T" + rawValue + "Z");
  }
  // text
  return rawValue;
}

/**
 * Force re-render all view instances (screen + blocks) so that expressions
 * referencing built-in functions re-evaluate with the new values.
 *
 * OutSystems wraps widget-property expressions (e.g. Enabled, Visible) in
 * model.getCachedValue() which memoises results across renders.  We must
 * clear the cache so the next render re-evaluates with the updated function.
 */
function _rerenderAllViews() {
  try {
    var all = _findAllViewInstances();
    for (var i = 0; i < all.length; i++) {
      var vi = all[i].viewInstance;
      if (vi.model && vi.model.cachedValues) {
        vi.model.cachedValues = {};
      }
      _flushAndRerender(vi.model, vi);
    }
  } catch (_) { /* best-effort */ }
}

/* ------------------------------------------------------------------ */
/*  Public functions (injected into MAIN world)                        */
/* ------------------------------------------------------------------ */

/**
 * Get the current value and override status of each environment function.
 */
function _osBuiltinFunctionsGet() {
  try {
    var bf = _builtinGetBF();
    var result = [];
    for (var i = 0; i < _builtinFuncMeta.length; i++) {
      var meta = _builtinFuncMeta[i];
      var fn = bf[meta.key];
      var isOverridden = !!window.__osBuiltinOriginals[meta.key];
      var currentValue = "";
      try {
        currentValue = _builtinFormatValue(fn(), meta.type);
      } catch (e) { /* ignore */ }
      result.push({
        key: meta.key,
        displayName: meta.displayName,
        type: meta.type,
        currentValue: currentValue,
        isOverridden: isOverridden,
      });
    }
    return { ok: true, functions: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Override one or more built-in functions.
 * @param {Object} overrides — map of { funcKey: rawStringValue }
 */
function _osBuiltinFunctionsOverride(overrides) {
  try {
    var bf = _builtinGetBF();
    var keys = Object.keys(overrides);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var rawValue = overrides[key];

      // Find meta for type conversion
      var meta = null;
      for (var j = 0; j < _builtinFuncMeta.length; j++) {
        if (_builtinFuncMeta[j].key === key) { meta = _builtinFuncMeta[j]; break; }
      }
      if (!meta) continue;

      // Save original (only once)
      if (!window.__osBuiltinOriginals[key]) {
        window.__osBuiltinOriginals[key] = bf[key];
      }

      var converted = _builtinConvertValue(rawValue, meta.type);
      bf[key] = (function (v) { return function () { return v; }; })(converted);
    }
    _rerenderAllViews();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Restore a built-in function to its original.
 * @param {string|null} name — function key, or null to restore all
 */
function _osBuiltinFunctionRestore(name) {
  try {
    var bf = _builtinGetBF();
    if (name) {
      if (window.__osBuiltinOriginals[name]) {
        bf[name] = window.__osBuiltinOriginals[name];
        delete window.__osBuiltinOriginals[name];
      }
    } else {
      var keys = Object.keys(window.__osBuiltinOriginals);
      for (var i = 0; i < keys.length; i++) {
        bf[keys[i]] = window.__osBuiltinOriginals[keys[i]];
      }
      window.__osBuiltinOriginals = {};
    }
    _rerenderAllViews();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
