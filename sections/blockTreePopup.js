/**
 * sections/blockTreePopup.js — Block Component Hierarchy Popup
 *
 * Shows the full component hierarchy from the screen root down to all
 * blocks, with the selected block highlighted. Read-only tree view.
 */

import { esc, sendMessage } from '../utils/helpers.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let popupOverlay = null;

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/**
 * Wire up popup event listeners on the overlay element.
 * Call once at startup from blocks.init().
 */
export function initBlockTreePopup(overlayEl) {
  popupOverlay = overlayEl;

  popupOverlay.addEventListener("click", (e) => {
    /* Close popup: click backdrop or close button */
    if (e.target === popupOverlay || e.target.closest(".var-popup-close")) {
      closePopup();
      return;
    }

    /* Tree node expand/collapse */
    const header = e.target.closest(".block-tree-node-header");
    if (header) {
      const chevron = header.querySelector(".block-tree-chevron-wrap");
      const children = header.nextElementSibling;
      if (chevron && children && children.classList.contains("block-tree-children")) {
        chevron.classList.toggle("collapsed");
        children.classList.toggle("collapsed");
      }
    }
  });

  popupOverlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePopup();
  });
}

/**
 * Open the block tree popup for a given block.
 *
 * @param {number} targetViewIndex - viewIndex of the block to highlight
 * @param {string} blockName - display name for the popup header
 */
export async function openBlockTreePopup(targetViewIndex, blockName) {
  popupOverlay.innerHTML = `
    <div class="var-popup">
      <div class="var-popup-header">
        <div class="var-popup-header-info">
          <div class="var-popup-title">${esc(blockName)}</div>
          <div class="var-popup-subtitle">Component Hierarchy</div>
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
        <div class="var-popup-loading"><span class="mini-spinner"></span> Loading hierarchy…</div>
      </div>
    </div>`;
  popupOverlay.classList.remove("hidden");

  try {
    const result = await sendMessage({ action: "GET_BLOCK_TREE" });

    if (!result || !result.ok) {
      renderError(result?.error || "Failed to load block tree.");
      return;
    }

    if (result.nodes.length === 0) {
      renderError("No view instances found.");
      return;
    }

    const ancestorChain = buildAncestorChain(result.nodes, targetViewIndex);
    const body = popupOverlay.querySelector(".var-popup-body");
    if (body) {
      body.innerHTML = buildBlockTree(result.nodes, targetViewIndex, ancestorChain);
    }
  } catch (e) {
    renderError(e.message);
  }
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

function closePopup() {
  popupOverlay.classList.add("hidden");
  popupOverlay.innerHTML = "";
}

function renderError(msg) {
  const body = popupOverlay.querySelector(".var-popup-body");
  if (body) {
    body.innerHTML = `<div class="var-popup-error">${esc(msg)}</div>`;
  }
}

/**
 * Walk from targetViewIndex up to the root and return the Set of
 * viewIndexes on that ancestry path (for highlighting / auto-expand).
 */
function buildAncestorChain(nodes, targetViewIndex) {
  const byIndex = {};
  for (const n of nodes) byIndex[n.viewIndex] = n;

  const chain = new Set();
  let cur = targetViewIndex;
  while (cur !== -1 && cur !== undefined) {
    chain.add(cur);
    const node = byIndex[cur];
    if (!node) break;
    cur = node.parentViewIndex;
  }
  return chain;
}

/**
 * Group nodes by parentViewIndex for fast child lookup.
 */
function buildChildrenMap(nodes) {
  const map = {};
  for (const n of nodes) {
    const p = n.parentViewIndex;
    if (!map[p]) map[p] = [];
    map[p].push(n);
  }
  return map;
}

/**
 * Build the full tree HTML from root nodes down.
 */
function buildBlockTree(nodes, targetViewIndex, ancestorChain) {
  const childrenMap = buildChildrenMap(nodes);
  const roots = childrenMap[-1] || [];
  if (roots.length === 0) return `<div class="var-popup-error">No root view found.</div>`;

  let html = '<div class="block-tree">';
  for (const root of roots) {
    html += renderNode(root, childrenMap, targetViewIndex, ancestorChain, 0);
  }
  html += '</div>';
  return html;
}

/** SVG icons used in tree nodes. */
const ICON_SCREEN = `<svg class="block-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
const ICON_BLOCK = `<svg class="block-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`;
const CHEVRON = `<svg class="block-tree-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

/**
 * Recursively render a tree node and its children.
 */
function renderNode(node, childrenMap, targetViewIndex, ancestorChain, depth) {
  const isTarget = node.viewIndex === targetViewIndex;
  const isOnPath = ancestorChain.has(node.viewIndex);
  const isScreen = node.viewIndex === 0;
  const children = childrenMap[node.viewIndex] || [];
  const hasChildren = children.length > 0;
  const shouldExpand = isOnPath || isScreen;

  let cls = "block-tree-node";
  if (isTarget) cls += " block-tree-target";
  else if (isOnPath) cls += " block-tree-on-path";

  let html = `<div class="${cls}">`;

  // Header
  html += `<div class="block-tree-node-header">`;
  if (hasChildren) {
    html += `<span class="block-tree-chevron-wrap ${shouldExpand ? "" : "collapsed"}">${CHEVRON}</span>`;
  } else {
    html += `<span class="block-tree-chevron-spacer"></span>`;
  }
  html += isScreen ? ICON_SCREEN : ICON_BLOCK;
  html += `<span class="block-tree-name">${esc(node.name)}</span>`;

  // Badges
  if (isScreen) {
    html += `<span class="block-tree-badge block-tree-badge-screen">Screen</span>`;
  }
  if (isTarget) {
    html += `<span class="block-tree-badge block-tree-badge-target">SELECTED</span>`;
  } else if (node.isContentArea && !isScreen) {
    html += `<span class="block-tree-badge block-tree-badge-live">LIVE</span>`;
  }
  html += `</div>`; // header

  // Children
  if (hasChildren) {
    html += `<div class="block-tree-children ${shouldExpand ? "" : "collapsed"}">`;
    for (const child of children) {
      html += renderNode(child, childrenMap, targetViewIndex, ancestorChain, depth + 1);
    }
    html += `</div>`;
  }

  html += `</div>`; // node
  return html;
}
