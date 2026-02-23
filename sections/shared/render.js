/**
 * sections/shared/render.js — Shared rendering functions.
 *
 * Builds detail panels (sub-sections, variable lists, action cards) that are
 * used by both screens and blocks sections.
 */

import { esc, escAttr } from '../../utils/helpers.js';
import { buildVarItem, buildClientActionItem, buildDataActionItem, buildAggregateItem, buildServerActionItem } from './builders.js';

/**
 * Build a collapsible sub-section (e.g. "Input Parameters", "Aggregates").
 *
 * @param {string} entityKey - The parent entity key (screenUrl or blockId) for state tracking
 * @param {string} key - Sub-section key (e.g. "inputParams", "aggregates")
 * @param {string} title - Display title
 * @param {Object} contentHtml - { count: number, html: string }
 * @param {Object} collapsedSubSections - Map of "entityKey::key" -> true/false
 */
export function buildSubSection(entityKey, key, title, contentHtml, collapsedSubSections) {
  const stateKey = entityKey + "::" + key;
  const isCollapsed = !!collapsedSubSections[stateKey];
  let html = `<div class="screen-detail-section ${isCollapsed ? "sub-collapsed" : ""}" data-entity-key="${escAttr(entityKey)}" data-sub-key="${escAttr(key)}">`;
  html += `<div class="screen-detail-header screen-detail-header-toggle">`;
  html += `<svg class="screen-sub-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  html += `${esc(title)}<span class="count-badge screen-sub-count">${contentHtml.count}</span>`;
  html += `</div>`;
  html += `<div class="screen-detail-body ${isCollapsed ? "collapsed" : ""}">${contentHtml.html}</div>`;
  html += `</div>`;
  return html;
}

/**
 * Build the full details panel for a screen or block.
 *
 * @param {Object} details - The parsed details (inputParameters, localVariables, aggregates, dataActions, serverActions, screenActions)
 * @param {boolean} isLive - Whether this entity is live (enables editable controls)
 * @param {Array|null} roles - Role requirements (null for blocks)
 * @param {string} entityKey - The entity key for state tracking
 * @param {Object} collapsedSubSections - Map of "entityKey::key" -> true/false
 * @param {Object} expansionMaps - { actions, dataActions, aggregates, serverActions }
 * @param {Function} [buildRoleBadges] - Optional function to build role badges HTML
 */
export function buildDetails(details, isLive, roles, entityKey, collapsedSubSections, expansionMaps, buildRoleBadges) {
  let html = "";

  // Roles (skip if already shown inline as Public/Registered badge)
  const isInlineRole = roles && roles.length === 1 && (roles[0] === 'Public' || roles[0] === 'Registered');
  if (roles && roles.length > 0 && !isInlineRole && buildRoleBadges) {
    html += buildSubSection(entityKey, "roles", "Roles", {
      count: roles.length,
      html: `<div class="screen-detail-item screen-roles-list">${buildRoleBadges(roles)}</div>`
    }, collapsedSubSections);
  }

  // Input Parameters
  if (details.inputParameters.length > 0) {
    let items = "";
    for (const v of details.inputParameters) items += buildVarItem(v, isLive);
    html += buildSubSection(entityKey, "inputParams", "Input Parameters", {
      count: details.inputParameters.length, html: items
    }, collapsedSubSections);
  }

  // Local Variables
  if (details.localVariables.length > 0) {
    let items = "";
    for (const v of details.localVariables) items += buildVarItem(v, isLive);
    html += buildSubSection(entityKey, "localVars", "Local Variables", {
      count: details.localVariables.length, html: items
    }, collapsedSubSections);
  }

  // Aggregates
  if (details.aggregates.length > 0) {
    let items = "";
    for (const a of details.aggregates) {
      if (isLive && a.refreshMethodName) {
        items += buildAggregateItem(a, expansionMaps.aggregates);
      } else {
        items += `<div class="screen-detail-item">
          <span class="screen-detail-name">${esc(a.name)}</span>
        </div>`;
      }
    }
    html += buildSubSection(entityKey, "aggregates", "Aggregates", {
      count: details.aggregates.length, html: items
    }, collapsedSubSections);
  }

  // Data Actions
  if (details.dataActions && details.dataActions.length > 0) {
    let items = "";
    for (const da of details.dataActions) {
      if (isLive && da.refreshMethodName) {
        items += buildDataActionItem(da, expansionMaps.dataActions);
      } else {
        items += `<div class="screen-detail-item">
          <span class="screen-detail-name">${esc(da.name)}</span>
        </div>`;
      }
    }
    html += buildSubSection(entityKey, "dataActions", "Data Actions", {
      count: details.dataActions.length, html: items
    }, collapsedSubSections);
  }

  // Server Actions
  if (details.serverActions.length > 0) {
    let items = "";
    for (const sa of details.serverActions) {
      if (isLive && sa.methodName) {
        items += buildServerActionItem(sa, expansionMaps.serverActions);
      } else {
        items += `<div class="screen-detail-item">
          <span class="screen-detail-name">${esc(sa.name)}</span>
        </div>`;
      }
    }
    html += buildSubSection(entityKey, "serverActions", "Server Actions", {
      count: details.serverActions.length, html: items
    }, collapsedSubSections);
  }

  // Screen Actions (client actions)
  if (details.screenActions.length > 0) {
    let items = "";
    for (const ca of details.screenActions) {
      if (isLive && ca.methodName) {
        items += buildClientActionItem(ca, expansionMaps.actions);
      } else {
        items += `<div class="screen-detail-item">
          <span class="screen-detail-name">${esc(ca.name)}</span>
        </div>`;
      }
    }
    html += buildSubSection(entityKey, "screenActions", "Screen Actions", {
      count: details.screenActions.length, html: items
    }, collapsedSubSections);
  }

  // If no details at all
  const hasDataActions = details.dataActions && details.dataActions.length > 0;
  const hasRoles = roles && roles.length > 0 && !isInlineRole;
  if (!hasRoles && details.inputParameters.length === 0 && details.localVariables.length === 0 &&
    details.aggregates.length === 0 && !hasDataActions && details.serverActions.length === 0 &&
    details.screenActions.length === 0) {
    html += `<div class="screen-details-empty">No details found.</div>`;
  }

  return html;
}
