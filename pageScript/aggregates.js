/**
 * pageScript/aggregates.js — Aggregate discovery and refresh.
 *
 * Depends on: helpers.js, fiber.js
 *
 * Provides:
 *   - _osAggregatesGet()
 *   - _osAggregateRefresh()
 */

/* ------------------------------------------------------------------ */
/*  GET AGGREGATES — discover aggregates + current output values       */
/* ------------------------------------------------------------------ */
/**
 * Discovers all aggregates from the current screen's controller,
 * including their output parameter metadata, current values,
 * and input variables (all non-aggregate, non-data-action screen variables).
 *
 * @returns {Object} { ok, aggregates: [{ name, refreshMethodName, varAttrName, inputs, outputs }] }
 */
function _osAggregatesGet(viewIndex) {
  try {
    var viewInstance = _findViewInstanceByIndex(viewIndex);
    if (!viewInstance) {
      return { ok: false, error: "Could not find the view instance." };
    }

    var ctrl = viewInstance.controller;
    var model = viewInstance.model;
    if (!ctrl || !model) {
      return { ok: false, error: "Controller or model not found." };
    }

    // Get dataFetchActionNames from the controller prototype
    var proto = Object.getPrototypeOf(ctrl);
    var fetchNames = proto.dataFetchActionNames || [];
    if (!Array.isArray(fetchNames)) fetchNames = [];

    // Get VariablesRecord constructor to find variable attr mappings
    var VarsRecord = model.constructor.getVariablesRecordConstructor
      ? model.constructor.getVariablesRecordConstructor()
      : null;
    var varsAttrs = VarsRecord && VarsRecord.attributesToDeclare
      ? VarsRecord.attributesToDeclare()
      : [];

    var aggregates = [];

    for (var i = 0; i < fetchNames.length; i++) {
      var fetchName = fetchNames[i];
      if (!fetchName.endsWith("$AggrRefresh")) continue;

      var baseName = fetchName.replace("$AggrRefresh", "");
      // Display name: capitalize first letter
      var displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

      // Find the matching variable in VariablesRecord
      // Convention: baseName + "Aggr" appears in the attrName
      var varAttr = null;
      for (var j = 0; j < varsAttrs.length; j++) {
        var a = varsAttrs[j];
        if (a.attrName && a.attrName.indexOf("Aggr") !== -1 &&
            a.attrName.toLowerCase().indexOf(baseName.toLowerCase()) === 0) {
          varAttr = a;
          break;
        }
      }

      if (!varAttr || !varAttr.complexType) {
        aggregates.push({
          name: displayName,
          refreshMethodName: fetchName,
          varAttrName: null,
          outputs: [],
        });
        continue;
      }

      var varAttrName = varAttr.attrName;

      // Get output fields from complexType.attributesToDeclare()
      var outputs = [];
      try {
        var AggrRec = varAttr.complexType;
        var outputAttrs = AggrRec.attributesToDeclare ? AggrRec.attributesToDeclare() : [];

        // Read current values from the live model via property accessors
        var liveRecord = null;
        try { liveRecord = model.variables[varAttrName]; } catch (e) { /* fallback below */ }
        if (!liveRecord && model.variables.data && model.variables.data._) {
          liveRecord = model.variables.data._[varAttrName];
        }

        for (var k = 0; k < outputAttrs.length; k++) {
          var oa = outputAttrs[k];
          // Skip internal dataFetchStatus attribute
          if (oa.attrName === "dataFetchStatusAttr") continue;

          var dataType = _DATA_TYPE_NAMES[oa.dataType] || "Object";
          var isComplex = dataType === "Record" || dataType === "RecordList" ||
                          dataType === "Object" || dataType === "BinaryData";

          var currentValue = null;
          if (liveRecord && !isComplex) {
            // Try property accessor first, then _[attrName]
            var rawVal;
            try { rawVal = liveRecord[oa.attrName]; } catch (e) { rawVal = undefined; }
            if (rawVal === undefined && liveRecord._) {
              rawVal = liveRecord._[oa.attrName];
            }
            if (rawVal !== undefined && rawVal !== null) {
              currentValue = _safeSerialize(rawVal);
            }
          }

          outputs.push({
            name: oa.name,
            attrName: oa.attrName,
            dataType: dataType,
            value: currentValue,
          });
        }
      } catch (e) {
        // Failed to get output metadata — return empty outputs
      }

      aggregates.push({
        name: displayName,
        refreshMethodName: fetchName,
        varAttrName: varAttrName,
        outputs: outputs,
      });
    }

    return { ok: true, aggregates: aggregates };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* ------------------------------------------------------------------ */
/*  REFRESH AGGREGATE — trigger an aggregate via the controller        */
/* ------------------------------------------------------------------ */
/**
 * Triggers an aggregate refresh by calling its refresh method directly.
 * Aggregate refresh signature: (maxRecords, startIndex, callContext)
 *
 * @param {string} refreshMethodName - e.g. "getEmployeeById$AggrRefresh"
 * @returns {Promise<Object>} { ok: true } on success
 */
function _osAggregateRefresh(refreshMethodName, viewIndex) {
  try {
    var viewInstance = _findViewInstanceByIndex(viewIndex);
    if (!viewInstance) {
      return { ok: false, error: "Could not find the view instance." };
    }

    var ctrl = viewInstance.controller;
    if (!ctrl) {
      return { ok: false, error: "Controller not found." };
    }

    // Verify the refresh method exists
    if (typeof ctrl[refreshMethodName] !== "function") {
      return { ok: false, error: "Refresh method '" + refreshMethodName + "' not found on controller." };
    }

    // Aggregate refresh takes (maxRecords, startIndex, callContext)
    // Pass undefined for maxRecords and startIndex to use defaults
    var callContext = ctrl.callContext ? ctrl.callContext() : undefined;
    var result = ctrl[refreshMethodName](undefined, undefined, callContext);

    if (result && typeof result.then === "function") {
      return result.then(function () {
        _flushAndRerender(viewInstance.model, viewInstance);
        return { ok: true };
      }).catch(function (e) {
        return { ok: false, error: e.message || String(e) };
      });
    }

    _flushAndRerender(viewInstance.model, viewInstance);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
