/**
 * pageScript/helpers.js — Shared helpers for all page-script modules.
 *
 * Injected FIRST into the page's MAIN world. Provides:
 *   - List abstraction (_isList, _listCount, _listGet)
 *   - Record metadata (_getRecordFieldTypes, _getDataTypeName)
 *   - Introspection (_introspectValue)
 *   - Path navigation (_navigateToPath)
 *   - List operations (_appendToList, _deleteFromList)
 *   - Value coercion (_coerceValue, _coerceNumericValue, _coerceDateValue)
 *   - Serialization (_safeSerialize)
 *   - Type detection (_detectOsType)
 *   - UI trigger (_flushAndRerender)
 */

/* ------------------------------------------------------------------ */
/*  List abstraction — support both old and new OS runtime APIs        */
/* ------------------------------------------------------------------ */

/** Detect if a value is an OutSystems reactive list. */
function _isList(value) {
  if (!value || typeof value !== "object") return false;
  // New API: .count() function + .get() function
  if (typeof value.count === "function" && typeof value.get === "function") return true;
  // Legacy API: numeric .length + .getItem() function
  if (typeof value.length === "number" && typeof value.getItem === "function") return true;
  return false;
}

/** Get the item count from a list (supports both APIs). */
function _listCount(list) {
  if (typeof list.count === "function") return list.count();
  return list.length;
}

/** Get an item by index from a list (supports both APIs). */
function _listGet(list, index) {
  if (typeof list.get === "function") return list.get(index);
  return list.getItem(index);
}

/* ------------------------------------------------------------------ */
/*  DataTypes Enum Mapping                                             */
/* ------------------------------------------------------------------ */

/**
 * Mapping from OutSystems DataTypes enum values to display type names.
 * Used by _getRecordFieldTypes to extract type info from record metadata.
 */
var _DATA_TYPE_NAMES = {
  0: "Integer",
  1: "Long Integer",
  2: "Decimal",
  3: "Currency",
  4: "Text",
  5: "Phone Number",
  6: "Email",
  7: "Boolean",
  8: "Date",
  9: "Date Time",
  10: "Time",
  11: "Record",
  12: "RecordList",
  13: "BinaryData",
  14: "Object",
};

// ODC shifts: 14=FileRef, 15=Object
var _DATA_TYPE_NAMES_ODC = Object.assign({}, _DATA_TYPE_NAMES, {
  14: "FileRef",
  15: "Object",
});

function _getDataTypeName(enumValue) {
  var map = window.__osODC_Ctors ? _DATA_TYPE_NAMES_ODC : _DATA_TYPE_NAMES;
  return map[enumValue];
}

/* ------------------------------------------------------------------ */
/*  Record Metadata                                                    */
/* ------------------------------------------------------------------ */

/**
 * Extract field-name-to-type mappings from a record instance's constructor.
 * Uses the attributesToDeclare pattern to capture field metadata.
 *
 * @param {Object} recordInstance - An OS reactive record instance
 * @returns {Object} Map of internalName -> OS type name (e.g. { decimalAttr: "Decimal" })
 */
function _getRecordFieldTypes(recordInstance) {
  var typeMap = {};
  try {
    var ctor = recordInstance && recordInstance.constructor;
    if (!ctor) return typeMap;

    // Reactive pattern: attributesToDeclare()
    if (typeof ctor.attributesToDeclare === "function") {
      var captured = [];
      var mockThis = {
        attr: function () {
          captured.push(Array.from(arguments));
          return null;
        }
      };

      try {
        ctor.attributesToDeclare.call(mockThis);
      } catch (_) {
        // Expected: _super.attributesToDeclare.call(this) fails in mock context
        // but we've already captured the current record's attrs
      }

      for (var i = 0; i < captured.length; i++) {
        var args = captured[i];
        var internalName = args[1];
        var typeEnum = args[5];
        var typeName = _getDataTypeName(typeEnum);
        if (internalName && typeName !== undefined) {
          typeMap[internalName] = typeName;
        }
      }
    }
    // ODC pattern: Attributes static array
    else if (Array.isArray(ctor.Attributes)) {
      for (var j = 0; j < ctor.Attributes.length; j++) {
        var attr = ctor.Attributes[j];
        var attrTypeName = _getDataTypeName(attr.dataType);
        if (attr.attrName && attrTypeName !== undefined) {
          typeMap[attr.attrName] = attrTypeName;
        }
      }
    }
  } catch (_) {}
  return typeMap;
}

/* ------------------------------------------------------------------ */
/*  Introspection — recursive tree building                            */
/* ------------------------------------------------------------------ */

/**
 * Recursively introspect a reactive model value.
 * Detects lists (.count + .get or .length + .getItem), records, and primitives.
 *
 * @param {*} value - The reactive model value to introspect
 * @param {string} key - The property key name
 * @param {number} depth - Current recursion depth
 * @param {number} maxListItems - Max list items to enumerate
 * @param {string} [typeHint] - Optional OS type name from parent record metadata
 * @returns {Object} Tree node: { kind, key, ... }
 */
function _introspectValue(value, key, depth, maxListItems, typeHint) {
  const MAX_DEPTH = 10;

  // Null / undefined
  if (value === null || value === undefined) {
    return { kind: "primitive", key, value: value, type: "null" };
  }

  // Depth guard
  if (depth >= MAX_DEPTH) {
    return { kind: "primitive", key, value: "[max depth]", type: "truncated" };
  }

  // Primitive JS types
  if (typeof value !== "object" && typeof value !== "function") {
    return { kind: "primitive", key, value: value, type: typeHint || _detectOsType(value) };
  }

  // Date objects (native or OS DateTime wrapper with .getTime())
  if (value instanceof Date) {
    return { kind: "primitive", key, value: value.toISOString(), type: typeHint || "Date Time" };
  }
  // OutSystems DateTime wrapper: has .getTime() and date-part getters (year/month/day)
  if (typeof value.getTime === "function") {
    try {
      const ts = value.getTime();
      if (!isNaN(ts)) {
        return { kind: "primitive", key, value: new Date(ts).toISOString(), type: typeHint || "Date Time" };
      }
    } catch (_) { /* fall through */ }
  }

  // OutSystems numeric wrapper (Decimal, Currency, LongInteger): has own .internalValue property
  if (value.hasOwnProperty("internalValue") && typeof value.toString === "function") {
    try {
      return { kind: "primitive", key, value: _safeSerialize(value), type: typeHint || "Long Integer" };
    } catch (_) { /* fall through */ }
  }

  // OutSystems numeric wrapper objects (have .toString() and internal value)
  // Constructor name may be minified, so also check via Number() coercion
  if (typeof value === "object" && value !== null &&
      typeof value.toString === "function" && typeof value.valueOf === "function") {
    // Named constructor check (non-minified builds)
    // ODC uses "LongInteger" (no space), Reactive uses "Long Integer" (with space)
    if (value.constructor && /^(Decimal|Currency|Long ?Integer)/.test(value.constructor.name || "")) {
      var displayType = typeHint || value.constructor.name.replace("LongInteger", "Long Integer");
      try {
        return { kind: "primitive", key, value: Number(value), type: displayType };
      } catch (e) {
        return { kind: "primitive", key, value: String(value), type: displayType };
      }
    }
    // Fallback: ODC numeric wrappers with toNumber() (e.g. LongInteger with minified name)
    if (typeof value.toNumber === "function") {
      try {
        return { kind: "primitive", key, value: value.toNumber(), type: typeHint || "Long Integer" };
      } catch (_) { /* fall through */ }
    }
  }

  // Detect list-like: new API (.count() + .get()) or legacy (.length + .getItem())
  try {
    if (_isList(value)) {
      const count = _listCount(value);
      const items = [];
      const limit = Math.min(count, maxListItems);
      for (let i = 0; i < limit; i++) {
        try {
          const item = _listGet(value, i);
          items.push(_introspectValue(item, String(i), depth + 1, maxListItems));
        } catch (e) {
          items.push({ kind: "primitive", key: String(i), value: "[error: " + e.message + "]", type: "error" });
        }
      }
      return { kind: "list", key, count, items, truncated: count > limit };
    }
  } catch (e) {
    // Not a list — continue
  }

  // Detect record-like: object with enumerable properties
  try {
    const proto = Object.getPrototypeOf(value);
    if (!proto) {
      // Plain object or null prototype — serialize as-is
      return { kind: "primitive", key, value: _safeSerialize(value), type: "Object" };
    }

    // Collect properties from the prototype chain (reactive models define getters on prototypes)
    const fields = [];
    const seen = new Set();
    const SKIP = new Set(["constructor", "toString", "valueOf", "toJSON", "hasOwnProperty",
      "isPrototypeOf", "propertyIsEnumerable", "__defineGetter__", "__defineSetter__",
      "__lookupGetter__", "__lookupSetter__", "__proto__"]);

    // Try to get attribute type metadata from the record's constructor
    const attrTypes = _getRecordFieldTypes(value);

    // Walk prototype chain to find getter properties (reactive model pattern)
    let obj = proto;
    while (obj && obj !== Object.prototype) {
      const descriptors = Object.getOwnPropertyDescriptors(obj);
      for (const [propName, desc] of Object.entries(descriptors)) {
        if (seen.has(propName)) continue;
        if (SKIP.has(propName)) continue;
        if (propName.startsWith("_")) continue;
        // Only include properties with getters (reactive model pattern) or data properties
        if (desc.get || (!desc.set && desc.value !== undefined && typeof desc.value !== "function")) {
          seen.add(propName);
          try {
            const propVal = value[propName];
            fields.push(_introspectValue(propVal, propName, depth + 1, maxListItems, attrTypes[propName]));
          } catch (e) {
            fields.push({ kind: "primitive", key: propName, value: "[error: " + e.message + "]", type: "error" });
          }
        }
      }
      obj = Object.getPrototypeOf(obj);
    }

    // Also check own enumerable properties (for plain data objects)
    if (fields.length === 0) {
      const ownKeys = Object.keys(value);
      for (const propName of ownKeys) {
        if (seen.has(propName)) continue;
        if (SKIP.has(propName)) continue;
        if (propName.startsWith("_")) continue;
        seen.add(propName);
        try {
          const propVal = value[propName];
          fields.push(_introspectValue(propVal, propName, depth + 1, maxListItems, attrTypes[propName]));
        } catch (e) {
          fields.push({ kind: "primitive", key: propName, value: "[error: " + e.message + "]", type: "error" });
        }
      }
    }

    // ImmutableRecord without getters: data stored in record._, accessed via .get()
    if (fields.length === 0 && value._ && typeof value._ === "object" && typeof value.get === "function") {
      const internalKeys = Object.keys(value._);
      for (const propName of internalKeys) {
        if (seen.has(propName)) continue;
        if (SKIP.has(propName)) continue;
        seen.add(propName);
        try {
          const propVal = value.get(propName);
          fields.push(_introspectValue(propVal, propName, depth + 1, maxListItems, attrTypes[propName]));
        } catch (e) {
          fields.push({ kind: "primitive", key: propName, value: "[error: " + e.message + "]", type: "error" });
        }
      }
    }

    if (fields.length > 0) {
      return { kind: "record", key, fields };
    }

    // Fallback: try to serialize
    return { kind: "primitive", key, value: _safeSerialize(value), type: "Object" };
  } catch (e) {
    return { kind: "primitive", key, value: "[error: " + e.message + "]", type: "error" };
  }
}

/* ------------------------------------------------------------------ */
/*  Path Navigation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Navigate a value along a path of property/index steps.
 *
 * @param {*} startValue - The root value to navigate from
 * @param {Array} path - Steps to walk, e.g. ["listOut", {index:0}, "nameAttr"]
 * @returns {{ target: * } | { error: string }}
 */
function _navigateToPath(startValue, path) {
  var target = startValue;
  for (var i = 0; i < path.length; i++) {
    var step = path[i];
    if (typeof step === "object" && "index" in step) {
      if (!_isList(target)) {
        return { error: "Expected list at step " + i + ", got " + typeof target };
      }
      target = _listGet(target, step.index);
    } else {
      // Property access: try record .get() first, then direct property
      if (target && typeof target.get === "function" && !_isList(target)) {
        try {
          var val = target.get(step);
          if (val !== undefined) { target = val; continue; }
        } catch (_) { /* fall through to direct access */ }
      }
      target = target[step];
    }
    if (target === undefined || target === null) {
      return { error: "Path navigation failed at step " + i + " (" + JSON.stringify(step) + ")" };
    }
  }
  return { target: target };
}

/* ------------------------------------------------------------------ */
/*  Shared List Operations                                             */
/* ------------------------------------------------------------------ */

/**
 * Return the type-appropriate default for a primitive value.
 * Used when appending to primitive lists to avoid copying a stale template value.
 */
function _primitiveDefault(sample) {
  if (typeof sample === "boolean") return false;
  if (typeof sample === "number") return 0;
  return "";
}

/**
 * Create a new default item and append it to a list.
 *
 * @param {*} list - A reactive list value
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function _appendToList(list) {
  if (!_isList(list)) {
    return { ok: false, error: "Target is not a list." };
  }

  var newItem = null;
  var listLen = _listCount(list);

  // Strategy 1: Use list.getEmptyListItem()
  if (typeof list.getEmptyListItem === "function") {
    try {
      var template = list.getEmptyListItem();
      if (template !== null && template !== undefined) {
        if (typeof template !== "object" && typeof template !== "function") {
          // Primitive template — use a type-appropriate default instead of the
          // template value itself, which may be stale (shared singleton)
          newItem = _primitiveDefault(template);
        } else if (template.constructor && template.constructor !== Object) {
          // Prefer constructor over clone — clone copies current state of the
          // (possibly shared/dirty) template, while the constructor gives fresh defaults
          newItem = new template.constructor();
        } else {
          newItem = template;
        }
      }
    } catch (_) { /* fall through */ }
  }

  // Strategy 2: Use the emptyListItem property directly
  if (newItem === null) {
    try {
      var template2 = list.emptyListItem;
      if (template2 !== null && template2 !== undefined) {
        if (typeof template2 !== "object" && typeof template2 !== "function") {
          newItem = _primitiveDefault(template2);
        } else if (template2.constructor && template2.constructor !== Object) {
          newItem = new template2.constructor();
        } else {
          newItem = template2;
        }
      }
    } catch (_) { /* fall through */ }
  }

  // Strategy 3: Use the constructor of an existing item (objects only)
  if (newItem === null && listLen > 0) {
    try {
      var sample = _listGet(list, 0);
      if (sample !== null && typeof sample === "object" &&
          sample.constructor && sample.constructor !== Object) {
        newItem = new sample.constructor();
      }
    } catch (_) { /* fall through */ }
  }

  // Strategy 4: For primitive lists, infer a default from an existing item's type
  if (newItem === null && listLen > 0) {
    try {
      var sample2 = _listGet(list, 0);
      if (sample2 === null || sample2 === undefined || typeof sample2 !== "object") {
        newItem = _primitiveDefault(sample2);
      }
    } catch (_) { /* fall through */ }
  }

  if (newItem === null) {
    return { ok: false, error: "Cannot create a new record — no item template or constructor found." };
  }

  // Append to list — probe available methods
  var appended = false;
  if (typeof list.push === "function") { list.push(newItem); appended = true; }
  else if (typeof list.append === "function") { list.append(newItem); appended = true; }
  else if (typeof list.add === "function") { list.add(newItem); appended = true; }
  else if (typeof list.insert === "function") { list.insert(newItem, listLen); appended = true; }

  if (!appended) {
    return { ok: false, error: "No append method found on the list (tried push, append, add, insert)." };
  }

  return { ok: true };
}

/**
 * Delete an item from a list by index.
 *
 * @param {*} list - A reactive list value
 * @param {number} index - Index to remove
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function _deleteFromList(list, index) {
  if (!_isList(list)) {
    return { ok: false, error: "Target is not a list." };
  }

  var listLen = _listCount(list);
  if (index < 0 || index >= listLen) {
    return { ok: false, error: "Index " + index + " out of bounds (list has " + listLen + " items)." };
  }

  var removed = false;
  if (typeof list.remove === "function") { list.remove(index); removed = true; }
  else if (typeof list.removeAt === "function") { list.removeAt(index); removed = true; }
  else if (typeof list.splice === "function") { list.splice(index, 1); removed = true; }
  else if (typeof list.deleteItem === "function") { list.deleteItem(index); removed = true; }

  if (!removed) {
    return { ok: false, error: "No delete method found on the list (tried remove, removeAt, splice, deleteItem)." };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Flush & Re-render                                                  */
/* ------------------------------------------------------------------ */

/**
 * Flush the reactive model and force a UI re-render.
 */
function _flushAndRerender(model, viewInstance) {
  if (typeof model.flush === "function") {
    model.flush();
  }
  try {
    if (typeof viewInstance.forceUpdate === "function") {
      viewInstance.forceUpdate();
    }
  } catch (_) {
    // Silently continue
  }
}

/* ------------------------------------------------------------------ */
/*  Type Detection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Detect the OutSystems basic data type from a JS value.
 * OS basic types: Text, Integer, Long Integer, Decimal, Boolean,
 *                 Date, Time, Date Time, Phone Number, Email, Currency.
 * At runtime they map to JS primitives — we infer what we can.
 */
function _detectOsType(value) {
  if (value === null || value === undefined) return "Text";
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "Integer" : "Decimal";
  }
  if (value instanceof Date) return "Date Time";
  // Duck-type Date-like objects (cross-frame Date or OutSystems date wrappers)
  if (typeof value === "object" && typeof value.getTime === "function" && !isNaN(value.getTime())) {
    return "Date Time";
  }
  if (typeof value === "string") {
    // Try to detect date / time patterns
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "Date Time";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date";
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return "Time";
    return "Text";
  }
  return "Text";
}

/**
 * Read the current value at a leaf key from a target object/record.
 * Handles both record .get() and plain property access.
 */
function _getLeafValue(target, key) {
  if (target && typeof target.get === "function" && !_isList(target)) {
    return target.get(key);
  }
  return target ? target[key] : undefined;
}

/* ------------------------------------------------------------------ */
/*  Value Coercion                                                     */
/* ------------------------------------------------------------------ */

/**
 * Cache of ODC wrapper constructors discovered from runtime values.
 * Keyed by varType string (e.g. "Long Integer", "Decimal", "Date").
 */
var _wrapperCtorCache = {};

/**
 * Resolve the ODC wrapper constructor for a given varType, either from the
 * current runtime value or from the cache. Returns null if not available.
 */
function _resolveWrapperCtor(varType, currentValue, excludeCtor) {
  if (currentValue && typeof currentValue === "object" && currentValue.constructor
      && currentValue.constructor !== excludeCtor && currentValue.constructor !== Object) {
    _wrapperCtorCache[varType] = currentValue.constructor;
    return currentValue.constructor;
  }
  return _wrapperCtorCache[varType] || null;
}

/**
 * Coerce a raw string value (from the UI) into the appropriate JS type
 * before calling the OutSystems setter.
 */
function _coerceValue(raw, varType, currentValue) {
  switch (varType) {
    case "Boolean":
      if (typeof raw === "boolean") return { value: raw };
      return { value: raw === "true" || raw === "True" || raw === "1" };
    case "Integer": {
      const parsed = parseInt(raw, 10);
      if (isNaN(parsed)) return { error: "Invalid integer: " + raw };
      return { value: parsed };
    }
    case "Long Integer":
    case "Decimal":
    case "Currency":
      return _coerceNumericValue(raw, varType, currentValue);
    case "Date":
    case "Time":
    case "Date Time":
      return _coerceDateValue(raw, varType, currentValue);
    default:
      return { value: String(raw) };
  }
}

/**
 * Convert a raw numeric string into the OS-internal representation for
 * Currency, Decimal, and Long Integer types.
 */
function _coerceNumericValue(raw, varType, currentValue) {
  // Validate it looks like a number first
  const parsed = varType === "Long Integer" ? parseInt(raw, 10) : parseFloat(raw);
  if (isNaN(parsed)) return { error: "Invalid number: " + raw };

  // Use the OS runtime converter to produce the correct wrapper type
  const OS = window.__osRuntime;
  if (OS && OS.DataConversion && OS.DataConversion.ServerDataConverter) {
    try {
      const typeEnum =
        varType === "Long Integer" ? OS.DataTypes.DataTypes.LongInteger :
          varType === "Currency" ? OS.DataTypes.DataTypes.Currency :
            OS.DataTypes.DataTypes.Decimal;

      const converted = OS.DataConversion.ServerDataConverter.from(String(raw), typeEnum);
      if (converted !== undefined && converted !== null) {
        return { value: converted };
      }
    } catch (e) { /* fall through to ODC wrapper or plain number */ }
  }

  // ODC: construct wrapper from the current value's constructor (or cached)
  var wrapCtor = _resolveWrapperCtor(varType, currentValue, Number);
  if (wrapCtor) {
    try {
      return { value: new wrapCtor(parsed) };
    } catch (e) { /* fall through to plain number */ }
  }

  return { value: parsed };
}

/**
 * Convert a raw date/time string from the HTML input into the value
 * expected by the OutSystems clientVarsService.setVariable().
 */
function _coerceDateValue(raw, varType, currentValue) {
  // --- Attempt 1: OutSystems ServerDataConverter.from() -----------------
  const OS = window.__osRuntime;
  if (OS && OS.DataConversion && OS.DataConversion.ServerDataConverter) {
    try {
      const typeEnum =
        varType === "Date" ? OS.DataTypes.DataTypes.Date :
          varType === "Time" ? OS.DataTypes.DataTypes.Time :
            OS.DataTypes.DataTypes.DateTime;

      // Build a server-format string from the HTML input value
      let serverStr;
      if (varType === "Date") {
        serverStr = raw;
      } else if (varType === "Time") {
        serverStr = raw.length === 5 ? raw + ":00" : raw;
      } else {
        serverStr = raw;
      }

      const converted = OS.DataConversion.ServerDataConverter.from(serverStr, typeEnum);
      if (converted !== undefined && converted !== null) {
        return { value: converted };
      }
    } catch (e) {
      // ServerDataConverter.from() failed — fall through to manual
    }
  }

  // --- Attempt 2: construct Date with numeric components ----------------
  var d;
  if (varType === "Date") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { error: "Invalid date: " + raw };
    d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(d.getTime())) return { error: "Invalid date: " + raw };
  } else if (varType === "Time") {
    const m = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return { error: "Invalid time: " + raw };
    d = new Date(1900, 0, 1, +m[1], +m[2], m[3] ? +m[3] : 0);
    if (isNaN(d.getTime())) return { error: "Invalid time: " + raw };
  } else {
    // Date Time
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return { error: "Invalid date/time: " + raw };
    d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
    if (isNaN(d.getTime())) return { error: "Invalid date/time: " + raw };
  }

  // ODC: wrap in DateTime constructor from the current value (or cached)
  var wrapCtor = _resolveWrapperCtor(varType, currentValue, Date);
  if (wrapCtor) {
    try {
      return { value: new wrapCtor(d) };
    } catch (e) { /* fall through to plain Date */ }
  }

  return { value: d };
}

/* ------------------------------------------------------------------ */
/*  Serialization                                                      */
/* ------------------------------------------------------------------ */

/**
 * Ensure a value is JSON-serializable for transport back to the extension.
 */
function _safeSerialize(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  // Duck-type Date-like objects (cross-frame Date or OutSystems date wrappers)
  if (typeof value === "object" && typeof value.getTime === "function") {
    try {
      const ts = value.getTime();
      if (!isNaN(ts)) return new Date(ts).toISOString();
    } catch (e) { /* fall through */ }
  }
  if (typeof value === "object" && typeof value.toISOString === "function") {
    try { return value.toISOString(); } catch (e) { /* fall through */ }
  }
  // OutSystems Decimal/Currency/LongInteger wrapper objects
  if (typeof value === "object" && value !== null) {
    try {
      const num = Number(value);
      if (!isNaN(num)) return num;
    } catch (e) { /* fall through */ }
    if (typeof value.toString === "function") {
      const str = value.toString();
      if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str);
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
