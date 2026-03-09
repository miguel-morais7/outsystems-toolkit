/**
 * pageScript/roles.js — Role checking for Reactive and ODC.
 *
 * Depends on: (none)
 *
 * Provides:
 *   - _osUserRolesCheck()       (Reactive)
 *   - _osOdcRolesScan()         (ODC)
 *   - _osOdcUserRolesCheck()    (ODC)
 */

/* ================================================================== */
/*  Reactive — User role checking                                      */
/* ================================================================== */

/**
 * Check which of the given roles the currently logged-in user has.
 * Uses the OutSystems RolesService AMD module to check each roleKey.
 *
 * @param {Array<{name: string, roleKey: string}>} roles
 * @returns {{ ok: true, userRoles: Object<string, boolean> } | { ok: false, error: string }}
 */
function _osUserRolesCheck(roles) {
  try {
    var RolesService = require("OutSystems/ClientRuntime/RolesService");
    var result = {};
    for (var i = 0; i < roles.length; i++) {
      result[roles[i].name] = RolesService.checkRole(roles[i].roleKey);
    }
    return { ok: true, userRoles: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ================================================================== */
/*  ODC — Role discovery                                               */
/* ================================================================== */

/**
 * Scan ODC chunks for module controllers with a .roles getter and
 * for objects with a hasRole method (Auth module).
 * Returns { ok, roles: [{ name, roleKey }, ...] }
 */
async function _osOdcRolesScan() {
  try {
    // Clear cached hasRole so a rescan picks up a fresh reference
    window.__osODC_hasRole = null;

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
      return { ok: true, roles: [] };
    }

    // 2. Import all chunks (cached by browser)
    var modules = await Promise.all(urls.map(function (url) {
      return import(url).catch(function () { return null; });
    }));

    var allRoles = [];
    var seenKeys = {};

    for (var m = 0; m < modules.length; m++) {
      var mod = modules[m];
      if (!mod) continue;

      var exportKeys = Object.keys(mod);
      for (var ek = 0; ek < exportKeys.length; ek++) {
        var val = mod[exportKeys[ek]];
        if (!val || typeof val !== "object") continue;

        // Look for hasRole method (Auth module) — cache it
        if (typeof val.hasRole === "function" && !window.__osODC_hasRole) {
          window.__osODC_hasRole = val.hasRole.bind(val);
        }

        // Look for .roles getter returning role definitions
        var rolesObj;
        try { rolesObj = val.roles; } catch (_) { continue; }
        if (!rolesObj || typeof rolesObj !== "object") continue;

        var roleNames = Object.keys(rolesObj);
        for (var ri = 0; ri < roleNames.length; ri++) {
          var entry = rolesObj[roleNames[ri]];
          if (!entry || typeof entry.roleKey !== "string") continue;
          if (seenKeys[entry.roleKey]) continue;
          seenKeys[entry.roleKey] = true;
          allRoles.push({ name: roleNames[ri], roleKey: entry.roleKey });
        }
      }
    }

    allRoles.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { ok: true, roles: allRoles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ================================================================== */
/*  ODC — User role checking                                           */
/* ================================================================== */

/**
 * Check which roles the current ODC user has, using the cached hasRole function.
 * @param {Array<{name: string, roleKey: string}>} roles
 */
function _osOdcUserRolesCheck(roles) {
  try {
    var hasRole = window.__osODC_hasRole;
    if (!hasRole) return { ok: false, error: "hasRole not found — Auth module not loaded" };

    var result = {};
    for (var i = 0; i < roles.length; i++) {
      try {
        result[roles[i].name] = !!hasRole({ roleKey: roles[i].roleKey });
      } catch (err) {
        console.warn("[OS ODC Roles] hasRole check failed for " + roles[i].name + ": " + err.message);
        result[roles[i].name] = false;
      }
    }
    return { ok: true, userRoles: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
