/**
 * pageScript/snapshots.js — Variable state capture and restore.
 *
 * Depends on: helpers.js, fiber.js, clientVars.js
 *
 * Captures the current values of all writable client variables (Reactive
 * and ODC) plus the current screen's variables, as a plain JSON snapshot.
 * Restore writes scalars back through the same setters the editing
 * features use; complex screen values (Record/RecordList) are captured
 * for export but skipped on restore.
 *
 * Provides:
 *   - _osSnapshotCapture()
 *   - _osSnapshotRestore()
 */

var _OS_SNAPSHOT_COMPLEX_TYPES = { "Record": true, "RecordList": true, "Object": true, "BinaryData": true, "FileRef": true };

/** Enumerate loaded client-variable modules: Reactive (__osCV_*) and ODC (__osODC_CV_*). */
function _osSnapshotClientVars() {
  var vars = [];

  for (var key in window) {
    var isReactive = key.indexOf("__osCV_") === 0;
    var isOdc = key.indexOf("__osODC_CV_") === 0;
    if (!isReactive && !isOdc) continue;

    var moduleName = key.replace(isReactive ? "__osCV_" : "__osODC_CV_", "");
    var mod = window[key];
    if (!mod) continue;

    // Getter/setter methods may live as own properties OR on the prototype
    // (AMD module objects vary by platform version; ODC uses class instances
    // whose prototype methods are non-enumerable) — gather names from both.
    var nameSet = {};
    try {
      Object.getOwnPropertyNames(mod).forEach(function (n) { nameSet[n] = true; });
      var proto = Object.getPrototypeOf(mod);
      if (proto && proto !== Object.prototype) {
        Object.getOwnPropertyNames(proto).forEach(function (n) { nameSet[n] = true; });
      }
    } catch (_) { continue; }
    var names = Object.keys(nameSet);

    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name.indexOf("get") !== 0 || typeof mod[name] !== "function") continue;
      var varName = name.substring(3);
      if (!varName) continue;
      // Only capture writable variables — read-only ones cannot be restored.
      if (typeof mod["set" + varName] !== "function") continue;

      var value = null;
      try { value = _safeSerialize(mod[name]()); } catch (_) { continue; }

      // Detect the exact OS type from getter source (same sniffing as the
      // scan — "Types.X" matches both OS.DataTypes.DataTypes.X and OS.Types.X),
      // falling back to value-based detection.
      var type = "Text";
      try {
        var getterSrc = mod[name].toString();
        if (getterSrc.includes("Types.DateTime")) type = "Date Time";
        else if (getterSrc.includes("Types.Date")) type = "Date";
        else if (getterSrc.includes("Types.Time")) type = "Time";
        else if (getterSrc.includes("Types.Currency")) type = "Currency";
        else if (getterSrc.includes("Types.LongInteger")) type = "Long Integer";
        else if (getterSrc.includes("Types.Decimal")) type = "Decimal";
        else if (getterSrc.includes("Types.Integer")) type = "Integer";
        else if (getterSrc.includes("Types.Boolean")) type = "Boolean";
      } catch (_) {}
      if (type === "Text") type = _detectOsType(value);

      vars.push({
        module: moduleName,
        name: varName,
        value: value,
        type: type,
        platform: isReactive ? "reactive" : "odc",
      });
    }
  }
  return vars;
}

/** Discover the current screen's variable defs from record metadata. */
function _osSnapshotScreenVarDefs(model) {
  var defs = [];
  try {
    var ctor = model.constructor.getVariablesRecordConstructor
      ? model.constructor.getVariablesRecordConstructor()
      : null;
    if (!ctor) return defs;

    var attrs = null;
    if (typeof ctor.attributesToDeclare === "function") {
      attrs = ctor.attributesToDeclare();
    } else if (Array.isArray(ctor.Attributes)) {
      attrs = ctor.Attributes;
    }
    if (!attrs) return defs;

    for (var i = 0; i < attrs.length; i++) {
      var attr = attrs[i];
      var attrName = attr.attrName || "";
      var displayName = attr.name || attrName;
      // Skip aggregate outputs, data action outputs, and internals
      if (attrName.indexOf("Aggr") !== -1) continue;
      if (attrName.indexOf("DataAct") !== -1) continue;
      if (displayName.charAt(0) === "_") continue;
      defs.push({
        name: displayName,
        internalName: attrName,
        type: _getDataTypeName(attr.dataType) || "Text",
      });
    }
  } catch (_) {}
  return defs;
}

/** Capture one view instance's variable values, tagged with a source label. */
function _osSnapshotCollectModelVars(model, source) {
  var vars = [];
  // The variables getter itself can throw on some blocks
  // ("Model does not contain variables") — treat those as empty.
  var modelVars = null;
  try { modelVars = model ? model.variables : null; } catch (_) { return vars; }
  if (!modelVars) return vars;
  var defs = _osSnapshotScreenVarDefs(model);
  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    var isComplex = !!_OS_SNAPSHOT_COMPLEX_TYPES[def.type];
    var value = null;
    try {
      var raw = modelVars[def.internalName];
      if (isComplex) {
        value = _introspectToPlain(_introspectValue(raw, def.internalName, 0, 100));
      } else {
        value = _safeSerialize(raw);
      }
    } catch (_) { continue; }
    vars.push({
      name: def.name,
      internalName: def.internalName,
      type: def.type,
      value: value,
      complex: isComplex,
      source: source,
    });
  }
  return vars;
}

/* ------------------------------------------------------------------ */
/*  CAPTURE                                                            */
/* ------------------------------------------------------------------ */
function _osSnapshotCapture() {
  try {
    var clientVars = _osSnapshotClientVars();

    // Screen + all live blocks (screens often keep their editable state
    // inside blocks, so the screen model alone would miss most of it).
    var screenVars = [];
    var screenPath = "";
    try {
      var vi = _findCurrentScreenViewInstance();
      if (vi) screenVars = _osSnapshotCollectModelVars(vi.model, "Screen");
    } catch (_) { /* no current screen — client vars only */ }
    try {
      var blocksResult = _osDiscoverBlocks();
      if (blocksResult.ok) {
        for (var b = 0; b < blocksResult.blocks.length; b++) {
          try {
            var block = blocksResult.blocks[b];
            var blockVi = _findViewInstanceByIndex(block.viewIndex);
            if (!blockVi) continue;
            var sourcePath = block.dataBlockAttr || block.modulePath;
            if (!sourcePath) continue;
            screenVars = screenVars.concat(
              _osSnapshotCollectModelVars(blockVi.model, sourcePath)
            );
          } catch (_) { /* one bad block must not abort the rest */ }
        }
      }
    } catch (_) { /* block capture is best-effort */ }

    try {
      screenPath = location.pathname.split("/").filter(Boolean).pop() || "";
    } catch (_) {}

    return {
      ok: true,
      snapshot: {
        context: {
          url: location.href,
          screenPath: screenPath,
          capturedAt: new Date().toISOString(),
        },
        clientVars: clientVars,
        screenVars: screenVars,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Convert an introspection tree to a plain JSON value (for export). */
function _introspectToPlain(node) {
  if (!node) return null;
  if (node.kind === "primitive") return node.value;
  if (node.kind === "list") {
    var arr = [];
    for (var i = 0; i < node.items.length; i++) arr.push(_introspectToPlain(node.items[i]));
    return arr;
  }
  if (node.kind === "record") {
    var obj = {};
    for (var j = 0; j < node.fields.length; j++) {
      obj[node.fields[j].key] = _introspectToPlain(node.fields[j]);
    }
    return obj;
  }
  return null;
}

/**
 * Normalize a captured value into the raw-string format the coercion
 * helpers expect. Captured Date/Time values are ISO strings (UTC) but
 * _coerceValue expects HTML-input-style local strings.
 */
function _osSnapshotNormalizeRaw(value, type) {
  if (value === null || value === undefined) return "";
  if (type === "Date" || type === "Time" || type === "Date Time") {
    var d = new Date(value);
    if (!isNaN(d.getTime())) {
      var pad = function (n) { return String(n).padStart(2, "0"); };
      var datePart = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      var timePart = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      if (type === "Date") return datePart;
      if (type === "Time") return timePart;
      return datePart + "T" + timePart;
    }
  }
  return String(value);
}

/* ------------------------------------------------------------------ */
/*  RESTORE                                                            */
/* ------------------------------------------------------------------ */
function _osSnapshotRestore(snapshot) {
  try {
    if (!snapshot) return { ok: false, error: "No snapshot provided." };

    var restored = 0;
    var skipped = [];

    // --- Client variables — through the platform-appropriate setter ---
    var clientVars = snapshot.clientVars || [];
    for (var i = 0; i < clientVars.length; i++) {
      var cv = clientVars[i];
      var raw = _osSnapshotNormalizeRaw(cv.value, cv.type);
      var result = cv.platform === "odc"
        ? _osOdcClientVarsSet(cv.module, cv.name, raw, cv.type)
        : _osClientVarsSet(cv.module, cv.name, raw, cv.type);
      if (result && result.ok) restored++;
      else skipped.push({ name: cv.module + "." + cv.name, reason: (result && result.error) || "Setter failed." });
    }

    // --- Screen/block variables — direct model writes, one flush per view ---
    var screenVars = snapshot.screenVars || [];
    if (screenVars.length > 0) {
      // Resolve each capture source ("Screen" or a block path) to a live view.
      var viewsBySource = {};
      var screenVi = _findCurrentScreenViewInstance();
      if (screenVi) viewsBySource["Screen"] = screenVi;
      try {
        var blocksResult = _osDiscoverBlocks();
        if (blocksResult.ok) {
          for (var b = 0; b < blocksResult.blocks.length; b++) {
            var block = blocksResult.blocks[b];
            var sourcePath = block.dataBlockAttr || block.modulePath;
            if (!sourcePath || viewsBySource[sourcePath]) continue;
            var blockVi = _findViewInstanceByIndex(block.viewIndex);
            if (blockVi) viewsBySource[sourcePath] = blockVi;
          }
        }
      } catch (_) {}

      var dirtyViews = [];
      for (var j = 0; j < screenVars.length; j++) {
        var sv = screenVars[j];
        var source = sv.source || "Screen";
        if (sv.complex) {
          skipped.push({ name: sv.name, reason: "Complex type — restore not supported." });
          continue;
        }
        var targetVi = viewsBySource[source];
        var model = targetVi ? targetVi.model : null;
        var modelVars = null;
        try { modelVars = model ? model.variables : null; } catch (_) { modelVars = null; }
        if (!modelVars) {
          skipped.push({ name: sv.name, reason: "'" + source + "' not found on current screen." });
          continue;
        }
        var currentVal;
        try { currentVal = modelVars[sv.internalName]; } catch (_) { currentVal = undefined; }
        if (currentVal === undefined) {
          skipped.push({ name: sv.name, reason: "Variable not found on '" + source + "'." });
          continue;
        }
        var svRaw = _osSnapshotNormalizeRaw(sv.value, sv.type);
        var coerced = _coerceValue(svRaw, sv.type, currentVal);
        if (coerced.error) {
          skipped.push({ name: sv.name, reason: coerced.error });
          continue;
        }
        try {
          modelVars[sv.internalName] = coerced.value;
          restored++;
          if (dirtyViews.indexOf(targetVi) === -1) dirtyViews.push(targetVi);
        } catch (e) {
          skipped.push({ name: sv.name, reason: e.message });
        }
      }
      for (var d = 0; d < dirtyViews.length; d++) {
        _flushAndRerender(dirtyViews[d].model, dirtyViews[d]);
      }
    }

    return { ok: true, restored: restored, skipped: skipped };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
