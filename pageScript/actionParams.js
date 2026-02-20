/**
 * pageScript/actionParams.js — Action parameter temporary storage and operations.
 *
 * Depends on: helpers.js, fiber.js
 *
 * Provides:
 *   - _osActionParamInit()
 *   - _osActionParamIntrospect()
 *   - _osActionParamDeepSet()
 *   - _osActionParamListAppend()
 *   - _osActionParamListDelete()
 *   - _cleanupActionParams()
 */

/* ------------------------------------------------------------------ */
/*  Temporary storage for complex action parameter values              */
/* ------------------------------------------------------------------ */
window.__osActionParams = window.__osActionParams || {};

/** Clean up all temp action params for a given method. */
function _cleanupActionParams(methodName) {
  var prefix = methodName + ".";
  var keys = Object.keys(window.__osActionParams);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(prefix) === 0) {
      delete window.__osActionParams[keys[i]];
    }
  }
}

/* ------------------------------------------------------------------ */
/*  INIT ACTION PARAM — create default complex value                   */
/* ------------------------------------------------------------------ */
/**
 * Initialize a default complex value for an action parameter.
 * Creates the value from the variable group type, stores it in temp,
 * and returns the introspected tree.
 *
 * @param {string} methodName - Action method name
 * @param {string} attrName - Parameter attribute name
 * @param {number} [maxListItems=50]
 * @returns {Object} { ok, tree }
 */
function _osActionParamInit(methodName, attrName, maxListItems) {
  try {
    var viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
    }

    var ctrl = viewInstance.controller;
    if (!ctrl) {
      return { ok: false, error: "Controller not found." };
    }

    // Find the var group key from the internal action method
    var proto = Object.getPrototypeOf(ctrl);
    var internalFn = proto["_" + methodName];
    // Fallback: server actions have no underscore-prefixed internal method;
    // the getVariableGroupType call is in the proxy method itself.
    if (typeof internalFn !== "function") internalFn = proto[methodName];
    var varGroupKey = null;
    if (typeof internalFn === "function") {
      var src = internalFn.toString();
      var keyMatch = src.match(/getVariableGroupType\s*\(\s*"([^"]+)"\s*\)/);
      if (keyMatch) varGroupKey = keyMatch[1];
    }

    if (!varGroupKey) {
      return { ok: false, error: "Cannot find variable group type for action." };
    }

    var VarType = ctrl.constructor.getVariableGroupType(varGroupKey);
    if (!VarType || typeof VarType.attributesToDeclare !== "function") {
      return { ok: false, error: "Variable group type has no attributesToDeclare." };
    }

    // Find the attribute to determine its default value
    var attrs = VarType.attributesToDeclare();
    var targetAttr = null;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].attrName === attrName) {
        targetAttr = attrs[i];
        break;
      }
    }

    if (!targetAttr && methodName.indexOf("$ServerAction") !== -1) {
      // Server action variable group types only contain OUTPUTS, not inputs.
      // For input params, find the live value by parsing calling screen actions.
      return _initServerActionInputParam(ctrl, viewInstance, methodName, attrName, maxListItems);
    }

    if (!targetAttr) {
      return { ok: false, error: "Attribute '" + attrName + "' not found in variable group." };
    }

    // If a value was already stored (from a previous edit), reuse it
    var existingKey = methodName + "." + attrName;
    if (window.__osActionParams[existingKey] !== undefined && window.__osActionParams[existingKey] !== null) {
      var tree = _introspectValue(window.__osActionParams[existingKey], attrName, 0, maxListItems || 50);
      return { ok: true, tree: tree };
    }

    // Create a default instance
    var defaultValue = null;

    // Strategy 1: Use defaultValue factory if available
    if (typeof targetAttr.defaultValue === "function") {
      try {
        defaultValue = targetAttr.defaultValue();
      } catch (_) { /* fall through */ }
    }

    // Strategy 2: Create from the attribute's type constructor
    if (defaultValue === null && targetAttr.complexType) {
      try {
        if (typeof targetAttr.complexType === "function") {
          defaultValue = new targetAttr.complexType();
        }
      } catch (_) { /* fall through */ }
    }

    // Strategy 3: For lists, try to create an empty list
    if (defaultValue === null && _DATA_TYPE_NAMES[targetAttr.dataType] === "RecordList") {
      try {
        if (window.__osRuntime && window.__osRuntime.DataStructures) {
          defaultValue = new window.__osRuntime.DataStructures.DataRecord.DataRecordList();
        }
      } catch (_) { /* fall through */ }
    }

    // Strategy 4: Instantiate the VarType itself and read the attr
    if (defaultValue === null) {
      try {
        var tempInstance = new VarType();
        if (tempInstance && typeof tempInstance.get === "function") {
          defaultValue = tempInstance.get(attrName);
        } else if (tempInstance && tempInstance[attrName] !== undefined) {
          defaultValue = tempInstance[attrName];
        }
      } catch (_) { /* fall through */ }
    }

    if (defaultValue === null || defaultValue === undefined) {
      return { ok: false, error: "Cannot create a default value for parameter '" + attrName + "'." };
    }

    // Store in temp map
    var key = methodName + "." + attrName;
    window.__osActionParams[key] = defaultValue;

    // Introspect and return tree
    var tree = _introspectValue(defaultValue, attrName, 0, maxListItems || 50);
    return { ok: true, tree: tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  INTROSPECT ACTION PARAM                                            */
/* ------------------------------------------------------------------ */
/**
 * @param {string} methodName - Action method name
 * @param {string} attrName - Parameter attribute name
 * @param {number} [maxListItems=50]
 * @returns {Object} { ok, tree }
 */
function _osActionParamIntrospect(methodName, attrName, maxListItems) {
  try {
    var key = methodName + "." + attrName;
    var stored = window.__osActionParams[key];
    if (stored === undefined || stored === null) {
      return { ok: false, error: "Action param '" + key + "' not initialized. Call init first." };
    }
    var tree = _introspectValue(stored, attrName, 0, maxListItems || 50);
    return { ok: true, tree: tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  DEEP SET ACTION PARAM                                              */
/* ------------------------------------------------------------------ */
/**
 * @param {string} methodName - Action method name
 * @param {string} attrName - Parameter attribute name
 * @param {Array} path - Path to the leaf
 * @param {*} rawValue - New value
 * @param {string} dataType - OS data type for coercion
 * @returns {Object} { ok, newValue }
 */
function _osActionParamDeepSet(methodName, attrName, path, rawValue, dataType) {
  try {
    var key = methodName + "." + attrName;
    var stored = window.__osActionParams[key];
    if (stored === undefined || stored === null) {
      return { ok: false, error: "Action param '" + key + "' not initialized." };
    }

    // Navigate to the parent of the leaf
    var parentPath = path.slice(0, -1);
    var nav = _navigateToPath(stored, parentPath);
    if (nav.error) return { ok: false, error: nav.error };

    var target = nav.target;
    var leafKey = path[path.length - 1];

    if (typeof leafKey === "object" && "index" in leafKey) {
      // Primitive list item
      if (!_isList(target)) {
        return { ok: false, error: "Expected list at leaf but got " + typeof target };
      }
      var coerced = _coerceValue(rawValue, dataType);
      if (coerced.error) return { ok: false, error: coerced.error };
      if (typeof target.set === "function") {
        target.set(leafKey.index, coerced.value);
      } else if (typeof target.data === "object" && typeof target.data.set === "function") {
        target.data.set(leafKey.index, coerced.value);
      } else {
        return { ok: false, error: "No set method found on the list." };
      }
      var newValue = _safeSerialize(_listGet(target, leafKey.index));
      return { ok: true, newValue: newValue };
    }

    var coerced = _coerceValue(rawValue, dataType);
    if (coerced.error) return { ok: false, error: coerced.error };

    if (target && typeof target.set === "function" && !_isList(target)) {
      target.set(leafKey, coerced.value);
      // Some ImmutableRecord variants are truly immutable (.set returns new instance).
      // Fall back to direct ._ mutation if .set() didn't change the value in place.
      if (target._ && target.get(leafKey) !== coerced.value) {
        target._[leafKey] = coerced.value;
      }
    } else {
      target[leafKey] = coerced.value;
    }

    var readBack;
    if (target && typeof target.get === "function" && !_isList(target)) {
      readBack = target.get(leafKey);
    } else {
      readBack = target[leafKey];
    }
    return { ok: true, newValue: _safeSerialize(readBack) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  ACTION PARAM LIST APPEND                                           */
/* ------------------------------------------------------------------ */
/**
 * @param {string} methodName - Action method name
 * @param {string} attrName - Parameter attribute name
 * @param {Array} path - Path to the list
 * @param {number} [maxListItems=50]
 * @returns {Object} { ok, tree }
 */
function _osActionParamListAppend(methodName, attrName, path, maxListItems) {
  try {
    var key = methodName + "." + attrName;
    var stored = window.__osActionParams[key];
    if (stored === undefined || stored === null) {
      return { ok: false, error: "Action param '" + key + "' not initialized." };
    }

    var nav = _navigateToPath(stored, path);
    if (nav.error) return { ok: false, error: nav.error };

    var result = _appendToList(nav.target);
    if (!result.ok) return result;

    var tree = _introspectValue(stored, attrName, 0, maxListItems || 50);
    return { ok: true, tree: tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  ACTION PARAM LIST DELETE                                           */
/* ------------------------------------------------------------------ */
/**
 * @param {string} methodName - Action method name
 * @param {string} attrName - Parameter attribute name
 * @param {Array} path - Path to the list
 * @param {number} index - Index to remove
 * @param {number} [maxListItems=50]
 * @returns {Object} { ok, tree }
 */
function _osActionParamListDelete(methodName, attrName, path, index, maxListItems) {
  try {
    var key = methodName + "." + attrName;
    var stored = window.__osActionParams[key];
    if (stored === undefined || stored === null) {
      return { ok: false, error: "Action param '" + key + "' not initialized." };
    }

    var nav = _navigateToPath(stored, path);
    if (nav.error) return { ok: false, error: nav.error };

    var result = _deleteFromList(nav.target, index);
    if (!result.ok) return result;

    var tree = _introspectValue(stored, attrName, 0, maxListItems || 50);
    return { ok: true, tree: tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  SERVER ACTION INPUT PARAM — init from live model                   */
/* ------------------------------------------------------------------ */
/**
 * Initialize a server action input parameter by finding the live value
 * from the screen's model. Server action variable group types only
 * contain output attributes, so inputs must be resolved differently:
 * parse screen action code that calls this server action to find the
 * source expression, then navigate the live model to get the value.
 *
 * @param {Object} ctrl - Controller instance
 * @param {Object} viewInstance - View instance (for model access)
 * @param {string} methodName - Server action method name
 * @param {string} attrName - Parameter name (from function signature)
 * @param {number} [maxListItems=50]
 * @returns {Object} { ok, tree } or { ok, error }
 */
function _initServerActionInputParam(ctrl, viewInstance, methodName, attrName, maxListItems) {
  // If a value was already stored (from a previous edit), reuse it
  var existingKey = methodName + "." + attrName;
  if (window.__osActionParams[existingKey] !== undefined && window.__osActionParams[existingKey] !== null) {
    var tree = _introspectValue(window.__osActionParams[existingKey], attrName, 0, maxListItems || 50);
    return { ok: true, tree: tree };
  }

  var proto = Object.getPrototypeOf(ctrl);
  var fn = proto[methodName];
  if (typeof fn !== "function") {
    return { ok: false, error: "Server action method not found." };
  }

  var src = fn.toString();

  // Find param index from function signature
  var sigMatch = src.match(/^function\s*\(([^)]*)\)/);
  if (!sigMatch) {
    return { ok: false, error: "Cannot parse server action signature." };
  }
  var sigParams = sigMatch[1].split(",").map(function(p) { return p.trim(); }).filter(Boolean);
  var paramIndex = -1;
  for (var i = 0; i < sigParams.length; i++) {
    if (sigParams[i] === attrName) {
      paramIndex = i;
      break;
    }
  }
  if (paramIndex === -1) {
    return { ok: false, error: "Parameter '" + attrName + "' not found in server action signature." };
  }

  // Search screen actions for calls to this server action
  var model = viewInstance.model;
  var protoKeys = Object.getOwnPropertyNames(proto);
  var escapedMethod = methodName.replace(/\$/g, "\\$");
  var sourceValue = null;

  for (var k = 0; k < protoKeys.length; k++) {
    var pkey = protoKeys[k];
    if (!pkey.startsWith("_") || !pkey.endsWith("$Action")) continue;
    var actionFn = proto[pkey];
    if (typeof actionFn !== "function") continue;

    var actionSrc = actionFn.toString();
    var callRe = new RegExp("controller\\." + escapedMethod + "\\s*\\(");
    if (!callRe.test(actionSrc)) continue;

    // Extract the full call arguments
    var callIdx = actionSrc.search(callRe);
    var argsStart = actionSrc.indexOf("(", callIdx) + 1;
    // Find matching closing paren
    var depth = 1;
    var pos = argsStart;
    while (pos < actionSrc.length && depth > 0) {
      if (actionSrc[pos] === "(") depth++;
      if (actionSrc[pos] === ")") depth--;
      pos++;
    }
    var argsStr = actionSrc.substring(argsStart, pos - 1);

    // Split arguments at top-level commas
    var args = [];
    depth = 0;
    var current = "";
    for (var c = 0; c < argsStr.length; c++) {
      var ch = argsStr[c];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      if (ch === ")" || ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    args.push(current.trim());

    if (paramIndex >= args.length) continue;
    var argExpr = args[paramIndex];

    // Try to evaluate the argument expression against the live model
    sourceValue = _evaluateModelExpression(model, argExpr);
    if (sourceValue !== null && sourceValue !== undefined) break;
  }

  if (sourceValue === null || sourceValue === undefined) {
    return { ok: false, error: "Cannot determine input parameter value. No screen action calling this server action was found, or the argument could not be resolved." };
  }

  // Clone the value if possible
  var cloned = null;
  if (typeof sourceValue.clone === "function") {
    cloned = sourceValue.clone();
  } else if (sourceValue && typeof sourceValue === "object") {
    cloned = sourceValue; // share reference as fallback
  } else {
    cloned = sourceValue;
  }

  // Store in temp map
  window.__osActionParams[existingKey] = cloned;

  // Introspect and return tree
  var tree = _introspectValue(cloned, attrName, 0, maxListItems || 50);
  return { ok: true, tree: tree };
}

/**
 * Evaluate a model variable expression from screen action source code.
 * Handles common OutSystems codegen patterns:
 *   model.variables.someVar
 *   model.variables.someAggr.listOut.getCurrent(ctx).someAttr
 *
 * @param {Object} model - The screen's model object
 * @param {string} expr - The argument expression from source code
 * @returns {*|null} The resolved value, or null if not resolvable
 */
function _evaluateModelExpression(model, expr) {
  expr = expr.trim();
  if (!expr.startsWith("model.variables.")) return null;

  var rest = expr.substring("model.variables.".length);

  // Tokenize: split by "." but keep method calls (with parens) as single tokens
  var tokens = [];
  var buf = "";
  var depth = 0;
  for (var i = 0; i < rest.length; i++) {
    var ch = rest[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "." && depth === 0) {
      tokens.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);

  var current = model.variables;
  for (var t = 0; t < tokens.length; t++) {
    if (current == null) return null;
    var token = tokens[t];

    // Handle method calls like getCurrent(...) or count()
    var methodMatch = token.match(/^(\w+)\(.*\)$/);
    if (methodMatch) {
      var mName = methodMatch[1];
      if (mName === "getCurrent" && _isList(current)) {
        // getCurrent returns the current iteration item; use index 0,
        // falling back to emptyListItem for empty lists (default record)
        var item = null;
        if (_listCount(current) > 0) {
          item = _listGet(current, 0);
        }
        current = (item !== undefined && item !== null) ? item : current.emptyListItem;
        continue;
      }
      if (typeof current[mName] === "function") {
        try { current = current[mName](); } catch (_) { return null; }
        continue;
      }
      return null;
    }

    // First level: prefer prototype getter on variables (returns proper model
    // Records that ServerDataConverter.to accepts) over data._ (which returns
    // ImmutableRecords that ServerDataConverter.to rejects).
    if (t === 0) {
      if (current[token] !== undefined) {
        current = current[token];
        continue;
      }
      if (current.data && current.data._ && current.data._[token] !== undefined) {
        current = current.data._[token];
        continue;
      }
      return null;
    }

    // Try direct property access first — proper model Records expose fields
    // as getter properties that return other proper Records, while .get()
    // on ImmutableRecords returns raw internal objects that are not
    // compatible with ServerDataConverter.to().
    if (current[token] !== undefined) {
      current = current[token];
      continue;
    }

    // Try .get() for ImmutableRecord fields (fallback)
    if (typeof current.get === "function" && !_isList(current)) {
      try {
        var val = current.get(token);
        if (val !== undefined) { current = val; continue; }
      } catch (_) { /* fall through */ }
    }

    // Try internal _ data
    if (current._ && current._[token] !== undefined) {
      current = current._[token];
      continue;
    }

    return null;
  }

  return current;
}
