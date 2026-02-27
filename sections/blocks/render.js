/**
 * sections/blocks/render.js — Rendering functions.
 *
 * Builds the full block list HTML. Delegates detail panel building
 * to shared render/builder modules.
 */

import { esc, escAttr } from '../../utils/helpers.js';
import { show, hide } from '../../utils/ui.js';
import { buildDetails } from '../shared/render.js';
import { state, findLiveBlock, inputSearch, blockList, blockCount, sectionEl } from './state.js';

/** Render (or re-render) the blocks list. */
export function render() {
  const query = inputSearch.value.toLowerCase().trim();

  let filtered = state.allBlocks;
  if (query) {
    filtered = filtered.filter(
      (b) =>
        b.name.toLowerCase().includes(query) ||
        b.fullName.toLowerCase().includes(query) ||
        b.module.toLowerCase().includes(query)
    );
  }

  blockCount.textContent = filtered.length;

  if (filtered.length === 0 && state.allBlocks.length > 0) {
    blockList.innerHTML = `<div class="no-results">No blocks match your filter.</div>`;
    show(sectionEl);
    return;
  }

  if (filtered.length === 0) {
    hide(sectionEl);
    return;
  }

  // Group by module (like other sections)
  const groups = {};
  filtered.forEach((b) => {
    const mod = b.module || "Other";
    if (!groups[mod]) groups[mod] = [];
    groups[mod].push(b);
  });

  let html = "";
  for (const group of Object.keys(groups).sort()) {
    const items = groups[group];
    const isCollapsed = !!state.collapsedBlockGroups[group];

    html += `<div class="module-group" data-module="${esc(group)}">`;
    html += `<div class="module-header ${isCollapsed ? "collapsed" : ""}" data-module="${esc(group)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(group)}</span>`;
    html += `<span class="count-badge">${items.length}</span>`;
    html += `</div>`;

    html += `<div class="module-body ${isCollapsed ? "collapsed" : ""}">`;
    for (const b of items) {
      html += buildBlockRow(b);
    }
    html += `</div>`;
    html += `</div>`;
  }

  blockList.innerHTML = html;
  show(sectionEl);
}

function buildBlockRow(b) {
  const blockId = b.fullName;
  const liveBlock = findLiveBlock(b);
  const isLive = !!liveBlock;
  const isExpanded = !!state.expandedBlocks[blockId];
  const isLoading = !!state.loadingBlocks[blockId];

  let html = `
    <div class="var-row screen-row screen-row-expandable block-row ${isLive ? "block-live" : ""} ${isExpanded ? "expanded" : ""}"
         data-block-id="${escAttr(blockId)}" data-controller-module="${escAttr(b.controllerModuleName)}"
         ${isLive ? `data-view-index="${liveBlock.viewIndex}"` : ""}>
      <div class="var-info">
        <svg class="screen-expand-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="var-name">${esc(b.name)}</span>
      </div>
      ${isLive ? `<button class="btn-icon btn-block-tree" data-view-index="${liveBlock.viewIndex}" data-block-name="${escAttr(b.name)}" title="View component hierarchy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/>
          <path d="M12 6v4"/><path d="M12 10L6 18"/><path d="M12 10l6 8"/>
        </svg>
      </button>` : ''}
    </div>`;

  // Add details panel if expanded
  if (isExpanded) {
    html += `<div class="screen-details">`;
    if (isLoading) {
      html += `<div class="screen-details-loading"><span class="mini-spinner"></span> Loading...</div>`;
    } else if (b.details) {
      html += buildDetails(
        b.details,
        isLive,
        null, // no roles for blocks
        blockId,
        state.collapsedSubSections,
        {
          actions: state.expandedActions,
          dataActions: state.expandedDataActions,
          aggregates: state.expandedAggregates,
          serverActions: state.expandedServerActions,
        }
      );
    }
    html += `</div>`;
  }

  return html;
}
