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
 *   - _osDiscoverBlocks()
 *   - _findAllDataBlockMappings()
 *   - _getReactFiber()
 *   - _hasModelVariables()
 *   - _walkFiberForView()
 *   - _dfsForView()
 *   - _dfsCollectAllViews()
 *   - _findViewInstanceByDOMSearch()
 *   - _osGetBlockTree()
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
 * Returns array of { viewInstance, viewIndex, depth, parentViewIndex }.
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
  _dfsCollectAllViews(rootFiber, results, 0, -1);
  return results;
}

/**
 * DFS that collects ALL view instances (doesn't stop at first match).
 * Tracks parentViewIndex so callers can reconstruct the component hierarchy.
 *
 * React fiber trees use .child for the first child and .sibling for the
 * next sibling at the same level.  We recurse on .child (depth + 1) and
 * iterate over .sibling (same depth, same parent) to avoid stack overflow
 * on wide sibling chains.
 */
function _dfsCollectAllViews(fiber, results, depth, parentViewIndex) {
  var current = fiber;
  while (current) {
    var currentParent = parentViewIndex;

    if (_hasModelVariables(current.stateNode)) {
      var thisIndex = results.length;
      results.push({
        viewInstance: current.stateNode,
        viewIndex: thisIndex,
        depth: depth,
        parentViewIndex: parentViewIndex,
      });
      currentParent = thisIndex;
    }

    // Children inherit current viewInstance as parent (one level deeper)
    _dfsCollectAllViews(current.child, results, depth + 1, currentParent);
    // Iterate siblings at the same depth (share the original parentViewIndex)
    current = current.sibling;
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
    _dfsCollectAllViews(rootFiber, results, 0, -1);
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
      _dfsCollectAllViews(r, results, 0, -1);
    }
  }

  return results;
}

/**
 * Find a specific view instance by its DFS index.
 * When viewIndex is undefined/null/0, falls back to _findCurrentScreenViewInstance()
 * for backward compatibility.
 *
 * When a modulePath hint is provided (optional second argument), the function
 * verifies that the view instance at the requested index still matches.
 * If the fiber tree has shifted (e.g. conditional block render/unrender),
 * it falls back to scanning all instances for a modulePath match.
 */
function _findViewInstanceByIndex(viewIndex, expectedModulePath) {
  if (viewIndex === undefined || viewIndex === null || viewIndex === 0) {
    return _findCurrentScreenViewInstance();
  }
  var all = _findAllViewInstances();
  var candidate = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].viewIndex === viewIndex) { candidate = all[i].viewInstance; break; }
  }

  // If no modulePath hint, return whatever we found at that index
  if (!expectedModulePath) return candidate;

  // Verify the candidate's modulePath still matches
  if (candidate) {
    var proto = Object.getPrototypeOf(candidate.controller);
    var actualPath = _extractModulePath(proto);
    if (actualPath === expectedModulePath) return candidate;
  }

  // Fallback: the tree shifted — search all instances by modulePath
  for (var j = 0; j < all.length; j++) {
    var inst = all[j].viewInstance;
    var p = Object.getPrototypeOf(inst.controller);
    if (_extractModulePath(p) === expectedModulePath) return inst;
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
function _osDiscoverBlocks() {
  try {
    var all = _findAllViewInstances();
    if (all.length <= 1) {
      return { ok: true, blocks: [] };
    }

    // Build a Map of view instance → data-block attribute from the content area
    var contentViews = _findContentAreaViewInstances();

    var blocks = [];
    for (var i = 1; i < all.length; i++) {
      var entry = all[i];
      // If we found content-area views, filter to only those
      if (contentViews && !contentViews.has(entry.viewInstance)) continue;

      var ctrl = entry.viewInstance.controller;
      var proto = Object.getPrototypeOf(ctrl);
      var modulePath = _extractModulePath(proto);

      // data-block attribute (e.g. "WebBlocks.PickzoneIdCombo") serves as
      // a fallback identifier when _extractModulePath cannot find the path.
      var dataBlockAttr = contentViews ? (contentViews.get(entry.viewInstance) || "") : "";

      blocks.push({
        viewIndex: entry.viewIndex,
        depth: entry.depth,
        modulePath: modulePath,
        dataBlockAttr: dataBlockAttr,
      });
    }

    return { ok: true, blocks: blocks };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Find all view instances whose DOM block element ([data-block]) is inside
 * the screen's <main> content area.  Returns a Map of viewInstance →
 * data-block attribute value, or null when the content area cannot be
 * located (caller should fall back to showing all blocks).
 */
function _findContentAreaViewInstances() {
  var contentArea = document.querySelector("main") || document.querySelector("[role='main']");
  if (!contentArea) return null;

  var blockEls = contentArea.querySelectorAll("[data-block]");
  if (blockEls.length === 0) return new Map();

  var views = new Map();
  for (var i = 0; i < blockEls.length; i++) {
    var dataBlock = blockEls[i].getAttribute("data-block");
    var fiber = _getReactFiber(blockEls[i]);
    if (!fiber) continue;
    // Walk up the fiber tree to find the nearest View with model.variables
    var current = fiber;
    while (current) {
      if (_hasModelVariables(current.stateNode)) {
        views.set(current.stateNode, dataBlock || "");
        break;
      }
      current = current.return;
    }
  }
  return views;
}

/**
 * Map ALL [data-block] elements on the page to their nearest view instance.
 * Unlike _findContentAreaViewInstances (which only searches inside <main>),
 * this searches the entire document so layout/structural blocks outside
 * the content area also get names.
 * Returns a Map of viewInstance → data-block attribute value.
 */
function _findAllDataBlockMappings() {
  var blockEls = document.querySelectorAll("[data-block]");
  var views = new Map();
  for (var i = 0; i < blockEls.length; i++) {
    var dataBlock = blockEls[i].getAttribute("data-block");
    var fiber = _getReactFiber(blockEls[i]);
    if (!fiber) continue;
    var current = fiber;
    while (current) {
      if (_hasModelVariables(current.stateNode)) {
        // First (nearest) data-block wins for each view instance
        if (!views.has(current.stateNode)) {
          views.set(current.stateNode, dataBlock || "");
        }
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
 * Returns e.g. "MyApp.WebBlocks.SomeBlock" or "" if unknown.
 */
function _extractModulePath(proto) {
  var methodNames = Object.getOwnPropertyNames(proto);
  for (var i = 0; i < methodNames.length; i++) {
    if (methodNames[i] === "constructor") continue;
    try {
      var fn = proto[methodNames[i]];
      if (typeof fn !== "function") continue;
      var src = fn.toString();
      // Key format: "Module.Flow.Name.ActionName$vars"
      var keyMatch = src.match(/getVariableGroupType\s*\(\s*"([^"]+)"/);
      if (keyMatch) {
        var parts = keyMatch[1].split(".");
        if (parts.length >= 3) {
          // Remove the last part (ActionName$vars) to get module path
          return parts.slice(0, -1).join(".");
        }
      }
    } catch (_) {}
  }
  return "";
}

/**
 * Fallback: search the DOM for elements with React fiber properties,
 * then walk each fiber tree to find the View instance.
 * Uses _hasModelVariables() for consistent try/catch-guarded checking.
 */
function _findViewInstanceByDOMSearch() {
  // Try common OutSystems root selectors
  var candidates = document.querySelectorAll("div[data-block], div[class*='screen'], #renderContainerId, body > div");

  for (var i = 0; i < candidates.length; i++) {
    var fiber = _getReactFiber(candidates[i]);
    if (fiber) {
      var result = _walkFiberForView(fiber);
      if (result) return result;
    }
  }

  // Last resort: walk all direct children of body
  for (var j = 0; j < document.body.children.length; j++) {
    var fiber = _getReactFiber(document.body.children[j]);
    if (fiber) {
      var result = _walkFiberForView(fiber);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Build the full view-instance hierarchy tree for the current screen.
 * Returns ALL view instances (not content-area filtered) with parent
 * relationships so the side panel can render a component hierarchy tree.
 */
function _osGetBlockTree() {
  try {
    var all = _findAllViewInstances();
    if (all.length === 0) {
      return { ok: true, nodes: [] };
    }

    // Content area views — used only for the isContentArea badge
    var contentViews = _findContentAreaViewInstances();
    // ALL data-block mappings from entire document — used for name resolution
    var allDataBlocks = _findAllDataBlockMappings();

    var nodes = [];
    for (var i = 0; i < all.length; i++) {
      var entry = all[i];
      var ctrl = entry.viewInstance.controller;
      var proto = Object.getPrototypeOf(ctrl);
      var modulePath = _extractModulePath(proto);

      // Derive display name from modulePath last segment
      var name = "";
      if (modulePath) {
        var parts = modulePath.split(".");
        name = parts[parts.length - 1];
      }

      // Fallback: use data-block attribute (searched across entire document)
      var dataBlockAttr = allDataBlocks.get(entry.viewInstance) || "";
      if (!name && dataBlockAttr) {
        var attrParts = dataBlockAttr.split(".");
        name = attrParts[attrParts.length - 1];
      }

      if (!name) {
        if (i === 0) {
          // Screen root: extract name from URL path (e.g. /ModuleName/ScreenName)
          var pathSegments = window.location.pathname.split("/").filter(Boolean);
          name = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : "Screen";
        } else {
          name = "Unknown Block";
        }
      }

      nodes.push({
        viewIndex: entry.viewIndex,
        parentViewIndex: entry.parentViewIndex,
        modulePath: modulePath,
        dataBlockAttr: dataBlockAttr,
        name: name,
        isContentArea: i === 0 || (contentViews ? contentViews.has(entry.viewInstance) : false),
      });
    }

    return { ok: true, nodes: nodes };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
