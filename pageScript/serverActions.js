/**
 * pageScript/serverActions.js — Server action discovery and invocation.
 *
 * Depends on: helpers.js, fiber.js
 *
 * Provides:
 *   - _osServerActionsGet()
 *   - _osServerActionInvoke()
 */

/* ------------------------------------------------------------------ */
/*  GET SERVER ACTIONS — discover server actions from the controller   */
/* ------------------------------------------------------------------ */
/**
 * Discovers all server actions from the current screen's controller,
 * including their input and output parameter metadata.
 *
 * @returns {Object} { ok, serverActions: [{ name, methodName, inputs, outputs }] }
 */
function _osServerActionsGet() {
  // Map raw type identifiers from source code to display names
  var SA_TYPE_MAP = {
    DateTime: "Date Time", LongInteger: "Long Integer", PhoneNumber: "Phone Number",
    Integer: "Integer", Decimal: "Decimal", Currency: "Currency", Text: "Text",
    Boolean: "Boolean", Date: "Date", Time: "Time", Record: "Record",
    RecordList: "RecordList", BinaryData: "BinaryData", Object: "Object", Email: "Email"
  };

  try {
    var viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
    }

    var ctrl = viewInstance.controller;
    if (!ctrl) {
      return { ok: false, error: "Controller not found on view instance." };
    }

    var proto = Object.getPrototypeOf(ctrl);
    var serverActions = [];
    var methodNames = Object.getOwnPropertyNames(proto);

    for (var i = 0; i < methodNames.length; i++) {
      var m = methodNames[i];
      if (!m.endsWith("$ServerAction")) continue;

      var fn = proto[m];
      if (typeof fn !== "function") continue;

      var baseName = m.replace("$ServerAction", "");
      var displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

      // Parse function body for input/output metadata
      var src = fn.toString();

      // Parse inputs from ServerDataConverter.to(paramVar, OS.DataTypes.DataTypes.TYPE)
      var inputs = [];
      var inputPattern = /(\w+)\s*:\s*OS\.DataConversion\.ServerDataConverter\.to\s*\(\s*(\w+)\s*,\s*OS\.DataTypes\.DataTypes\.(\w+)\s*\)/g;
      var inputMatch;
      while ((inputMatch = inputPattern.exec(src)) !== null) {
        inputs.push({
          name: inputMatch[1],
          paramName: inputMatch[2],
          dataType: SA_TYPE_MAP[inputMatch[3]] || inputMatch[3]
        });
      }

      // Fallback: parse function signature if no ServerDataConverter patterns found
      if (inputs.length === 0) {
        var sigMatch = src.match(/^function\s*\(([^)]*)\)/);
        var allParams = sigMatch ? sigMatch[1].split(",").map(function(p) { return p.trim(); }).filter(Boolean) : [];
        var paramNames = allParams.filter(function(p) { return p !== "callContext"; });
        for (var p = 0; p < paramNames.length; p++) {
          inputs.push({ name: paramNames[p], paramName: paramNames[p], dataType: "Text" });
        }
      }

      // Parse outputs: find the variable group type key from the function body
      var outputs = [];
      var keyMatch = src.match(/getVariableGroupType\s*\(\s*"([^"]+)"\s*\)/);
      if (keyMatch) {
        try {
          var VarType = ctrl.constructor.getVariableGroupType(keyMatch[1]);
          if (VarType && typeof VarType.attributesToDeclare === "function") {
            var attrs = VarType.attributesToDeclare();
            for (var a = 0; a < attrs.length; a++) {
              var attr = attrs[a];
              outputs.push({
                name: attr.name,
                attrName: attr.attrName,
                dataType: _DATA_TYPE_NAMES[attr.dataType] || "Text",
                mandatory: !!attr.mandatory
              });
            }
          }
        } catch (_) { /* fall through */ }
      }

      serverActions.push({
        name: displayName,
        methodName: m,
        inputs: inputs,
        outputs: outputs
      });
    }

    return { ok: true, serverActions: serverActions };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  INVOKE SERVER ACTION — trigger a server action with parameters     */
/* ------------------------------------------------------------------ */
/**
 * Invokes a server action by method name with the given parameter values.
 *
 * @param {string} methodName - The method name (e.g. "employeeCreateOrUpdate$ServerAction")
 * @param {Array} paramValues - Array of {value, dataType, isComplex, attrName} in param order
 * @returns {Object} { ok, outputs } or { ok, error }
 */
function _osServerActionInvoke(methodName, paramValues) {
  try {
    var viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
    }

    var ctrl = viewInstance.controller;
    if (!ctrl) {
      return { ok: false, error: "Controller not found." };
    }

    if (typeof ctrl[methodName] !== "function") {
      return { ok: false, error: "Server action method '" + methodName + "' not found on controller." };
    }

    // Coerce parameter values
    var coercedArgs = [];
    for (var i = 0; i < (paramValues || []).length; i++) {
      var pv = paramValues[i];
      // Check for complex type stored in temp map
      if (pv.isComplex && pv.attrName) {
        var complexKey = methodName + "." + pv.attrName;
        var complexVal = window.__osActionParams && window.__osActionParams[complexKey];
        if (complexVal !== undefined && complexVal !== null) {
          coercedArgs.push(typeof complexVal.clone === "function" ? complexVal.clone() : complexVal);
          continue;
        }
        return { ok: false, error: "Parameter '" + pv.attrName + "': complex type not initialized. Use the inspect popup to set a value first." };
      }
      var coerced = _coerceValue(pv.value, pv.dataType);
      if (coerced.error) {
        return { ok: false, error: "Parameter " + (i + 1) + ": " + coerced.error };
      }
      coercedArgs.push(coerced.value);
    }

    // Add callContext as last argument
    coercedArgs.push(ctrl.callContext());

    // Invoke the server action (always returns a Promise)
    var result = ctrl[methodName].apply(ctrl, coercedArgs);

    if (result && typeof result.then === "function") {
      return result.then(function (resultObj) {
        _flushAndRerender(viewInstance.model, viewInstance);

        // Read output values from the result object
        var outputs = _readServerActionOutputs(ctrl, methodName, resultObj);
        return { ok: true, outputs: outputs };
      }).catch(function (err) {
        return { ok: false, error: err.message || String(err) };
      });
    }

    _flushAndRerender(viewInstance.model, viewInstance);
    return { ok: true, outputs: [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Read output values from the server action result object using
 * variable group type metadata.
 */
function _readServerActionOutputs(ctrl, methodName, resultObj) {
  var outputs = [];
  if (!resultObj || typeof resultObj !== "object") return outputs;

  try {
    // Find the variable group type key from the function body
    var proto = Object.getPrototypeOf(ctrl);
    var fn = proto[methodName];
    if (typeof fn !== "function") return outputs;

    var src = fn.toString();
    var keyMatch = src.match(/getVariableGroupType\s*\(\s*"([^"]+)"\s*\)/);
    if (!keyMatch) return outputs;

    var VarType = ctrl.constructor.getVariableGroupType(keyMatch[1]);
    if (!VarType || typeof VarType.attributesToDeclare !== "function") return outputs;

    var attrs = VarType.attributesToDeclare();
    for (var i = 0; i < attrs.length; i++) {
      var attr = attrs[i];
      var dataType = _DATA_TYPE_NAMES[attr.dataType] || "Text";
      var isComplex = dataType === "Record" || dataType === "RecordList" ||
                      dataType === "Object" || dataType === "BinaryData";

      var rawVal = null;
      // Read from result object (it's an ImmutableRecord-like or plain object)
      if (resultObj && typeof resultObj.get === "function") {
        try { rawVal = resultObj.get(attr.attrName); } catch (_) {}
      }
      if (rawVal === null || rawVal === undefined) {
        rawVal = resultObj[attr.attrName];
      }
      // Also try underscore-based internal data
      if ((rawVal === null || rawVal === undefined) && resultObj._ && resultObj._[attr.attrName] !== undefined) {
        rawVal = resultObj._[attr.attrName];
      }

      var value = null;
      if (!isComplex && rawVal !== undefined && rawVal !== null) {
        value = _safeSerialize(rawVal);
      }

      outputs.push({
        name: attr.name,
        attrName: attr.attrName,
        dataType: dataType,
        value: value
      });
    }
  } catch (_) { /* return whatever we have */ }

  return outputs;
}
