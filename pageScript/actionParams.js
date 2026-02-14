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
