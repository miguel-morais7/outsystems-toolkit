/**
 * pageScript/dataActions.js — Data action discovery and refresh.
 *
 * Depends on: helpers.js, fiber.js
 *
 * Provides:
 *   - _osDataActionsGet()
 *   - _osDataActionRefresh()
 */

/* ------------------------------------------------------------------ */
/*  GET DATA ACTIONS — discover data actions + current output values   */
/* ------------------------------------------------------------------ */
/**
 * Discovers all data actions from the current screen's controller,
 * including their output parameter metadata and current values.
 *
 * @returns {Object} { ok, dataActions: [{ name, refreshMethodName, varAttrName, outputs }] }
 */
function _osDataActionsGet() {
  try {
    var viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
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

    var dataActions = [];

    for (var i = 0; i < fetchNames.length; i++) {
      var fetchName = fetchNames[i];
      if (!fetchName.endsWith("$DataActRefresh")) continue;

      var baseName = fetchName.replace("$DataActRefresh", "");
      // Display name: capitalize first letter
      var displayName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

      // Find the matching variable in VariablesRecord
      // Convention: baseName + "DataAct" appears in the attrName
      var varAttr = null;
      for (var j = 0; j < varsAttrs.length; j++) {
        var a = varsAttrs[j];
        if (a.attrName && a.attrName.indexOf("DataAct") !== -1 &&
            a.attrName.toLowerCase().indexOf(baseName.toLowerCase()) === 0) {
          varAttr = a;
          break;
        }
      }

      if (!varAttr || !varAttr.complexType) {
        // No metadata available — return basic info only
        dataActions.push({
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
        var DataActRec = varAttr.complexType;
        var outputAttrs = DataActRec.attributesToDeclare ? DataActRec.attributesToDeclare() : [];

        // Read current values from the live model
        var liveRecord = model.variables.data._ ? model.variables.data._[varAttrName] : null;

        for (var k = 0; k < outputAttrs.length; k++) {
          var oa = outputAttrs[k];
          // Skip internal dataFetchStatus attribute
          if (oa.attrName === "dataFetchStatusAttr") continue;

          var dataType = _DATA_TYPE_NAMES[oa.dataType] || "Object";
          var isComplex = dataType === "Record" || dataType === "RecordList" ||
                          dataType === "Object" || dataType === "BinaryData";

          var currentValue = null;
          if (liveRecord && liveRecord._) {
            var rawVal = liveRecord._[oa.attrName];
            if (!isComplex && rawVal !== undefined && rawVal !== null) {
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

      dataActions.push({
        name: displayName,
        refreshMethodName: fetchName,
        varAttrName: varAttrName,
        outputs: outputs,
      });
    }

    return { ok: true, dataActions: dataActions };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/* ------------------------------------------------------------------ */
/*  REFRESH DATA ACTION — trigger a data action via the controller    */
/* ------------------------------------------------------------------ */
/**
 * Triggers a data action refresh by calling its refresh method directly.
 *
 * @param {string} refreshMethodName - e.g. "dataAction1$DataActRefresh"
 * @returns {Promise<Object>} { ok: true } on success
 */
function _osDataActionRefresh(refreshMethodName) {
  try {
    var viewInstance = _findCurrentScreenViewInstance();
    if (!viewInstance) {
      return { ok: false, error: "Could not find the active screen's view instance." };
    }

    var ctrl = viewInstance.controller;
    if (!ctrl) {
      return { ok: false, error: "Controller not found." };
    }

    // Verify the refresh method exists
    if (typeof ctrl[refreshMethodName] !== "function") {
      return { ok: false, error: "Refresh method '" + refreshMethodName + "' not found on controller." };
    }

    // Call the refresh method directly with callContext
    var callContext = ctrl.callContext ? ctrl.callContext() : undefined;
    var result = ctrl[refreshMethodName](callContext);

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
