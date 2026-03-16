/**
 * sections/screens/render.js — Rendering functions.
 *
 * Builds the full screen list HTML. Delegates detail panel building
 * to shared render/builder modules.
 */

import { esc, escAttr } from '../../utils/helpers.js';
import { show, hide } from '../../utils/ui.js';
import { buildDetails } from '../shared/render.js';
import {
  state, inputSearch, screenList, screenCount, emptyState, sectionEl,
  roleFilterEl, btnRoleFilter, roleFilterLabel, roleFilterOptions
} from './state.js';

/** Render (or re-render) the screens list. */
export function render() {
  const query = inputSearch.value.toLowerCase().trim();

  let filtered = state.allScreens;
  if (query) {
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.screenUrl.toLowerCase().includes(query) ||
        s.flow.toLowerCase().includes(query) ||
        (s.roles && s.roles.some(r => r.toLowerCase().includes(query)))
    );
  }

  if (state.currentScreenOnly) {
    filtered = filtered.filter(s => s.screenUrl === state.currentScreen);
  }

  if (state.selectedRoles.length > 0) {
    filtered = filtered.filter(s => s.roles && state.selectedRoles.every(r => s.roles.includes(r)));
  }

  screenCount.textContent = filtered.length;

  if (filtered.length === 0 && state.allScreens.length > 0) {
    screenList.innerHTML = `<div class="no-results">No screens match your filter.</div>`;
    show(sectionEl);
    return;
  }

  if (filtered.length === 0) {
    hide(sectionEl);
    return;
  }

  // Group by flow
  const groups = {};
  filtered.forEach((s) => {
    const flow = s.flow || "Other";
    if (!groups[flow]) groups[flow] = [];
    groups[flow].push(s);
  });

  let html = "";
  for (const flow of Object.keys(groups).sort()) {
    const screens = groups[flow];
    const isCollapsed = !!state.collapsedScreenFlows[flow];

    html += `<div class="module-group" data-module="${esc(flow)}">`;
    html += `<div class="module-header ${isCollapsed ? "collapsed" : ""}" data-module="${esc(flow)}">`;
    html += `<svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    html += `<span>${esc(flow)}</span>`;
    html += `<span class="count-badge">${screens.length}</span>`;
    html += `</div>`;

    html += `<div class="module-body ${isCollapsed ? "collapsed" : ""}">`;
    for (const s of screens) {
      html += buildScreenRow(s);
    }
    html += `</div>`;
    html += `</div>`;
  }

  screenList.innerHTML = html;
  show(sectionEl);
  hide(emptyState);
}

function buildRoleBadges(roles) {
  if (!roles || roles.length === 0) return '';
  if (roles.length === 1 && roles[0] === "Public") {
    return '<span class="screen-role-badge screen-role-public">PUBLIC</span>';
  }
  if (roles.length === 1 && roles[0] === "Registered") {
    return '<span class="screen-role-badge screen-role-registered">REGISTERED</span>';
  }
  return roles.map(r => `<span class="screen-role-badge">${esc(r)}</span>`).join('');
}

function buildScreenRow(s) {
  const isCurrent = s.screenUrl === state.currentScreen;
  const isHome = s.fullName === state.homeScreenName;
  const isExpanded = !!state.expandedScreens[s.screenUrl];
  const isLoading = !!state.loadingScreens[s.screenUrl];
  const navUrl = state.screenBaseUrl + "/" + s.screenUrl;

  let html = `
    <div class="var-row screen-row screen-row-expandable ${isCurrent ? "screen-current" : ""} ${isExpanded ? "expanded" : ""}"
         data-screen-url="${esc(s.screenUrl)}" data-flow="${esc(s.flow)}" data-name="${esc(s.name)}">
      <div class="var-info">
        <svg class="screen-expand-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="var-name">${esc(s.name)}</span>
        ${isCurrent ? '<span class="var-type screen-current-badge">CURRENT</span>' : ''}
        ${isHome ? '<span class="var-type screen-home-badge">HOME</span>' : ''}
        ${s.roles && s.roles.length === 1 && s.roles[0] === 'Public' ? '<span class="screen-role-badge screen-role-public screen-role-inline">PUBLIC</span>' : ''}
        ${s.roles && s.roles.length === 1 && s.roles[0] === 'Registered' ? '<span class="screen-role-badge screen-role-registered screen-role-inline">REGISTERED</span>' : ''}
      </div>
      ${state.screenBaseUrl ? `<div class="var-value-wrap">
        <button class="btn-icon btn-navigate" data-url="${escAttr(navUrl)}" title="Navigate to ${esc(s.name)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      </div>` : ''}
    </div>`;

  // Add details panel if expanded
  if (isExpanded) {
    html += `<div class="screen-details">`;
    if (isLoading) {
      html += `<div class="screen-details-loading"><span class="mini-spinner"></span> Loading...</div>`;
    } else if (s.details) {
      html += buildDetails(
        s.details,
        isCurrent,
        s.roles,
        s.screenUrl,
        state.collapsedSubSections,
        {
          actions: state.expandedActions,
          dataActions: state.expandedDataActions,
          aggregates: state.expandedAggregates,
          serverActions: state.expandedServerActions,
        },
        buildRoleBadges
      );
    }
    html += `</div>`;
  }

  return html;
}

/** Populate the role filter dropdown from current screen data. */
export function populateRoleFilter() {
  const roles = new Set();
  for (const s of state.allScreens) {
    if (s.roles) s.roles.forEach(r => roles.add(r));
  }

  const sorted = [...roles].sort();

  if (sorted.length === 0) {
    roleFilterEl.classList.add("hidden");
    state.selectedRoles = [];
    return;
  }

  roleFilterEl.classList.remove("hidden");

  roleFilterOptions.innerHTML = sorted.map(r =>
    `<label class="multi-select-option" data-role="${escAttr(r)}">
      <input type="checkbox" value="${escAttr(r)}" ${state.selectedRoles.includes(r) ? "checked" : ""}/>
      ${esc(r)}
    </label>`
  ).join("");

  updateRoleFilterLabel();
}

/** Update the role filter button label based on selection. */
export function updateRoleFilterLabel() {
  const count = state.selectedRoles.length;
  if (count === 0) {
    roleFilterLabel.textContent = "All Roles";
    btnRoleFilter.classList.remove("active");
  } else if (count === 1) {
    roleFilterLabel.textContent = state.selectedRoles[0];
    btnRoleFilter.classList.add("active");
  } else {
    roleFilterLabel.textContent = count + " roles";
    btnRoleFilter.classList.add("active");
  }
}
