/**
 * pageScript/actionTracer.js — Client-side logic execution tracing.
 *
 * Depends on: helpers.js, fiber.js
 *
 * Wraps controller prototype methods of the current screen and all live
 * blocks so every screen action, event handler, server action, data action
 * and aggregate refresh is recorded in a timeline ring buffer on
 * window.__osTraceLog. The side panel drains it via _osTracerGetEntries,
 * which also re-ensures wrapping so newly navigated screens get traced.
 *
 * Provides:
 *   - _osTracerStart()
 *   - _osTracerGetEntries()
 *   - _osTracerSetEnabled()
 *   - _osTracerClear()
 */

var _OS_TRACE_MAX_ENTRIES = 300;
var _OS_TRACE_MAX_ARGS = 4 * 1024;

var _OS_TRACE_LIFECYCLE = {
  "onInitialize$Action": true,
  "onReady$Action": true,
  "onRender$Action": true,
  "onDestroy$Action": true,
  "onParametersChanged$Action": true,
};

/** Classify a wrappable method name; returns null when not traceable. */
function _osTraceKindOf(methodName) {
  if (methodName.charAt(0) === "_") return null;
  if (_OS_TRACE_LIFECYCLE[methodName]) return null;
  if (methodName.endsWith("$ServerAction")) return "server-action";
  if (methodName.endsWith("$DataActRefresh")) return "data-action";
  if (methodName.endsWith("$AggrRefresh")) return "aggregate";
  if (methodName.endsWith("EventHandler$Action")) return "event";
  if (methodName.endsWith("$Action")) return "screen-action";
  return null;
}

function _osTraceDisplayName(methodName, kind) {
  var base = methodName
    .replace(/EventHandler\$Action$/, "")
    .replace(/\$(Action|ServerAction|DataActRefresh|AggrRefresh)$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Serialize wrapper args, eliding the trailing callContext object. */
function _osTraceSerializeArgs(args) {
  var out = [];
  var total = 0;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    // The runtime appends a callContext object as the last argument —
    // large and noisy, so elide it.
    if (i === args.length - 1 && a && typeof a === "object" &&
        (typeof a.setTimeout === "function" || a.screen !== undefined || a.eventContext !== undefined)) {
      out.push("[callContext]");
      continue;
    }
    var serialized;
    try {
      serialized = _safeSerialize(a);
      var asJson = JSON.stringify(serialized);
      if (asJson && asJson.length + total > _OS_TRACE_MAX_ARGS) {
        serialized = "[large value omitted]";
      } else if (asJson) {
        total += asJson.length;
      }
    } catch (_) {
      serialized = "[unserializable]";
    }
    out.push(serialized);
  }
  return out;
}

function _osTracePush(entry) {
  var log = window.__osTraceLog;
  log.seq++;
  entry.seq = log.seq;
  entry.id = "tr" + log.seq;
  log.entries.push(entry);
  if (log.entries.length > _OS_TRACE_MAX_ENTRIES) log.entries.shift();
  return entry;
}

/** Wrap one controller prototype's traceable methods (idempotent). */
function _osTraceWrapProto(proto, sourceName) {
  var wrapped = 0;
  var names = Object.getOwnPropertyNames(proto);
  for (var i = 0; i < names.length; i++) {
    var m = names[i];
    var kind = _osTraceKindOf(m);
    if (!kind) continue;
    var fn = proto[m];
    if (typeof fn !== "function" || fn.__osTraced) continue;

    (function (methodName, original, kindName) {
      var replacement = function () {
        var log = window.__osTraceLog;
        var entry = null;
        if (log && log.enabled) {
          entry = _osTracePush({
            ts: new Date().toISOString(),
            source: sourceName,
            kind: kindName,
            name: _osTraceDisplayName(methodName, kindName),
            methodName: methodName,
            args: _osTraceSerializeArgs(Array.prototype.slice.call(arguments)),
            durationMs: null,
            status: "running",
            error: null,
          });
        }
        var t0 = performance.now();
        var settle = function (status, err) {
          if (!entry) return;
          entry.durationMs = Math.round(performance.now() - t0);
          entry.status = status;
          if (err) entry.error = err && err.message ? err.message : String(err);
        };
        try {
          var result = original.apply(this, arguments);
          if (result && typeof result.then === "function") {
            result.then(function () { settle("ok"); }, function (err) { settle("error", err); });
          } else {
            settle("ok");
          }
          return result;
        } catch (err) {
          settle("error", err);
          throw err;
        }
      };
      replacement.__osTraced = true;
      replacement.__osTraceOriginal = original;
      // Other page scripts sniff these methods' source code (signature and
      // getVariableGroupType parsing) — delegate toString to the original.
      try { replacement.toString = original.toString.bind(original); } catch (_) {}
      try {
        proto[methodName] = replacement;
        wrapped++;
      } catch (_) { /* non-writable — skip */ }
    })(m, fn, kind);
  }
  return wrapped;
}

/** Wrap the current screen's and all live blocks' controllers. */
function _osTraceEnsureWrapped() {
  var log = window.__osTraceLog;
  var wrapped = 0;

  var screenVi = _findCurrentScreenViewInstance();
  if (screenVi && screenVi.controller) {
    var screenName = "Screen";
    try {
      var ctorName = screenVi.controller.constructor && screenVi.controller.constructor.name;
      if (ctorName && ctorName !== "Object") screenName = ctorName.replace(/Controller$/, "") || "Screen";
    } catch (_) {}
    wrapped += _osTraceWrapProto(Object.getPrototypeOf(screenVi.controller), screenName);
  }

  try {
    var blocksResult = _osDiscoverBlocks();
    if (blocksResult.ok) {
      for (var i = 0; i < blocksResult.blocks.length; i++) {
        var b = blocksResult.blocks[i];
        var vi = _findViewInstanceByIndex(b.viewIndex);
        if (!vi || !vi.controller) continue;
        var path = b.dataBlockAttr || b.modulePath || ("Block " + b.viewIndex);
        var parts = String(path).split(".");
        wrapped += _osTraceWrapProto(Object.getPrototypeOf(vi.controller), parts[parts.length - 1]);
      }
    }
  } catch (_) { /* block discovery is best-effort */ }

  return wrapped;
}

/* ------------------------------------------------------------------ */
/*  START                                                              */
/* ------------------------------------------------------------------ */
function _osTracerStart() {
  try {
    if (!window.__osTraceLog) {
      window.__osTraceLog = { seq: 0, enabled: true, entries: [] };
    }
    window.__osTraceLog.enabled = true;
    var wrapped = _osTraceEnsureWrapped();
    return { ok: true, wrapped: wrapped };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  GET ENTRIES — drain + re-ensure wrapping                           */
/* ------------------------------------------------------------------ */
function _osTracerGetEntries(sinceSeq) {
  try {
    var log = window.__osTraceLog;
    if (!log) return { ok: true, enabled: false, entries: [], lastSeq: 0 };

    // Re-wrap on every poll: SPA navigation creates new controllers.
    if (log.enabled) {
      try { _osTraceEnsureWrapped(); } catch (_) {}
    }

    var since = sinceSeq || 0;
    var fresh = [];
    for (var i = 0; i < log.entries.length; i++) {
      if (log.entries[i].seq > since) fresh.push(log.entries[i]);
    }
    return { ok: true, enabled: log.enabled, entries: fresh, lastSeq: log.seq };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Return current state of specific entries (async settle refresh). */
function _osTracerGetByIds(ids) {
  try {
    var log = window.__osTraceLog;
    if (!log) return { ok: true, entries: [] };
    var wanted = {};
    (ids || []).forEach(function (id) { wanted[id] = true; });
    return { ok: true, entries: log.entries.filter(function (e) { return wanted[e.id]; }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  ENABLE / CLEAR                                                     */
/* ------------------------------------------------------------------ */
function _osTracerSetEnabled(on) {
  try {
    if (!window.__osTraceLog) {
      if (!on) return { ok: true, enabled: false };
      return _osTracerStart();
    }
    window.__osTraceLog.enabled = !!on;
    if (on) _osTraceEnsureWrapped();
    return { ok: true, enabled: window.__osTraceLog.enabled };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _osTracerClear() {
  try {
    if (window.__osTraceLog) window.__osTraceLog.entries = [];
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
