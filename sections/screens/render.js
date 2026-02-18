/**
 * sections/screens/render.js — Rendering functions.
 *
 * Builds the full screen list HTML and delegates item building to builders.js.
 */

import { esc, escAttr } from '../../utils/helpers.js';
import { show, hide } from '../../utils/ui.js';
import { state, inputSearch, screenList, screenCount, emptyState, sectionEl } from './state.js';
import { buildScreenVarItem, buildScreenActionItem } from './builders.js';

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
      <div class="var-value-wrap">
        <button class="btn-icon btn-navigate" data-url="${escAttr(navUrl)}" title="Navigate to ${esc(s.name)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      </div>
    </div>`;

  // Add details panel if expanded
  if (isExpanded) {
    html += `<div class="screen-details">`;
    if (isLoading) {
      html += `<div class="screen-details-loading"><span class="mini-spinner"></span> Loading...</div>`;
    } else if (s.details) {
      html += buildScreenDetails(s.details, isCurrent, s.roles, s.screenUrl);
    }
    html += `</div>`;
  }

  return html;
}

function buildSubSection(screenUrl, key, title, contentHtml) {
  const stateKey = screenUrl + "::" + key;
  const isCollapsed = !!state.collapsedSubSections[stateKey];
  let html = `<div class="screen-detail-section ${isCollapsed ? "sub-collapsed" : ""}" data-screen-url="${escAttr(screenUrl)}" data-sub-key="${escAttr(key)}">`;
  html += `<div class="screen-detail-header screen-detail-header-toggle">`;
  html += `<svg class="screen-sub-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  html += `${esc(title)}<span class="count-badge screen-sub-count">${contentHtml.count}</span>`;
  html += `</div>`;
  html += `<div class="screen-detail-body ${isCollapsed ? "collapsed" : ""}">${contentHtml.html}</div>`;
  html += `</div>`;
  return html;
}

function buildScreenDetails(details, isCurrent, roles, screenUrl) {
  let html = "";

  // Roles (skip if already shown inline as Public/Registered badge)
  const isInlineRole = roles && roles.length === 1 && (roles[0] === 'Public' || roles[0] === 'Registered');
  if (roles && roles.length > 0 && !isInlineRole) {
    html += buildSubSection(screenUrl, "roles", "Roles", {
      count: roles.length,
      html: `<div class="screen-detail-item screen-roles-list">${buildRoleBadges(roles)}</div>`
    });
  }

  // Input Parameters
  if (details.inputParameters.length > 0) {
    let items = "";
    for (const v of details.inputParameters) items += buildScreenVarItem(v, isCurrent);
    html += buildSubSection(screenUrl, "inputParams", "Input Parameters", {
      count: details.inputParameters.length, html: items
    });
  }

  // Local Variables
  if (details.localVariables.length > 0) {
    let items = "";
    for (const v of details.localVariables) items += buildScreenVarItem(v, isCurrent);
    html += buildSubSection(screenUrl, "localVars", "Local Variables", {
      count: details.localVariables.length, html: items
    });
  }

  // Aggregates
  if (details.aggregates.length > 0) {
    let items = "";
    for (const a of details.aggregates) {
      items += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(a.name)}</span>
      </div>`;
    }
    html += buildSubSection(screenUrl, "aggregates", "Aggregates", {
      count: details.aggregates.length, html: items
    });
  }

  // Data Actions
  if (details.dataActions && details.dataActions.length > 0) {
    let items = "";
    for (const da of details.dataActions) {
      items += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(da.name)}</span>
      </div>`;
    }
    html += buildSubSection(screenUrl, "dataActions", "Data Actions", {
      count: details.dataActions.length, html: items
    });
  }

  // Server Actions
  if (details.serverActions.length > 0) {
    let items = "";
    for (const sa of details.serverActions) {
      items += `<div class="screen-detail-item">
        <span class="screen-detail-name">${esc(sa.name)}</span>
      </div>`;
    }
    html += buildSubSection(screenUrl, "serverActions", "Server Actions", {
      count: details.serverActions.length, html: items
    });
  }

  // Screen Actions
  if (details.screenActions.length > 0) {
    let items = "";
    for (const ca of details.screenActions) {
      if (isCurrent && ca.methodName) {
        items += buildScreenActionItem(ca);
      } else {
        items += `<div class="screen-detail-item">
          <span class="screen-detail-name">${esc(ca.name)}</span>
        </div>`;
      }
    }
    html += buildSubSection(screenUrl, "screenActions", "Screen Actions", {
      count: details.screenActions.length, html: items
    });
  }

  // If no details at all
  const hasDataActions = details.dataActions && details.dataActions.length > 0;
  const hasRoles = roles && roles.length > 0 && !isInlineRole;
  if (!hasRoles && details.inputParameters.length === 0 && details.localVariables.length === 0 &&
    details.aggregates.length === 0 && !hasDataActions && details.serverActions.length === 0 &&
    details.screenActions.length === 0) {
    html += `<div class="screen-details-empty">No details found for this screen.</div>`;
  }

  return html;
}
