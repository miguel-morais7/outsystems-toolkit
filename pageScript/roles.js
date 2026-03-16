/**
 * pageScript/roles.js — Role checking for Reactive and ODC.
 *
 * Depends on: (none)
 *
 * Provides:
 *   - _osUserRolesCheck()       (Reactive)
 *   - _osOdcRolesScan()         (ODC)
 *   - _osOdcUserRolesCheck()    (ODC)
 *   - _osOdcScreenRolesScan()   (ODC — per-screen role extraction)
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
    var urls = _osOdcCollectChunkUrls();
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

/* ================================================================== */
/*  ODC — Per-screen role extraction                                   */
/* ================================================================== */

/**
 * Parse the body of a checkPermissions function to extract role info.
 *
 * @param {string} src — toString() of checkPermissions
 * @returns {string[]|null} Role names, ["Public"], ["Registered"], or null
 */
function _parseOdcCheckPermissions(src) {
  // Strip the function wrapper to get the body
  var bodyMatch = src.match(/\{([\s\S]*)\}/);
  if (!bodyMatch) return null;
  var body = bodyMatch[1].trim();

  if (!body) return ["Public"];
  if (body.includes("checkRegistered")) return ["Registered"];

  var roles = [];
  var rolePattern = /\.roles\.(\w+)/g;
  var m;
  while ((m = rolePattern.exec(body)) !== null) {
    roles.push(m[1]);
  }
  return roles.length > 0 ? roles : null;
}

/**
 * Extract checkPermissions from a chunk's ControllerFactory export.
 * ControllerFactory is an object instance with a .controllerClass property.
 *
 * @param {object} mod — ES module namespace from import()
 * @returns {string[]|null} parsed roles, or null
 */
function _extractChunkRoles(mod) {
  var exportKeys = Object.keys(mod);
  for (var ek = 0; ek < exportKeys.length; ek++) {
    var val = mod[exportKeys[ek]];
    if (!val || typeof val !== "object") continue;

    var ctrlClass;
    try { ctrlClass = val.controllerClass; } catch (_) { continue; }
    if (!ctrlClass || typeof ctrlClass !== "function") continue;

    if (typeof ctrlClass.checkPermissions !== "function") continue;

    var src;
    try { src = ctrlClass.checkPermissions.toString(); } catch (_) { continue; }
    if (src.includes("must implement")) continue;

    return _parseOdcCheckPermissions(src);
  }
  return null;
}

/**
 * Discover roles for all ODC screens by parsing the bundle's route array
 * to find each screen's chunk URL, then importing each chunk to extract
 * checkPermissions from the ControllerFactory.
 *
 * The bundle (_osbundle-*.js) contains a route array with entries like:
 *   { pathname, screenName: "Flow.Screen", lazyComponentInfo: { importer: () => import("./_oschunk-XXX.js") } }
 *
 * @returns {{ ok: true, screenRoles: Array<{screenName: string, path: string, roles: string[]}> } | { ok: false, error: string }}
 */
async function _osOdcScreenRolesScan() {
  try {
    // 1. Find the _osbundle-*.js URL
    var bundleUrl = "";
    var entries = performance.getEntriesByType("resource");
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].initiatorType === "script" && /_osbundle-/.test(entries[i].name)) {
        bundleUrl = entries[i].name;
        break;
      }
    }
    if (!bundleUrl) return { ok: true, screenRoles: [] };

    // 2. Fetch and parse the route array for screenName → chunk path
    var resp = await fetch(bundleUrl);
    var text = await resp.text();
    var routePattern = /get pathname\(\)\{return \w+\("?([^")}]*)"?\)\}[^}]*screenName:"([^"]+)"[^}]*import\("([^"]+)"\)/g;
    var routes = [];
    var seen = {};
    var m;
    while ((m = routePattern.exec(text)) !== null) {
      var key = m[2] + "|" + m[1];
      if (seen[key]) continue;
      seen[key] = true;
      routes.push({ path: m[1], screenName: m[2], chunkPath: m[3] });
    }

    if (routes.length === 0) {
      console.warn("[OS Toolkit] ODC bundle found but no screen routes matched — bundle format may have changed");
      return { ok: true, screenRoles: [] };
    }

    // 3. Resolve chunk paths to absolute URLs and import in parallel
    var base = bundleUrl.substring(0, bundleUrl.lastIndexOf("/") + 1);
    var chunkUrls = routes.map(function (r) {
      try { return new URL(r.chunkPath, base).href; } catch (_) { return null; }
    });

    var modules = await Promise.all(chunkUrls.map(function (url) {
      return url ? import(url).catch(function () { return null; }) : Promise.resolve(null);
    }));

    // 4. Extract roles from each screen's controller chunk
    var screenRoles = [];
    for (var ri = 0; ri < routes.length; ri++) {
      var mod = modules[ri];
      if (!mod) continue;
      var roles = _extractChunkRoles(mod);
      if (!roles) continue;
      screenRoles.push({
        screenName: routes[ri].screenName,
        path: routes[ri].path,
        roles: roles,
      });
    }

    return { ok: true, screenRoles: screenRoles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
