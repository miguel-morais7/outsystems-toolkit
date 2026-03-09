/**
 * pageScript/dataModels.js — ODC Entity & Structure discovery.
 *
 * Depends on: helpers.js (_getDataTypeName)
 *
 * Provides:
 *   - _osOdcDataModelsScan(moduleName)  (ODC)
 */

/* ================================================================== */
/*  ODC — Entity & Structure discovery                                 */
/* ================================================================== */

/**
 * Extract attributes from a record constructor using the mock this.attr()
 * technique, or falling back to the static Attributes array.
 *
 * @param {Function} ctor - Record class constructor
 * @returns {Array<{name: string, type: string}>}
 */
function _osOdcExtractModelAttributes(ctor) {
  var attrs = [];

  // Strategy 1: attributesToDeclare() with mock this.attr()
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
    }
    for (var i = 0; i < captured.length; i++) {
      var args = captured[i];
      var displayName = args[0];   // arg[0] = display name
      var typeEnum = args[5];      // arg[5] = dataType enum
      var typeName = _getDataTypeName(typeEnum);
      if (displayName) {
        attrs.push({ name: displayName, type: typeName || "Unknown" });
      }
    }
    return attrs;
  }

  // Strategy 2: static Attributes array (ODC pattern)
  if (Array.isArray(ctor.Attributes)) {
    for (var j = 0; j < ctor.Attributes.length; j++) {
      var attr = ctor.Attributes[j];
      var attrTypeName = _getDataTypeName(attr.dataType);
      attrs.push({ name: attr.attrName || "unknown", type: attrTypeName || "Unknown" });
    }
    return attrs;
  }

  return attrs;
}

/**
 * Scan ODC chunks for Entity (EN_) and Structure (ST_) record classes.
 * Discovers constructors with attributesToDeclare() or Attributes metadata,
 * extracts display names and attribute definitions.
 *
 * @param {string} [moduleName] - Module name to assign (fallback: "App")
 * @returns {Promise<{ok: boolean, dataModels?: Array}>}
 */
async function _osOdcDataModelsScan(moduleName) {
  try {
    // 1. Collect unique _oschunk-*.js URLs
    var urls = [];
    var seen = {};
    var entries = performance.getEntriesByType("resource");
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.initiatorType === "script" && /_oschunk-[^.]+\.js/.test(e.name) && !seen[e.name]) {
        seen[e.name] = true;
        urls.push(e.name);
      }
    }

    if (urls.length === 0) {
      return { ok: true, dataModels: [] };
    }

    // 2. Import all chunks (cached by browser)
    var modules = await Promise.all(urls.map(function (url) {
      return import(url).catch(function () { return null; });
    }));

    var dataModels = [];
    var seenNames = {};
    var defaultModule = moduleName || "App";

    // 3. Scan exports for EN_ / ST_ prefixed constructors
    for (var m = 0; m < modules.length; m++) {
      var mod = modules[m];
      if (!mod) continue;

      var exportKeys = Object.keys(mod);
      for (var ek = 0; ek < exportKeys.length; ek++) {
        var val = mod[exportKeys[ek]];
        if (typeof val !== "function") continue;

        // Must have attributesToDeclare or Attributes metadata
        if (typeof val.attributesToDeclare !== "function" && !Array.isArray(val.Attributes)) continue;

        // Skip anonymous internal records (RC_ prefix)
        if (val._isAnonymousRecord === true) continue;

        // Determine kind from .name (set by runtime's o() helper)
        var ctorName = val.name || "";
        var kind;
        if (ctorName.startsWith("EN_")) {
          kind = "Entity";
        } else if (ctorName.startsWith("ST_")) {
          kind = "Structure";
        } else {
          // Skip RC_ or unrecognized prefixes
          continue;
        }

        // Get display name from $runtimeName static getter, else strip prefix/suffix
        var displayName;
        try {
          displayName = val.$runtimeName;
        } catch (_) {}
        if (!displayName) {
          // Strip EN_/ST_ prefix and any trailing hash/suffix after last underscore
          displayName = ctorName.replace(/^(EN_|ST_)/, "");
        }

        // Deduplicate by display name
        if (seenNames[displayName]) continue;
        seenNames[displayName] = true;

        // Extract attributes
        var attributes;
        try { attributes = _osOdcExtractModelAttributes(val); } catch (_) { attributes = []; }

        dataModels.push({
          name: displayName,
          module: defaultModule,
          kind: kind,
          attributes: attributes
        });
      }
    }

    // 4. Sort alphabetically
    dataModels.sort(function (a, b) { return a.name.localeCompare(b.name); });

    return { ok: true, dataModels: dataModels };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
