/**
 * pageScript/screenActions.js — Screen action discovery and invocation.
 *
 * Depends on: helpers.js, fiber.js
 *
 * Provides:
 *   - _osScreenActionsGet()
 *   - _osScreenActionInvoke()
 *   - _createDefaultComplexParam()
 */

/* ------------------------------------------------------------------ */
/*  GET SCREEN ACTIONS — discover actions from the live controller     */
/* ------------------------------------------------------------------ */
/**
 * Discovers all screen actions from the current screen's controller,
 * including their input parameter metadata.
 *
 * @returns {Object} { ok, actions: [{ name, methodName, inputs, locals }] }
 */
function _osScreenActionsGet(viewIndex) {
  try {
    var viewInstance = _findViewInstanceByIndex(viewIndex);
    if (!viewInstance) {
      return { ok: false, error: "Could not find the view instance." };
    }

    var ctrl = viewInstance.controller;
    if (!ctrl) {
      return { ok: false, error: "Controller not found on view instance." };
    }

    var proto = Object.getPrototypeOf(ctrl);
    var LIFECYCLE = ["onInitialize", "onReady", "onRender", "onDestroy", "onParametersChanged"];
    var SKIP_SUFFIXES = ["EventHandler"];

    var actions = [];
    var methodNames = Object.getOwnPropertyNames(proto);

    for (var i = 0; i < methodNames.length; i++) {
      var m = methodNames[i];
      // Only public proxy methods (no underscore prefix, ending with $Action)
      if (m.startsWith("_") || !m.endsWith("$Action")) continue;
      // Skip lifecycle events
      var baseName = m.replace("$Action", "");
      var isLifecycle = false;
      for (var j = 0; j < LIFECYCLE.length; j++) {
        if (baseName === LIFECYCLE[j]) { isLifecycle = true; break; }
      }
      if (isLifecycle) continue;
      // Skip event handlers
      var isSkip = false;
      for (var k = 0; k < SKIP_SUFFIXES.length; k++) {
        if (baseName.endsWith(SKIP_SUFFIXES[k])) { isSkip = true; break; }
      }
      if (isSkip) continue;

      var fn = proto[m];
      if (typeof fn !== "function") continue;

      // Parse function signature to get param names (excluding callContext)
      var src = fn.toString();
      var sigMatch = src.match(/^function\s*\(([^)]*)\)/);
      var allParams = sigMatch ? sigMatch[1].split(",").map(function(p) { return p.trim(); }).filter(Boolean) : [];
      var paramNames = allParams.filter(function(p) { return p !== "callContext"; });

      // Display name: capitalize first letter
      var displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

      // Try to get detailed param type info from registerVariableGroupType
      var inputs = [];
      var locals = [];

      // Get internal function reference (underscore-prefixed implementation)
      var internalFn = proto["_" + m];
      var varGroupKey = null;
      if (typeof internalFn === "function") {
        var internalSrc = internalFn.toString();
        var keyMatch = internalSrc.match(/getVariableGroupType\s*\(\s*"([^"]+)"\s*\)/);
        if (keyMatch) varGroupKey = keyMatch[1];
      }

      // Build a set of attrNames that correspond to input params by parsing
      // the internal function body for assignments like: vars.value.ATTR = PARAM
      var inputAttrNames = new Set();
      if (typeof internalFn === "function") {
        var internalSrc2 = internalFn.toString();
        for (var pi = 0; pi < paramNames.length; pi++) {
          var assignRe = new RegExp("vars\\.value\\.(\\w+)\\s*=\\s*" + paramNames[pi] + "(?:\\.|;|\\s|\\))");
          var assignMatch = assignRe.exec(internalSrc2);
          if (assignMatch) {
            inputAttrNames.add(assignMatch[1]);
          }
        }
      }
      // Fallback: if no assignments found, use proxy param names directly
      if (inputAttrNames.size === 0) {
        for (var pi2 = 0; pi2 < paramNames.length; pi2++) {
          inputAttrNames.add(paramNames[pi2]);
        }
      }

      if (varGroupKey) {
        try {
          var VarType = ctrl.constructor.getVariableGroupType(varGroupKey);
          if (VarType && typeof VarType.attributesToDeclare === "function") {
            var attrs = VarType.attributesToDeclare();
            for (var a = 0; a < attrs.length; a++) {
              var attr = attrs[a];
              var entry = {
                name: attr.name,
                attrName: attr.attrName,
                dataType: _getDataTypeName(attr.dataType) || "Text",
                mandatory: !!attr.mandatory
              };
              if (inputAttrNames.has(attr.attrName)) {
                inputs.push(entry);
              } else {
                locals.push(entry);
              }
            }
          }
        } catch (_) { /* fall through to simple param names */ }
      }

      // Fallback: use param names without type info (all go to inputs)
      if (inputs.length === 0 && paramNames.length > 0) {
        for (var p = 0; p < paramNames.length; p++) {
          inputs.push({
            name: paramNames[p],
            attrName: paramNames[p],
            dataType: "Text",
            mandatory: false
          });
        }
      }

      actions.push({
        name: displayName,
        methodName: m,
        inputs: inputs,
        locals: locals,
        varGroupKey: varGroupKey
      });
    }

    return { ok: true, actions: actions };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  Auto-create default complex param for action invocation            */
/* ------------------------------------------------------------------ */
/**
 * Creates a default instance of a complex parameter (Record, RecordList)
 * using the action's variable group type metadata.
 *
 * @param {Object} ctrl - The controller instance
 * @param {string} methodName - The proxy method name (e.g. "action1$Action")
 * @param {string} attrName - The attribute name (e.g. "employeeInLocal")
 * @returns {*|null} A default instance, or null if creation fails
 */
function _createDefaultComplexParam(ctrl, methodName, attrName) {
  try {
    var proto = Object.getPrototypeOf(ctrl);
    var internalFn = proto["_" + methodName];
    // Fallback: server actions use the proxy method directly
    if (typeof internalFn !== "function") internalFn = proto[methodName];
    if (typeof internalFn !== "function") return null;

    var src = internalFn.toString();
    var keyMatch = src.match(/getVariableGroupType\s*\(\s*"([^"]+)"\s*\)/);
    if (!keyMatch) return null;

    var VarType = ctrl.constructor.getVariableGroupType(keyMatch[1]);
    if (!VarType || typeof VarType.attributesToDeclare !== "function") return null;

    var attrs = VarType.attributesToDeclare();
    var targetAttr = null;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].attrName === attrName) {
        targetAttr = attrs[i];
        break;
      }
    }
    if (!targetAttr) return null;

    // Strategy 1: Use defaultValue (factory function or object instance)
    if (typeof targetAttr.defaultValue === "function") {
      try {
        var val = targetAttr.defaultValue();
        if (val !== null && val !== undefined) return val;
      } catch (_) { /* fall through */ }
    } else if (targetAttr.defaultValue !== null && typeof targetAttr.defaultValue === "object") {
      try {
        if (typeof targetAttr.defaultValue.clone === "function") {
          return targetAttr.defaultValue.clone();
        }
        return targetAttr.defaultValue;
      } catch (_) { /* fall through */ }
    }

    // Strategy 2: Use complexType constructor
    if (targetAttr.complexType && typeof targetAttr.complexType === "function") {
      try { return new targetAttr.complexType(); } catch (_) { /* fall through */ }
    }

    // Strategy 3: Instantiate VarType and read the attribute
    try {
      var tempInstance = new VarType();
      if (tempInstance && typeof tempInstance.get === "function") {
        var val2 = tempInstance.get(attrName);
        if (val2 !== null && val2 !== undefined) return val2;
      } else if (tempInstance && tempInstance[attrName] !== undefined) {
        return tempInstance[attrName];
      }
    } catch (_) { /* fall through */ }

    return null;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  INVOKE SCREEN ACTION — trigger a screen action with parameters     */
/* ------------------------------------------------------------------ */
/**
 * Invokes a screen action by method name with the given parameter values.
 *
 * @param {string} methodName - The public proxy method name (e.g. "action1$Action")
 * @param {Array} paramValues - Array of {value, dataType} in param order
 * @returns {Object} { ok } or { ok, error }
 */
function _osScreenActionInvoke(methodName, paramValues, viewIndex) {
  try {
    var viewInstance = _findViewInstanceByIndex(viewIndex);
    if (!viewInstance) {
      return { ok: false, error: "Could not find the view instance." };
    }

    var ctrl = viewInstance.controller;
    if (!ctrl) {
      return { ok: false, error: "Controller not found." };
    }

    if (typeof ctrl[methodName] !== "function") {
      return { ok: false, error: "Action method '" + methodName + "' not found on controller." };
    }

    // Coerce parameter values
    var coercedArgs = [];
    for (var i = 0; i < (paramValues || []).length; i++) {
      var pv = paramValues[i];
      // Check for complex type stored in temp map
      if (pv.isComplex && pv.attrName) {
        var complexKey = methodName + "." + pv.attrName;
        var complexVal = window.__osActionParams[complexKey];
        if (complexVal !== undefined && complexVal !== null) {
          // Clone so the stored value survives runtime mutation and can be re-invoked
          coercedArgs.push(typeof complexVal.clone === "function" ? complexVal.clone() : complexVal);
          continue;
        }
        // Auto-create a default instance for uninitialized complex params
        var defaultVal = _createDefaultComplexParam(ctrl, methodName, pv.attrName);
        if (defaultVal !== null && defaultVal !== undefined) {
          coercedArgs.push(defaultVal);
          continue;
        }
        return { ok: false, error: "Parameter '" + pv.attrName + "': complex type not initialized and no default available." };
      }
      var coerced = _coerceValue(pv.value, pv.dataType);
      if (coerced.error) {
        return { ok: false, error: "Parameter " + (i + 1) + ": " + coerced.error };
      }
      coercedArgs.push(coerced.value);
    }

    // Add callContext as last argument
    coercedArgs.push(ctrl.callContext());

    // Invoke the action
    var result = ctrl[methodName].apply(ctrl, coercedArgs);

    // Handle promise results (async actions)
    if (result && typeof result.then === "function") {
      return result.then(function() {
        _flushAndRerender(viewInstance.model, viewInstance);
        return { ok: true };
      }).catch(function(err) {
        return { ok: false, error: err.message || String(err) };
      });
    }

    _flushAndRerender(viewInstance.model, viewInstance);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
