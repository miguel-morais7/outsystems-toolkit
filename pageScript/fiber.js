/**
 * pageScript/fiber.js — React Fiber traversal for finding the live screen.
 *
 * Depends on: (none — standalone)
 *
 * Provides:
 *   - _findCurrentScreenModel()
 *   - _findCurrentScreenViewInstance()
 *   - _getReactFiber()
 *   - _walkFiberForView()
 *   - _dfsForView()
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
  const instance = fiber.stateNode;
  if (instance && instance.controller && instance.model && instance.model.variables) {
    // Found a component with controller.model.variables — this is our screen View
    return instance;
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
