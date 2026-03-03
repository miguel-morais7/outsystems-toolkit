/**
 * pageScript/screenVars.js — Screen variable read/write operations.
 *
 * Depends on: helpers.js, fiber.js
 *
 * Provides:
 *   - _osScreenVarsGet()
 *   - _osScreenVarsSet()
 *   - _osScreenVarIntrospect()
 *   - _osScreenVarDeepSet()
 *   - _osScreenVarListAppend()
 *   - _osScreenVarListDelete()
 */

/* ------------------------------------------------------------------ */
/*  GET SCREEN VARS — read live values from the current screen         */
/* ------------------------------------------------------------------ */
/**
 * Finds the live OutSystems View component via React fiber traversal,
 * then reads all variable values from controller.model.variables.
 *
 * @param {Array} varDefs - Array of {name, internalName, type, isInput}
 * @returns {Object} { ok, variables: [{name, internalName, type, isInput, value, readOnly}] }
 */
function _osScreenVarsGet(varDefs, viewIndex) {
  try {
    const vi = _findViewInstanceByIndex(viewIndex);
    const model = vi ? vi.model : null;
    if (!model) {
      return { ok: false, error: "Could not find the view instance's model." };
    }

    // ODC auto-discovery: when no static defs provided, discover from
    // VariablesRecord.Attributes (available on ODC model constructors)
    if ((!varDefs || varDefs.length === 0) && model.constructor) {
      try {
        var varRecordCtor = model.constructor.getVariablesRecordConstructor();
        if (varRecordCtor && Array.isArray(varRecordCtor.Attributes)) {
          varDefs = varRecordCtor.Attributes.map(function(attr) {
            return {
              name: attr.name || attr.attrName,
              internalName: attr.attrName,
              type: _DATA_TYPE_NAMES[attr.dataType] || "Text",
              isInput: false,
            };
          });
        }
      } catch (_) {}
    }

    if (!varDefs || varDefs.length === 0) {
      return { ok: true, variables: [] };
    }

    const READ_ONLY_TYPES = ["RecordList", "Record", "Object", "BinaryData"];
    const variables = [];

    for (const def of varDefs) {
      const isReadOnly = READ_ONLY_TYPES.includes(def.type);
      let value = null;
      try {
        const raw = model.variables[def.internalName];
        value = isReadOnly ? ("[" + def.type + "]") : _safeSerialize(raw);
      } catch (e) {
        value = null;
      }

      variables.push({
        name: def.name,
        internalName: def.internalName,
        type: def.type,
        isInput: def.isInput,
        value: value,
        readOnly: isReadOnly,
      });
    }

    return { ok: true, variables };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  SET SCREEN VAR — write a value to a live screen variable           */
/* ------------------------------------------------------------------ */
/**
 * Sets a screen variable value on the live model and triggers re-render.
 *
 * @param {string} internalName - The internal variable name
 * @param {*} rawValue - The new value
 * @param {string} dataType - The OS data type
 * @returns {Object} { ok, newValue }
 */
function _osScreenVarsSet(internalName, rawValue, dataType, viewIndex) {
  try {
    const viewInstance = _findViewInstanceByIndex(viewIndex);
    if (!viewInstance) {
      return { ok: false, error: "Could not find the view instance." };
    }

    const model = viewInstance.model;
    if (!model || !model.variables) {
      return { ok: false, error: "Screen model not found." };
    }

    const coerced = _coerceValue(rawValue, dataType);
    if (coerced.error) return { ok: false, error: coerced.error };

    model.variables[internalName] = coerced.value;

    _flushAndRerender(model, viewInstance);

    const newValue = _safeSerialize(model.variables[internalName]);
    return { ok: true, newValue: newValue };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  INTROSPECT SCREEN VAR — deep-read complex variable structure       */
/* ------------------------------------------------------------------ */
/**
 * @param {string} internalName - The internal variable name
 * @param {number} [maxListItems=50] - Max items to read from lists
 * @returns {Object} { ok, tree }
 */
function _osScreenVarIntrospect(internalName, maxListItems, viewIndex) {
  try {
    const vi = _findViewInstanceByIndex(viewIndex);
    const model = vi ? vi.model : null;
    if (!model) {
      return { ok: false, error: "Could not find the view instance's model." };
    }

    const raw = model.variables[internalName];
    if (raw === undefined) {
      return { ok: false, error: "Variable '" + internalName + "' not found on model." };
    }

    const tree = _introspectValue(raw, internalName, 0, maxListItems || 50);
    return { ok: true, tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  DEEP SET SCREEN VAR — write to a nested path in the reactive model */
/* ------------------------------------------------------------------ */
/**
 * @param {string} internalName - Root variable internal name
 * @param {Array} path - Array of steps, e.g. ["listOut", {index:0}, "nameAttr"]
 * @param {*} rawValue - The new value
 * @param {string} dataType - OS data type for coercion
 * @returns {Object} { ok, newValue }
 */
function _osScreenVarDeepSet(internalName, path, rawValue, dataType, viewIndex) {
  try {
    const viewInstance = _findViewInstanceByIndex(viewIndex);
    if (!viewInstance) {
      return { ok: false, error: "Could not find the view instance." };
    }

    const model = viewInstance.model;
    if (!model || !model.variables) {
      return { ok: false, error: "Screen model not found." };
    }

    const rootVar = model.variables[internalName];
    if (rootVar === undefined) {
      return { ok: false, error: "Variable '" + internalName + "' not found." };
    }

    // Navigate to the parent of the leaf
    const parentPath = path.slice(0, -1);
    const nav = _navigateToPath(rootVar, parentPath);
    if (nav.error) return { ok: false, error: nav.error };

    const target = nav.target;

    // Set the leaf value through the reactive setter
    const leafKey = path[path.length - 1];
    if (typeof leafKey === "object" && "index" in leafKey) {
      // Primitive list item: set by index
      if (!_isList(target)) {
        return { ok: false, error: "Expected list at leaf but got " + typeof target };
      }
      const coerced = _coerceValue(rawValue, dataType);
      if (coerced.error) return { ok: false, error: coerced.error };

      if (typeof target.setItem === "function") {
        target.setItem(leafKey.index, coerced.value);
      } else if (typeof target.data === "object" && typeof target.data.set === "function") {
        target.data.set(leafKey.index, coerced.value);
      } else {
        return { ok: false, error: "No setItem/set method found on the list." };
      }

      _flushAndRerender(model, viewInstance);

      const newValue = _safeSerialize(_listGet(target, leafKey.index));
      return { ok: true, newValue };
    }

    const coerced = _coerceValue(rawValue, dataType);
    if (coerced.error) return { ok: false, error: coerced.error };

    // Set via record .set() method if available, otherwise direct property assignment
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

    _flushAndRerender(model, viewInstance);

    // Read back the value to confirm
    let readBack;
    if (target && typeof target.get === "function" && !_isList(target)) {
      readBack = target.get(leafKey);
    } else {
      readBack = target[leafKey];
    }
    const newValue = _safeSerialize(readBack);
    return { ok: true, newValue };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  LIST APPEND — add a new record to a reactive list                  */
/* ------------------------------------------------------------------ */
/**
 * @param {string} internalName - Root variable internal name
 * @param {Array} path - Path to the list (e.g. [] for root, ["ordersAttr"] for nested)
 * @param {number} [maxListItems=50] - Max items for re-introspection
 * @returns {Object} { ok, tree }
 */
function _osScreenVarListAppend(internalName, path, maxListItems, viewIndex) {
  try {
    const viewInstance = _findViewInstanceByIndex(viewIndex);
    if (!viewInstance) {
      return { ok: false, error: "Could not find the view instance." };
    }

    const model = viewInstance.model;
    if (!model || !model.variables) {
      return { ok: false, error: "Screen model not found." };
    }

    const rootVar = model.variables[internalName];
    if (rootVar === undefined) {
      return { ok: false, error: "Variable '" + internalName + "' not found." };
    }

    const nav = _navigateToPath(rootVar, path);
    if (nav.error) return { ok: false, error: nav.error };

    const result = _appendToList(nav.target);
    if (!result.ok) return result;

    _flushAndRerender(model, viewInstance);

    const tree = _introspectValue(model.variables[internalName], internalName, 0, maxListItems || 50);
    return { ok: true, tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  LIST DELETE — remove a record from a reactive list by index         */
/* ------------------------------------------------------------------ */
/**
 * @param {string} internalName - Root variable internal name
 * @param {Array} path - Path to the list
 * @param {number} index - Index of the item to remove
 * @param {number} [maxListItems=50] - Max items for re-introspection
 * @returns {Object} { ok, tree }
 */
function _osScreenVarListDelete(internalName, path, index, maxListItems, viewIndex) {
  try {
    const viewInstance = _findViewInstanceByIndex(viewIndex);
    if (!viewInstance) {
      return { ok: false, error: "Could not find the view instance." };
    }

    const model = viewInstance.model;
    if (!model || !model.variables) {
      return { ok: false, error: "Screen model not found." };
    }

    const rootVar = model.variables[internalName];
    if (rootVar === undefined) {
      return { ok: false, error: "Variable '" + internalName + "' not found." };
    }

    const nav = _navigateToPath(rootVar, path);
    if (nav.error) return { ok: false, error: nav.error };

    const result = _deleteFromList(nav.target, index);
    if (!result.ok) return result;

    _flushAndRerender(model, viewInstance);

    const tree = _introspectValue(model.variables[internalName], internalName, 0, maxListItems || 50);
    return { ok: true, tree };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
