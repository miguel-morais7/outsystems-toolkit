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
// Shared between Reactive and ODC — platform dispatch in background.js
// ensures only one platform's functions are active at a time.
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

var _builtinFuncMetaOdc = _builtinFuncMeta
  .filter(function (m) { return m.key !== "getEntryEspaceName"; })
  .concat([{ key: "getAppName", type: "text", displayName: "GetAppName" }]);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

var _builtinBFCache = null;

function _builtinGetBF() {
  if (_builtinBFCache) return _builtinBFCache;
  var OS = require("OutSystems/ClientRuntime/Main");
  _builtinBFCache = OS.Internal.BuiltinFunctions;
  return _builtinBFCache;
}

/** Cached OutSystems DateTime constructor (resolved lazily). */
var _osDateTimeClass = null;

function _getDateTimeClass() {
  if (_osDateTimeClass) return _osDateTimeClass;
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
  try { var bf = _builtinGetBF(); } catch (_) { bf = null; }
  if (bf) {
    for (var j = 0; j < dateKeys.length; j++) {
      try {
        var val2 = bf[dateKeys[j]]();
        if (val2 && typeof val2 === "object" && typeof val2.year !== "undefined") {
          _osDateTimeClass = val2.constructor;
          return _osDateTimeClass;
        }
      } catch (e) { /* skip */ }
    }
  }
  // ODC fallback — use cached builtin funcs if AMD is unavailable
  if (window.__osOdcBuiltinFuncs) {
    for (var k = 0; k < dateKeys.length; k++) {
      try {
        var val3 = window.__osOdcBuiltinFuncs[dateKeys[k]]();
        if (val3 && typeof val3 === "object" && typeof val3.year !== "undefined") {
          _osDateTimeClass = val3.constructor;
          return _osDateTimeClass;
        }
      } catch (e) { /* skip */ }
    }
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
      // ODC: flush() is gated by model.modified — force it true so the
      // generation counter increments and hooks trigger a re-render.
      if (vi.model && "modified" in vi.model) {
        vi.model.modified = true;
      }
      // ODC: toImmutableData() returns model.data by reference.  When no
      // model variables changed (builtin override only), React's useState
      // sees the same reference and bails out.  Force a new reference so
      // the writeSubscription handler triggers a real state update.
      if (vi.model && vi.model.data && typeof vi.model.toImmutableData === "function") {
        vi.model.data = Object.assign(
          Object.create(Object.getPrototypeOf(vi.model.data)), vi.model.data
        );
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

/* ------------------------------------------------------------------ */
/*  ODC Date patch                                                     */
/* ------------------------------------------------------------------ */

/**
 * ODC render expressions compile builtin calls (e.g. CurrTime()) into
 * closures that reference the frozen builtins module export directly,
 * bypassing PublicApiHelper.  Since the frozen functions use `new Date()`
 * internally, we intercept the Date constructor to make them return
 * overridden values.
 *
 * The patch only affects no-arg `new Date()` / `Date()` calls (i.e.
 * "get current time").  Calls with arguments pass through to the
 * original constructor.
 *
 * Overridden date/time parts are stored in window.__osOdcDateOverrides:
 *   { year, month, day, hours, minutes, seconds }
 * Only the keys that are actively overridden are present.
 */

function _osOdcDatePatchApply() {
  var ov = window.__osOdcDateOverrides;
  if (!ov || Object.keys(ov).length === 0) {
    _osOdcDatePatchRemove();
    return;
  }

  var OrigDate = window.__osOrigDate || window.Date;
  if (!window.__osOrigDate) window.__osOrigDate = OrigDate;

  // Note: zero-arg `new PatchedDate()` returns an OrigDate instance (not a
  // PatchedDate instance) so `instanceof PatchedDate` is false.  This is fine
  // because the OS runtime only uses Date methods, never instanceof checks.
  function PatchedDate() {
    if (arguments.length === 0) {
      var d = new OrigDate();
      if ("year" in ov) d.setFullYear(ov.year, (ov.month || d.getMonth() + 1) - 1, ov.day || d.getDate());
      else if ("month" in ov || "day" in ov) d.setFullYear(d.getFullYear(), ("month" in ov ? ov.month : d.getMonth() + 1) - 1, ov.day || d.getDate());
      if ("hours" in ov || "minutes" in ov || "seconds" in ov)
        d.setHours(
          "hours" in ov ? ov.hours : d.getHours(),
          "minutes" in ov ? ov.minutes : d.getMinutes(),
          "seconds" in ov ? ov.seconds : d.getSeconds(), 0
        );
      return d;
    }
    return new (Function.prototype.bind.apply(OrigDate, [null].concat(Array.prototype.slice.call(arguments))))();
  }
  PatchedDate.prototype = OrigDate.prototype;
  PatchedDate.now = function () {
    return new PatchedDate().getTime();
  };
  PatchedDate.parse = OrigDate.parse;
  PatchedDate.UTC = OrigDate.UTC;

  window.Date = PatchedDate;
}

function _osOdcDatePatchRemove() {
  if (window.__osOrigDate) {
    window.Date = window.__osOrigDate;
    delete window.__osOrigDate;
  }
  delete window.__osOdcDateOverrides;
}

/**
 * Merge a converted override value into __osOdcDateOverrides.
 * Only date/time/datetime types contribute Date-patch overrides.
 */
function _osOdcDateOverrideSet(converted, type) {
  if (!window.__osOdcDateOverrides) window.__osOdcDateOverrides = {};
  var ov = window.__osOdcDateOverrides;
  // converted may be an OS DateTime wrapper (.year/.month/.day/.hours/…)
  // or a plain JS Date (when _getDateTimeClass() returned null).
  var isNative = converted instanceof Date;
  if (type === "date" || type === "datetime") {
    ov.year  = isNative ? converted.getFullYear()  : converted.year;
    ov.month = isNative ? converted.getMonth() + 1 : converted.month;
    ov.day   = isNative ? converted.getDate()      : converted.day;
  }
  if (type === "time" || type === "datetime") {
    ov.hours   = isNative ? converted.getHours()   : converted.hours;
    ov.minutes = isNative ? converted.getMinutes() : converted.minutes;
    ov.seconds = isNative ? converted.getSeconds() : converted.seconds;
  }
}

/**
 * Remove overridden parts from __osOdcDateOverrides when restoring a
 * single builtin.  Clears the whole object if nothing remains.
 */
function _osOdcDateOverrideRemove(type) {
  var ov = window.__osOdcDateOverrides;
  if (!ov) return;
  if (type === "date") { delete ov.year; delete ov.month; delete ov.day; }
  else if (type === "time") { delete ov.hours; delete ov.minutes; delete ov.seconds; }
  else if (type === "datetime") { delete ov.year; delete ov.month; delete ov.day; delete ov.hours; delete ov.minutes; delete ov.seconds; }
  if (Object.keys(ov).length === 0) delete window.__osOdcDateOverrides;
}

/* ------------------------------------------------------------------ */
/*  ODC built-in function discovery and override                       */
/* ------------------------------------------------------------------ */

/**
 * ODC built-in functions are frozen (Object.freeze) on the chunk export,
 * so we cannot modify them directly.  Instead we intercept at the
 * PublicApiHelper prototype level:
 *
 * 1. The ODC runtime creates PublicApiHelper instances that have a
 *    `get BuiltinFunctions()` getter returning the frozen object.
 * 2. We find that prototype via the controller's publicApiHelper.
 * 3. We create a mutable clone of the frozen builtins.
 * 4. We redefine the getter to return our clone instead.
 * 5. Overriding/restoring individual functions mutates the clone.
 *
 * Cached state:
 *   window.__osOdcBuiltinFuncs   — the original frozen builtins export
 *   window.__osOdcBuiltinClone   — our mutable clone (returned by the
 *                                  patched getter)
 *   window.__osOdcPApiProto      — the PublicApiHelper prototype
 *   window.__osOdcPApiOrigDesc   — the original property descriptor
 */

/**
 * Discover the frozen builtins from ODC chunk exports.
 * Caches the result on window.__osOdcBuiltinFuncs.
 */
function _osOdcDiscoverBuiltins() {
  if (window.__osOdcBuiltinFuncs) return Promise.resolve(window.__osOdcBuiltinFuncs);

  var unique = _osOdcCollectChunkUrls();

  var promises = unique.map(function (url) {
    return import(url).then(function (mod) { return mod; }).catch(function () { return null; });
  });

  return Promise.all(promises).then(function (modules) {
    for (var j = 0; j < modules.length; j++) {
      var mod = modules[j];
      if (!mod) continue;
      var exportKeys = Object.keys(mod);
      for (var k = 0; k < exportKeys.length; k++) {
        var candidate = mod[exportKeys[k]];
        if (candidate && typeof candidate === "object" &&
            typeof candidate.currDate === "function" &&
            typeof candidate.currDateTime === "function" &&
            typeof candidate.getUserId === "function") {
          window.__osOdcBuiltinFuncs = candidate;
          return candidate;
        }
      }
    }
    return null;
  });
}

/**
 * Ensure the PublicApiHelper prototype is patched so that
 * `get BuiltinFunctions()` returns our mutable clone.
 * Safe to call multiple times — only patches once.
 */
function _osOdcEnsurePrototypePatched() {
  if (window.__osOdcBuiltinClone) return true;

  var frozenBf = window.__osOdcBuiltinFuncs;
  if (!frozenBf) return false;

  // Find PublicApiHelper prototype via the fiber tree
  var proto = _osOdcFindPublicApiProto();
  if (!proto) return false;

  var desc = Object.getOwnPropertyDescriptor(proto, "BuiltinFunctions");
  if (!desc || !desc.configurable) return false;

  // Save originals for restore
  window.__osOdcPApiProto = proto;
  window.__osOdcPApiOrigDesc = desc;

  // Create a mutable clone of all functions
  var clone = {};
  var keys = Object.keys(frozenBf);
  for (var i = 0; i < keys.length; i++) {
    clone[keys[i]] = frozenBf[keys[i]];
  }
  window.__osOdcBuiltinClone = clone;

  // Patch the getter
  Object.defineProperty(proto, "BuiltinFunctions", {
    get: function () { return window.__osOdcBuiltinClone; },
    configurable: true,
  });

  return true;
}

/**
 * Find the PublicApiHelper prototype by walking the fiber tree to
 * locate a controller with a publicApiHelper that has a
 * BuiltinFunctions getter.
 */
function _osOdcFindPublicApiProto() {
  if (window.__osOdcPApiProto) return window.__osOdcPApiProto;

  var all = _findAllViewInstances();
  for (var i = 0; i < all.length; i++) {
    var vi = all[i].viewInstance;
    var ctrl = vi.controller;
    if (!ctrl || !ctrl.publicApiHelper) continue;
    var proto = Object.getPrototypeOf(ctrl.publicApiHelper);
    if (proto && Object.getOwnPropertyDescriptor(proto, "BuiltinFunctions")) {
      return proto;
    }
  }
  return null;
}

/**
 * Get the current value and override status of each ODC built-in function.
 */
function _osOdcBuiltinFunctionsGet() {
  try {
    if (window.__osOdcBuiltinClone) {
      return _osOdcBuiltinFuncsToResult(window.__osOdcBuiltinClone);
    }

    return _osOdcDiscoverBuiltins().then(function (bf) {
      if (!bf) return { ok: true, functions: [] };
      // Try to set up the prototype patch eagerly
      _osOdcEnsurePrototypePatched();
      var source = window.__osOdcBuiltinClone || bf;
      return _osOdcBuiltinFuncsToResult(source);
    }).catch(function (e) {
      return { ok: false, error: e.message };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _osOdcBuiltinFuncsToResult(bf) {
  var result = [];
  for (var i = 0; i < _builtinFuncMetaOdc.length; i++) {
    var meta = _builtinFuncMetaOdc[i];
    var fn = bf[meta.key];
    var isOverridden = !!window.__osBuiltinOriginals[meta.key];
    var currentValue = "";
    try {
      if (typeof fn === "function") currentValue = _builtinFormatValue(fn(), meta.type);
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
}

/**
 * Override ODC built-in functions with hardcoded values.
 *
 * Uses the PublicApiHelper prototype patch: the mutable clone is updated
 * so that all screen/block JS nodes see the overridden functions via
 * `e.BuiltinFunctions.xxx()`.
 */
function _osOdcBuiltinFunctionsOverride(overrides) {
  try {
    if (!window.__osOdcBuiltinFuncs) {
      return { ok: false, error: "ODC built-in functions not discovered yet." };
    }

    if (!_osOdcEnsurePrototypePatched()) {
      return { ok: false, error: "Could not patch PublicApiHelper prototype — no live controller found." };
    }

    var clone = window.__osOdcBuiltinClone;
    var frozenBf = window.__osOdcBuiltinFuncs;
    var keys = Object.keys(overrides);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var rawValue = overrides[key];

      var meta = null;
      for (var j = 0; j < _builtinFuncMetaOdc.length; j++) {
        if (_builtinFuncMetaOdc[j].key === key) { meta = _builtinFuncMetaOdc[j]; break; }
      }
      if (!meta) continue;

      // Save original from the frozen source (only once)
      if (!window.__osBuiltinOriginals[key]) {
        window.__osBuiltinOriginals[key] = frozenBf[key];
      }

      var converted = _builtinConvertValue(rawValue, meta.type);
      clone[key] = (function (v) { return function () { return v; }; })(converted);

      // Date patch: for date/time builtins, also override the Date
      // constructor so that frozen render-expression closures see the
      // overridden values via `new Date()`.
      if (meta.type === "date" || meta.type === "time" || meta.type === "datetime") {
        _osOdcDateOverrideSet(converted, meta.type);
      }
    }

    _osOdcDatePatchApply();
    _rerenderAllViews();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Restore an ODC built-in function to its original.
 */
function _osOdcBuiltinFunctionRestore(name) {
  try {
    var clone = window.__osOdcBuiltinClone;
    if (!clone) return { ok: false, error: "ODC built-in functions not patched yet." };

    if (name) {
      if (window.__osBuiltinOriginals[name]) {
        clone[name] = window.__osBuiltinOriginals[name];
        delete window.__osBuiltinOriginals[name];
        // Remove corresponding Date-patch overrides
        var meta = null;
        for (var j = 0; j < _builtinFuncMetaOdc.length; j++) {
          if (_builtinFuncMetaOdc[j].key === name) { meta = _builtinFuncMetaOdc[j]; break; }
        }
        if (meta) _osOdcDateOverrideRemove(meta.type);
      }
    } else {
      var keys = Object.keys(window.__osBuiltinOriginals);
      for (var i = 0; i < keys.length; i++) {
        clone[keys[i]] = window.__osBuiltinOriginals[keys[i]];
      }
      window.__osBuiltinOriginals = {};
      delete window.__osOdcDateOverrides;
    }

    // If no overrides remain, restore the original getter and Date
    if (Object.keys(window.__osBuiltinOriginals).length === 0 &&
        window.__osOdcPApiProto && window.__osOdcPApiOrigDesc) {
      Object.defineProperty(window.__osOdcPApiProto, "BuiltinFunctions", window.__osOdcPApiOrigDesc);
      window.__osOdcBuiltinClone = null;
    }

    _osOdcDatePatchApply();
    _rerenderAllViews();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
