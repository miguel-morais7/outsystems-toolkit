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

    // Reactive modules expose getters as own properties; ODC instances on the prototype.
    var source = isReactive ? mod : Object.getPrototypeOf(mod);
    var names;
    try { names = Object.getOwnPropertyNames(source); } catch (_) { continue; }

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

/* ------------------------------------------------------------------ */
/*  CAPTURE                                                            */
/* ------------------------------------------------------------------ */
function _osSnapshotCapture() {
  try {
    var clientVars = _osSnapshotClientVars();

    var screenVars = [];
    var screenPath = "";
    try {
      var vi = _findCurrentScreenViewInstance();
      var model = vi ? vi.model : null;
      if (model && model.variables) {
        var defs = _osSnapshotScreenVarDefs(model);
        for (var i = 0; i < defs.length; i++) {
          var def = defs[i];
          var isComplex = !!_OS_SNAPSHOT_COMPLEX_TYPES[def.type];
          var value = null;
          try {
            var raw = model.variables[def.internalName];
            if (isComplex) {
              value = _introspectToPlain(_introspectValue(raw, def.internalName, 0, 100));
            } else {
              value = _safeSerialize(raw);
            }
          } catch (_) { continue; }
          screenVars.push({
            name: def.name,
            internalName: def.internalName,
            type: def.type,
            value: value,
            complex: isComplex,
          });
        }
      }
    } catch (_) { /* no current screen — client vars only */ }

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

    // --- Screen variables — direct model writes, one flush at the end ---
    var screenVars = snapshot.screenVars || [];
    if (screenVars.length > 0) {
      var vi = _findCurrentScreenViewInstance();
      var model = vi ? vi.model : null;
      if (!model || !model.variables) {
        for (var s = 0; s < screenVars.length; s++) {
          skipped.push({ name: screenVars[s].name, reason: "No current screen model found." });
        }
      } else {
        var dirty = false;
        for (var j = 0; j < screenVars.length; j++) {
          var sv = screenVars[j];
          if (sv.complex) {
            skipped.push({ name: sv.name, reason: "Complex type — restore not supported." });
            continue;
          }
          var currentVal;
          try { currentVal = model.variables[sv.internalName]; } catch (_) { currentVal = undefined; }
          if (currentVal === undefined) {
            skipped.push({ name: sv.name, reason: "Variable not found on current screen." });
            continue;
          }
          var svRaw = _osSnapshotNormalizeRaw(sv.value, sv.type);
          var coerced = _coerceValue(svRaw, sv.type, currentVal);
          if (coerced.error) {
            skipped.push({ name: sv.name, reason: coerced.error });
            continue;
          }
          try {
            model.variables[sv.internalName] = coerced.value;
            restored++;
            dirty = true;
          } catch (e) {
            skipped.push({ name: sv.name, reason: e.message });
          }
        }
        if (dirty) _flushAndRerender(model, vi);
      }
    }

    return { ok: true, restored: restored, skipped: skipped };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
