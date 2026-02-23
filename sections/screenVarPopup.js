/**
 * sections/screenVarPopup.js — Variable Inspect/Edit Popup
 *
 * Tree-view popup for inspecting and editing complex screen variables
 * (Record, RecordList, Object). Supports deep editing of nested fields,
 * list append, and list delete operations.
 */

import { esc, escAttr, sendMessage, formatDateForInput } from '../utils/helpers.js';
import { flashRow, toast } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let popupOverlay = null;
let popupState = null; // { internalName, name, type, basePath?, viewIndex? } or { methodName, attrName, name, type, isActionParam: true, viewIndex? }

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/**
 * Wire up all popup event listeners on the overlay element.
 * Call once at startup from screens.init().
 */
export function initPopupListeners(overlayEl) {
  popupOverlay = overlayEl;

  /* Close popup: click backdrop or close button */
  popupOverlay.addEventListener("click", (e) => {
    if (e.target === popupOverlay || e.target.closest(".var-popup-close")) {
      closeVarPopup();
      return;
    }

    // Append new record to list
    const appendBtn = e.target.closest(".btn-list-append");
    if (appendBtn) {
      e.stopPropagation();
      handleListAppendClick(appendBtn);
      return;
    }

    // Delete record from list
    const deleteBtn = e.target.closest(".btn-list-delete");
    if (deleteBtn) {
      e.stopPropagation();
      handleListDeleteClick(deleteBtn);
      return;
    }

    // Expand all / Collapse all
    const expandAllBtn = e.target.closest(".btn-expand-all");
    if (expandAllBtn) {
      e.stopPropagation();
      toggleAllTreeNodes(false);
      return;
    }
    const collapseAllBtn = e.target.closest(".btn-collapse-all");
    if (collapseAllBtn) {
      e.stopPropagation();
      toggleAllTreeNodes(true);
      return;
    }

    // Tree node expand/collapse
    const treeHeader = e.target.closest(".var-tree-header");
    if (treeHeader) {
      treeHeader.classList.toggle("collapsed");
      const children = treeHeader.nextElementSibling;
      if (children && children.classList.contains("var-tree-children")) {
        children.classList.toggle("collapsed");
      }
      return;
    }

    // Boolean toggle in tree
    const treeBool = e.target.closest(".bool-toggle");
    if (treeBool) {
      e.stopPropagation();
      const isActive = treeBool.classList.contains("active");
      const newVal = !isActive;
      treeBool.classList.toggle("active", newVal);
      const leaf = treeBool.closest(".var-tree-leaf");
      commitTreeLeaf(leaf, String(newVal));
      return;
    }
  });

  /* Tree leaf editing: Enter → save, Escape → revert */
  popupOverlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // If an input is focused, revert it; otherwise close popup
      const input = e.target.closest(".var-tree-leaf-input");
      if (input && input.value !== input.dataset.original) {
        input.value = input.dataset.original;
        input.blur();
      } else {
        closeVarPopup();
      }
      return;
    }

    const input = e.target.closest(".var-tree-leaf-input");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const leaf = input.closest(".var-tree-leaf");
      commitTreeLeaf(leaf, input.value);
    }
  });

  /* Tree leaf editing: blur → save if changed */
  popupOverlay.addEventListener("focusout", (e) => {
    const input = e.target.closest(".var-tree-leaf-input");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      const leaf = input.closest(".var-tree-leaf");
      commitTreeLeaf(leaf, input.value);
    }
  });

  /* Date/time/datetime pickers fire "change" */
  popupOverlay.addEventListener("change", (e) => {
    const input = e.target.closest(".var-tree-leaf-date");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      const leaf = input.closest(".var-tree-leaf");
      commitTreeLeaf(leaf, input.value);
    }
  });
}

/**
 * Open the inspect popup for a complex type variable.
 * Sends INTROSPECT_SCREEN_VAR and renders the tree view.
 */
export async function openVarPopup(internalName, name, type, viewIndex) {
  popupState = { internalName, name, type, viewIndex };

  // Show popup with loading state
  popupOverlay.innerHTML = `
    <div class="var-popup">
      <div class="var-popup-header">
        <div class="var-popup-header-info">
          <div class="var-popup-title">${esc(name)}</div>
          <div class="var-popup-subtitle">${esc(type)}</div>
        </div>
        <button class="var-popup-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="var-popup-body">
        <div class="var-popup-loading"><span class="mini-spinner"></span> Inspecting…</div>
      </div>
    </div>`;
  popupOverlay.classList.remove("hidden");

  // Fetch the introspected tree
  try {
    const result = await sendMessage({
      action: "INTROSPECT_SCREEN_VAR",
      internalName,
      viewIndex: popupState.viewIndex,
    });

    if (!result || !result.ok) {
      renderPopupError(result?.error || "Failed to introspect variable.");
      return;
    }

    // Render the tree view with toolbar
    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = buildPopupToolbar() + `<div class="var-tree">${buildTreeNode(result.tree, [], 0)}</div>`;
    }
  } catch (e) {
    renderPopupError(e.message);
  }
}

/**
 * Open the inspect popup for a complex type action parameter.
 * Sends INIT_ACTION_PARAM to create a default value and render the tree.
 */
export async function openActionParamPopup(methodName, attrName, name, type, viewIndex) {
  popupState = { methodName, attrName, name, type, isActionParam: true, viewIndex };

  // Show popup with loading state
  popupOverlay.innerHTML = `
    <div class="var-popup">
      <div class="var-popup-header">
        <div class="var-popup-header-info">
          <div class="var-popup-title">${esc(name)}</div>
          <div class="var-popup-subtitle">${esc(type)} (action parameter)</div>
        </div>
        <button class="var-popup-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="var-popup-body">
        <div class="var-popup-loading"><span class="mini-spinner"></span> Initializing…</div>
      </div>
    </div>`;
  popupOverlay.classList.remove("hidden");

  try {
    const result = await sendMessage({
      action: "INIT_ACTION_PARAM",
      methodName,
      attrName,
      viewIndex: popupState.viewIndex,
    });

    if (!result || !result.ok) {
      renderPopupError(result?.error || "Failed to initialize action parameter.");
      return;
    }

    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = buildPopupToolbar() + `<div class="var-tree">${buildTreeNode(result.tree, [], 0)}</div>`;
    }
  } catch (e) {
    renderPopupError(e.message);
  }
}

/**
 * Open the inspect popup for a data action output parameter.
 * Introspects the data action record variable and navigates to the specific output sub-tree.
 */
export async function openDataActionOutputPopup(varAttrName, outputAttrName, name, type, viewIndex) {
  popupState = { internalName: varAttrName, basePath: [outputAttrName], name, type, viewIndex };

  // Show popup with loading state
  popupOverlay.innerHTML = `
    <div class="var-popup">
      <div class="var-popup-header">
        <div class="var-popup-header-info">
          <div class="var-popup-title">${esc(name)}</div>
          <div class="var-popup-subtitle">${esc(type)} (data action output)</div>
        </div>
        <button class="var-popup-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="var-popup-body">
        <div class="var-popup-loading"><span class="mini-spinner"></span> Inspecting…</div>
      </div>
    </div>`;
  popupOverlay.classList.remove("hidden");

  try {
    const result = await sendMessage({
      action: "INTROSPECT_SCREEN_VAR",
      internalName: varAttrName,
      viewIndex: popupState.viewIndex,
    });

    if (!result || !result.ok) {
      renderPopupError(result?.error || "Failed to introspect data action output.");
      return;
    }

    // Navigate to the output field sub-tree
    let tree = result.tree;
    if (tree && tree.fields) {
      const subNode = tree.fields.find(f => f.key === outputAttrName);
      if (subNode) {
        tree = subNode;
      }
    }

    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = buildPopupToolbar() + `<div class="var-tree">${buildTreeNode(tree, [], 0)}</div>`;
    }
  } catch (e) {
    renderPopupError(e.message);
  }
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

/** Close the popup and clear state. */
function closeVarPopup() {
  popupOverlay.classList.add("hidden");
  popupOverlay.innerHTML = "";
  popupState = null;
}

/** Build the toolbar with expand/collapse all buttons. */
function buildPopupToolbar() {
  return `<div class="var-popup-toolbar">
    <button class="btn-expand-all" title="Expand all">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      Expand all
    </button>
    <button class="btn-collapse-all" title="Collapse all">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>
      Collapse all
    </button>
  </div>`;
}

/** Toggle all tree nodes expanded or collapsed, skipping the root level. */
function toggleAllTreeNodes(collapse) {
  const headers = popupOverlay.querySelectorAll(".var-tree-header");
  const childrenEls = popupOverlay.querySelectorAll(".var-tree-children");
  for (const h of headers) {
    if (h.parentElement.classList.contains("var-tree-root")) continue;
    h.classList.toggle("collapsed", collapse);
  }
  for (const c of childrenEls) {
    if (c.parentElement.classList.contains("var-tree-root")) continue;
    c.classList.toggle("collapsed", collapse);
  }
}

/** Render an error message in the popup body. */
function renderPopupError(msg) {
  const body = popupOverlay.querySelector(".var-popup-body");
  if (body) {
    body.innerHTML = `<div class="var-popup-error">${esc(msg)}</div>`;
  }
}

/**
 * Recursively build HTML for a tree node.
 *
 * @param {Object} node - Tree node from _osScreenVarIntrospect
 * @param {Array} path - Path of steps from root to this node
 * @param {number} depth - Current depth for auto-collapse
 * @param {Set<string>} expandedPaths - Set of path strings for expanded nodes (optional)
 * @returns {string} HTML string
 */
function buildTreeNode(node, path, depth, expandedPaths = null) {
  if (!node) return "";

  // Clean up the display name: strip trailing "Attr", "Var", "Out" suffixes
  const displayKey = cleanAttrName(node.key);

  if (node.kind === "primitive") {
    return buildTreeLeaf(node, path, displayKey);
  }

  if (node.kind === "list") {
    const pathStr = JSON.stringify(path);
    const listPathJson = escAttr(pathStr);
    // Use expandedPaths if provided, otherwise use default depth-based collapse
    const shouldExpand = expandedPaths !== null ? expandedPaths.has(pathStr) : depth <= 1;
    const isCollapsed = shouldExpand ? "" : " collapsed";
    const childrenCollapsed = shouldExpand ? "" : " collapsed";

    let html = `<div class="var-tree-node ${depth === 0 ? "var-tree-root" : ""}">`;
    html += `<div class="var-tree-header${isCollapsed}" data-path="${listPathJson}">`;
    html += `<svg class="var-tree-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span class="var-tree-key">${esc(displayKey)}</span>`;
    html += `<span class="var-tree-badge">${node.count} item${node.count !== 1 ? "s" : ""}</span>`;
    html += `</div>`;
    html += `<div class="var-tree-children${childrenCollapsed}">`;
    for (const item of node.items) {
      const itemIndex = parseInt(item.key, 10);
      const itemPath = [...path, { index: itemIndex }];
      // Wrap each list item with a delete button
      html += `<div class="var-tree-list-item">`;
      html += `<button class="btn-list-delete" data-path="${listPathJson}" data-index="${itemIndex}" title="Delete item ${itemIndex}">`;
      html += `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      html += `</button>`;
      html += buildTreeNode(item, itemPath, depth + 1, expandedPaths);
      html += `</div>`;
    }
    if (node.truncated) {
      html += `<div class="var-tree-leaf"><span class="var-tree-leaf-name" style="font-style:italic;color:var(--text-muted)">… more items</span></div>`;
    }
    // Append button at the bottom of the list
    html += `<button class="btn-list-append" data-path="${listPathJson}">`;
    html += `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    html += ` Add record</button>`;
    html += `</div></div>`;
    return html;
  }

  if (node.kind === "record") {
    const pathStr = JSON.stringify(path);
    const recordPathJson = escAttr(pathStr);
    // Use expandedPaths if provided, otherwise use default depth-based collapse
    const shouldExpand = expandedPaths !== null ? expandedPaths.has(pathStr) : depth <= 2;
    const isCollapsed = shouldExpand ? "" : " collapsed";
    const childrenCollapsed = shouldExpand ? "" : " collapsed";

    let html = `<div class="var-tree-node ${depth === 0 ? "var-tree-root" : ""}">`;
    html += `<div class="var-tree-header${isCollapsed}" data-path="${recordPathJson}">`;
    html += `<svg class="var-tree-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span class="var-tree-key">${esc(displayKey)}</span>`;
    html += `<span class="var-tree-badge">${node.fields.length} field${node.fields.length !== 1 ? "s" : ""}</span>`;
    html += `</div>`;
    html += `<div class="var-tree-children${childrenCollapsed}">`;
    for (const field of node.fields) {
      const fieldPath = [...path, field.key];
      html += buildTreeNode(field, fieldPath, depth + 1, expandedPaths);
    }
    html += `</div></div>`;
    return html;
  }

  // Fallback
  return `<div class="var-tree-leaf"><span class="var-tree-leaf-name">${esc(displayKey)}</span><span class="var-tree-badge">${esc(String(node.value || ""))}</span></div>`;
}

/**
 * Build an inline-editable leaf node for a primitive value.
 */
function buildTreeLeaf(node, path, displayKey) {
  const val = node.value === null || node.value === undefined ? "" : String(node.value);
  const pathJson = escAttr(JSON.stringify(path));

  // Boolean: show toggle
  if (node.type === "boolean" || node.type === "Boolean" || val === "true" || val === "false") {
    const active = val === "true" ? " active" : "";
    return `<div class="var-tree-leaf" data-path="${pathJson}" data-type="Boolean">
      <span class="var-tree-leaf-name">${esc(displayKey)}:</span>
      <button class="bool-toggle${active}"><span class="knob"></span></button>
    </div>`;
  }

  // Date / Time / DateTime: show native date/time picker
  if (node.type === "Date" || node.type === "Time" || node.type === "Date Time") {
    const inputType = node.type === "Date" ? "date" : node.type === "Time" ? "time" : "datetime-local";
    const displayValue = formatDateForInput(val, node.type);
    return `<div class="var-tree-leaf" data-path="${pathJson}" data-type="${escAttr(node.type)}">
      <span class="var-tree-leaf-name">${esc(displayKey)}:</span>
      <input class="var-tree-leaf-input var-tree-leaf-date" type="${inputType}"
             value="${escAttr(displayValue)}"
             data-original="${escAttr(displayValue)}"
             ${node.type === "Time" ? 'step="1"' : ""} />
      <span class="var-tree-leaf-type">${esc(node.type)}</span>
    </div>`;
  }

  // Default: text input
  return `<div class="var-tree-leaf" data-path="${pathJson}" data-type="${escAttr(node.type || "Text")}">
    <span class="var-tree-leaf-name">${esc(displayKey)}:</span>
    <input class="var-tree-leaf-input" type="text"
           value="${escAttr(val)}"
           data-original="${escAttr(val)}" />
    ${node.type ? `<span class="var-tree-leaf-type">${esc(node.type)}</span>` : ""}
  </div>`;
}

/**
 * Clean up OutSystems internal attribute names for display.
 * Strips common suffixes like "Attr", "Var", "Out" and converts to readable form.
 */
function cleanAttrName(name) {
  if (!name) return "";
  // Strip "Attr" suffix
  let clean = name.replace(/Attr$/, "");
  // Strip "Var" suffix
  clean = clean.replace(/Var$/, "");
  // Strip "Out" suffix for aggregate outputs
  clean = clean.replace(/Out$/, "");
  // Convert camelCase to Title Case with spaces
  clean = clean.replace(/([a-z])([A-Z])/g, "$1 $2");
  // Capitalize first letter
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Capture the current expansion state of all tree nodes.
 * Returns a Set of path strings for nodes that are currently expanded.
 */
function captureExpansionState() {
  const expandedPaths = new Set();
  const headers = popupOverlay.querySelectorAll(".var-tree-header");
  for (const header of headers) {
    if (!header.classList.contains("collapsed") && header.dataset.path) {
      expandedPaths.add(header.dataset.path);
    }
  }
  return expandedPaths;
}

/**
 * Commit a tree leaf value change.
 * Dispatches to SET_SCREEN_VAR_DEEP or SET_ACTION_PARAM_DEEP based on mode.
 */
async function commitTreeLeaf(leafEl, newValue) {
  if (!popupState) return;

  const pathJson = leafEl.dataset.path;
  const dataType = leafEl.dataset.type || "Text";
  let path;
  try {
    path = JSON.parse(pathJson);
  } catch (e) {
    toast("Invalid path data", "error");
    return;
  }

  try {
    let result;
    if (popupState.isActionParam) {
      result = await sendMessage({
        action: "SET_ACTION_PARAM_DEEP",
        methodName: popupState.methodName,
        attrName: popupState.attrName,
        path,
        value: newValue,
        dataType,
        viewIndex: popupState.viewIndex,
      });
    } else {
      // Prepend basePath for data action output sub-tree navigation
      const fullPath = popupState.basePath ? [...popupState.basePath, ...path] : path;
      result = await sendMessage({
        action: "SET_SCREEN_VAR_DEEP",
        internalName: popupState.internalName,
        path: fullPath,
        value: newValue,
        dataType,
        viewIndex: popupState.viewIndex,
      });
    }

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to set value.");
    }

    // Update the input's original value for future change detection
    const input = leafEl.querySelector(".var-tree-leaf-input");
    if (input) {
      input.dataset.original = input.value;
    }

    flashRow(leafEl, "saved");
    toast("Value updated", "success");
  } catch (err) {
    flashRow(leafEl, "error");
    toast(err.message, "error");

    // Revert the input
    const input = leafEl.querySelector(".var-tree-leaf-input");
    if (input) {
      input.value = input.dataset.original;
    }
  }
}

/**
 * Handle clicking the "Add record" button on a list node.
 * Dispatches to LIST_APPEND or ACTION_PARAM_LIST_APPEND based on mode.
 */
async function handleListAppendClick(btn) {
  if (!popupState) return;

  let path;
  try {
    path = JSON.parse(btn.dataset.path);
  } catch (e) {
    toast("Invalid path data", "error");
    return;
  }

  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "Adding…";

  // Capture expansion state before making changes
  const expandedPaths = captureExpansionState();

  try {
    let result;
    if (popupState.isActionParam) {
      result = await sendMessage({
        action: "ACTION_PARAM_LIST_APPEND",
        methodName: popupState.methodName,
        attrName: popupState.attrName,
        path,
        viewIndex: popupState.viewIndex,
      });
    } else {
      const fullPath = popupState.basePath ? [...popupState.basePath, ...path] : path;
      result = await sendMessage({
        action: "LIST_APPEND",
        internalName: popupState.internalName,
        path: fullPath,
        viewIndex: popupState.viewIndex,
      });
    }

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to append record.");
    }

    // For basePath mode, navigate to the sub-tree in the returned result
    let tree = result.tree;
    if (popupState.basePath && tree && tree.fields) {
      const subNode = tree.fields.find(f => f.key === popupState.basePath[popupState.basePath.length - 1]);
      if (subNode) tree = subNode;
    }

    // Ensure the parent list stays expanded
    expandedPaths.add(JSON.stringify(path));

    // Re-render the entire tree with the updated data, preserving expansion state
    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = buildPopupToolbar() + `<div class="var-tree">${buildTreeNode(tree, [], 0, expandedPaths)}</div>`;
    }

    toast("Record added", "success");
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
    btn.textContent = origText;
  }
}

/**
 * Handle clicking the delete button on a list item.
 * Dispatches to LIST_DELETE or ACTION_PARAM_LIST_DELETE based on mode.
 */
async function handleListDeleteClick(btn) {
  if (!popupState) return;

  let path;
  try {
    path = JSON.parse(btn.dataset.path);
  } catch (e) {
    toast("Invalid path data", "error");
    return;
  }

  const index = parseInt(btn.dataset.index, 10);
  if (isNaN(index)) {
    toast("Invalid item index", "error");
    return;
  }

  // Visual feedback — fade the item
  const listItem = btn.closest(".var-tree-list-item");
  if (listItem) listItem.style.opacity = "0.5";

  // Capture expansion state before making changes
  const expandedPaths = captureExpansionState();

  try {
    let result;
    if (popupState.isActionParam) {
      result = await sendMessage({
        action: "ACTION_PARAM_LIST_DELETE",
        methodName: popupState.methodName,
        attrName: popupState.attrName,
        path,
        index,
        viewIndex: popupState.viewIndex,
      });
    } else {
      const fullPath = popupState.basePath ? [...popupState.basePath, ...path] : path;
      result = await sendMessage({
        action: "LIST_DELETE",
        internalName: popupState.internalName,
        path: fullPath,
        index,
        viewIndex: popupState.viewIndex,
      });
    }

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to delete record.");
    }

    // For basePath mode, navigate to the sub-tree in the returned result
    let tree = result.tree;
    if (popupState.basePath && tree && tree.fields) {
      const subNode = tree.fields.find(f => f.key === popupState.basePath[popupState.basePath.length - 1]);
      if (subNode) tree = subNode;
    }

    // Ensure the parent list stays expanded
    expandedPaths.add(JSON.stringify(path));

    // Re-render the entire tree with the updated data, preserving expansion state
    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = buildPopupToolbar() + `<div class="var-tree">${buildTreeNode(tree, [], 0, expandedPaths)}</div>`;
    }

    toast("Record deleted", "success");
  } catch (err) {
    toast(err.message, "error");
    if (listItem) listItem.style.opacity = "1";
  }
}
