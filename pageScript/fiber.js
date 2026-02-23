/**
 * pageScript/fiber.js — React Fiber traversal for finding view instances.
 *
 * Depends on: (none — standalone)
 *
 * Provides:
 *   - _findCurrentScreenModel()
 *   - _findCurrentScreenViewInstance()
 *   - _findAllViewInstances()
 *   - _findViewInstanceByIndex(viewIndex)
 *   - _discoverBlocks()
 *   - _getReactFiber()
 *   - _hasModelVariables()
 *   - _walkFiberForView()
 *   - _dfsForView()
 *   - _dfsCollectAllViews()
 *   - _findViewInstanceByDOMSearch()
 */

/**
 * Find the current screen's model object by traversing the React fiber tree.
 */
function _findCurrentScreenModel() {
  const viewInstance = _findCurrentScreenViewInstance();
  if (!viewInstance) return null;
  return viewInstance.model || null;
}

/**
 * Find the current screen's View component instance (React class component)
 * by traversing the React fiber tree from the root DOM element.
 */
function _findCurrentScreenViewInstance() {
  // OutSystems renders into a specific root element
  const root = document.querySelector("[data-container]") ||
    document.getElementById("os-root") ||
    document.querySelector(".screen") ||
    document.body;

  // Try to find React fiber from any DOM element
  const fiber = _getReactFiber(root);
  if (!fiber) {
    // Fallback: try to find any element with a fiber
    return _findViewInstanceByDOMSearch();
  }

  // Walk up the fiber tree to find the BaseWebScreen instance
  return _walkFiberForView(fiber);
}

/**
 * Safely check whether a fiber stateNode is a View instance with
 * controller / model / variables.  The model.variables getter can throw
 * "Model does not contain variables" on some view instances, so we
 * guard with try/catch.
 */
function _hasModelVariables(instance) {
  try {
    return !!(instance && instance.controller && instance.model && instance.model.variables);
  } catch (_) {
    return false;
  }
}

/**
 * Get the React fiber node from a DOM element.
 */
function _getReactFiber(element) {
  if (!element) return null;
  // React 16+ uses __reactFiber$ or __reactInternalInstance$
  const keys = Object.keys(element);
  for (const key of keys) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return element[key];
    }
  }
  return null;
}

/**
 * Walk the fiber tree (up and down) to find a View component instance
 * that has a `controller` with a `model` containing `variables`.
 */
function _walkFiberForView(startFiber) {
  // First walk up to the root
  let root = startFiber;
  while (root.return) {
    root = root.return;
  }

  // Then DFS down through the tree
  return _dfsForView(root);
}

/**
 * DFS through the fiber tree looking for the screen View component.
 */
function _dfsForView(fiber) {
  if (!fiber) return null;

  // Check if this fiber's stateNode is the View we're looking for
  if (_hasModelVariables(fiber.stateNode)) {
    return fiber.stateNode;
  }

  // Check child
  let result = _dfsForView(fiber.child);
  if (result) return result;

  // Check siblings
  let sibling = fiber.sibling;
  while (sibling) {
    result = _dfsForView(sibling);
    if (result) return result;
    sibling = sibling.sibling;
  }

  return null;
}

/**
 * Find ALL view instances (screen + blocks) by DFS through the fiber tree.
 * Returns array of { viewInstance, viewIndex, depth }.
 * Index 0 is the screen (first found); 1+ are blocks.
 */
function _findAllViewInstances() {
  var root = document.querySelector("[data-container]") ||
    document.getElementById("os-root") ||
    document.querySelector(".screen") ||
    document.body;

  var fiber = _getReactFiber(root);
  if (!fiber) {
    // Fallback: DOM search variant
    return _findAllViewInstancesByDOMSearch();
  }

  // Walk up to root fiber
  var rootFiber = fiber;
  while (rootFiber.return) rootFiber = rootFiber.return;

  var results = [];
  _dfsCollectAllViews(rootFiber, results, 0);
  return results;
}

/**
 * DFS that collects ALL view instances (doesn't stop at first match).
 */
function _dfsCollectAllViews(fiber, results, depth) {
  if (!fiber) return;

  if (_hasModelVariables(fiber.stateNode)) {
    results.push({
      viewInstance: fiber.stateNode,
      viewIndex: results.length,
      depth: depth,
    });
  }

  _dfsCollectAllViews(fiber.child, results, depth + 1);
  var sibling = fiber.sibling;
  while (sibling) {
    _dfsCollectAllViews(sibling, results, depth + 1);
    sibling = sibling.sibling;
  }
}

/**
 * Fallback: DOM search that collects ALL view instances.
 */
function _findAllViewInstancesByDOMSearch() {
  var candidates = document.querySelectorAll("div[data-block], div[class*='screen'], #renderContainerId, body > div");
  var seen = new Set();
  var results = [];

  for (var i = 0; i < candidates.length; i++) {
    var fiber = _getReactFiber(candidates[i]);
    if (!fiber) continue;
    var rootFiber = fiber;
    while (rootFiber.return) rootFiber = rootFiber.return;
    if (seen.has(rootFiber)) continue;
    seen.add(rootFiber);
    _dfsCollectAllViews(rootFiber, results, 0);
  }

  // Last resort: body children
  if (results.length === 0) {
    for (var j = 0; j < document.body.children.length; j++) {
      var f = _getReactFiber(document.body.children[j]);
      if (!f) continue;
      var r = f;
      while (r.return) r = r.return;
      if (seen.has(r)) continue;
      seen.add(r);
      _dfsCollectAllViews(r, results, 0);
    }
  }

  return results;
}

/**
 * Find a specific view instance by its DFS index.
 * When viewIndex is undefined/null/0, falls back to _findCurrentScreenViewInstance()
 * for backward compatibility.
 */
function _findViewInstanceByIndex(viewIndex) {
  if (viewIndex === undefined || viewIndex === null || viewIndex === 0) {
    return _findCurrentScreenViewInstance();
  }
  var all = _findAllViewInstances();
  for (var i = 0; i < all.length; i++) {
    if (all[i].viewIndex === viewIndex) return all[i].viewInstance;
  }
  return null;
}

/**
 * Discover block view instances that belong to the current screen's content.
 * Returns serializable metadata (no viewInstance references — they can't cross
 * the Chrome messaging boundary).
 *
 * Scopes to the screen's <main> content area to exclude layout blocks
 * (header, menu, footer).  Falls back to all non-screen view instances
 * when the <main> element is not found.
 */
function _discoverBlocks() {
  try {
    var all = _findAllViewInstances();
    if (all.length <= 1) {
      return { ok: true, blocks: [] };
    }

    // Build a Set of view instances that live inside the screen content area
    var contentViews = _findContentAreaViewInstances();

    var blocks = [];
    for (var i = 1; i < all.length; i++) {
      var entry = all[i];
      // If we found content-area views, filter to only those
      if (contentViews && !contentViews.has(entry.viewInstance)) continue;

      var ctrl = entry.viewInstance.controller;
      var proto = Object.getPrototypeOf(ctrl);
      var modulePath = _extractModulePath(proto);

      blocks.push({
        viewIndex: entry.viewIndex,
        depth: entry.depth,
        modulePath: modulePath,
      });
    }

    return { ok: true, blocks: blocks };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Find all view instances whose DOM block element ([data-block]) is inside
 * the screen's <main> content area.  Returns a Set of viewInstance objects,
 * or null when the content area cannot be located (caller should fall back
 * to showing all blocks).
 */
function _findContentAreaViewInstances() {
  var contentArea = document.querySelector("main") || document.querySelector("[role='main']");
  if (!contentArea) return null;

  var blockEls = contentArea.querySelectorAll("[data-block]");
  if (blockEls.length === 0) return new Set();

  var views = new Set();
  for (var i = 0; i < blockEls.length; i++) {
    var fiber = _getReactFiber(blockEls[i]);
    if (!fiber) continue;
    // Walk up the fiber tree to find the nearest View with model.variables
    var current = fiber;
    while (current) {
      if (_hasModelVariables(current.stateNode)) {
        views.add(current.stateNode);
        break;
      }
      current = current.return;
    }
  }
  return views;
}

/**
 * Extract the module path from a controller prototype by inspecting method
 * source code for registerVariableGroupType keys.
 * Returns e.g. "ILSEReactive.WebBlocks.DockActivities" or "" if unknown.
 */
function _extractModulePath(proto) {
  var methodNames = Object.getOwnPropertyNames(proto);
  for (var i = 0; i < methodNames.length; i++) {
    var m = methodNames[i];
    // Look for internal action implementations (_name$Action) or data fetch methods
    if ((m.startsWith("_") && m.endsWith("$Action")) || m.endsWith("$ServerAction")) {
      try {
        var fn = proto[m];
        if (typeof fn !== "function") continue;
        var src = fn.toString();
        var keyMatch = src.match(/getVariableGroupType\s*\(\s*"([^"]+)"/);
        if (keyMatch) {
          // Key format: "Module.Flow.Name.ActionName$vars"
          var parts = keyMatch[1].split(".");
          if (parts.length >= 3) {
            // Remove the last part (ActionName$vars) to get module path
            return parts.slice(0, -1).join(".");
          }
        }
      } catch (_) {}
    }
  }

  // Fallback: try dataFetchActionNames
  try {
    var dfan = proto.dataFetchActionNames;
    if (Array.isArray(dfan) && dfan.length > 0) {
      // These are just method names like "getStuff$AggrRefresh", not paths
      // but the registerVariableGroupType for these is also in the prototype
    }
  } catch (_) {}

  return "";
}

/**
 * Fallback: search the DOM for elements with React fiber properties,
 * then walk each fiber tree to find the View instance.
 */
function _findViewInstanceByDOMSearch() {
  // Try common OutSystems root selectors
  const candidates = document.querySelectorAll("div[data-block], div[class*='screen'], #renderContainerId, body > div");

  for (const el of candidates) {
    const fiber = _getReactFiber(el);
    if (fiber) {
      const result = _walkFiberForView(fiber);
      if (result) return result;
    }
  }

  // Last resort: walk all direct children of body
  for (const el of document.body.children) {
    const fiber = _getReactFiber(el);
    if (fiber) {
      const result = _walkFiberForView(fiber);
      if (result) return result;
    }
  }

  return null;
}
