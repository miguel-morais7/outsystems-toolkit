/**
 * sections/screens/builders.js — Item builder functions.
 *
 * Builds HTML for screen variable items, action items, and action parameter rows.
 */

import { esc, escAttr } from '../../utils/helpers.js';
import { buildTypeControl } from '../../utils/typeControls.js';
import { state } from './state.js';

/**
 * Build a single variable/input param item.
 * If isCurrent is true and the variable has a live value, show editable controls.
 */
export function buildScreenVarItem(v, isCurrent) {
  const hasLiveValue = isCurrent && v.value !== undefined;

  // If not the current screen or no live value, show simple display
  if (!hasLiveValue) {
    return `<div class="screen-detail-item">
      <span class="screen-detail-name">${esc(v.name)}</span>
      <span class="screen-detail-type">${esc(v.type)}</span>
    </div>`;
  }

  // Current screen with live value — show editable control
  const valueControl = buildTypeControl({
    dataType: v.type,
    value: v.value,
    identifier: v.internalName,
    identifierAttr: "data-internal-name",
    inputClass: "screen-var-input",
    toggleClass: "screen-var-toggle",
    name: v.name,
    isReadOnly: v.readOnly,
  });

  return `<div class="screen-detail-item screen-var-row" data-internal-name="${escAttr(v.internalName)}">
    <div class="screen-var-info">
      <span class="screen-detail-name">${esc(v.name)}</span>
      <span class="screen-detail-type">${esc(v.type)}</span>
    </div>
    <div class="screen-var-value-wrap">
      ${valueControl}
    </div>
  </div>`;
}

/**
 * Build an interactive action item for the current screen.
 * Shows the action name, Run button, input parameters (editable),
 * and local variables (read-only display).
 */
export function buildScreenActionItem(action) {
  const hasInputs = action.inputs && action.inputs.length > 0;
  const hasLocals = action.locals && action.locals.length > 0;
  const hasBody = hasInputs || hasLocals;
  const isExpanded = !!state.expandedActions[action.methodName];

  let html = `<div class="screen-action-item ${isExpanded ? "expanded" : ""}" data-method="${escAttr(action.methodName)}">`;
  html += `<div class="screen-action-header">`;
  if (hasBody) {
    html += `<svg class="screen-action-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
  html += `<span class="screen-detail-name">${esc(action.name)}</span>`;
  html += `<button class="btn-trigger-action" data-method="${escAttr(action.methodName)}" title="Trigger ${esc(action.name)}">`;
  html += `<svg class="action-play-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  html += `<span class="action-btn-label">Run</span>`;
  html += `</button>`;
  html += `</div>`;

  if (hasBody) {
    html += `<div class="screen-action-body-wrap ${isExpanded ? "" : "collapsed"}">`;

    // Input Parameters — editable, same controls as screen variables
    if (hasInputs) {
      html += `<div class="screen-action-body screen-action-inputs">`;
      html += `<div class="screen-action-sub-header">Input Parameters</div>`;
      for (const p of action.inputs) {
        html += buildActionParamRow(p, action.methodName);
      }
      html += `</div>`;
    }

    // Local Variables — read-only display (name + type)
    if (hasLocals) {
      html += `<div class="screen-action-body screen-action-locals">`;
      html += `<div class="screen-action-sub-header">Local Variables</div>`;
      for (const l of action.locals) {
        html += `<div class="screen-detail-item">
          <span class="screen-detail-name">${esc(l.name)}</span>
          <span class="screen-detail-type">${esc(l.dataType)}</span>
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Build an interactive data action item for the current screen.
 * Shows the data action name, Run button, and output parameters (editable).
 */
export function buildDataActionItem(dataAction) {
  const hasOutputs = dataAction.outputs && dataAction.outputs.length > 0;
  const isExpanded = !!state.expandedDataActions[dataAction.refreshMethodName];

  let html = `<div class="screen-action-item data-action-item ${isExpanded ? "expanded" : ""}" data-refresh-method="${escAttr(dataAction.refreshMethodName)}">`;
  html += `<div class="screen-action-header data-action-header">`;
  if (hasOutputs) {
    html += `<svg class="screen-action-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
  html += `<span class="screen-detail-name">${esc(dataAction.name)}</span>`;
  html += `<button class="btn-trigger-action btn-trigger-data-action" data-refresh-method="${escAttr(dataAction.refreshMethodName)}" title="Refresh ${esc(dataAction.name)}">`;
  html += `<svg class="action-play-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  html += `<span class="action-btn-label">Run</span>`;
  html += `</button>`;
  html += `</div>`;

  if (hasOutputs) {
    html += `<div class="screen-action-body-wrap ${isExpanded ? "" : "collapsed"}">`;
    html += `<div class="screen-action-body screen-action-inputs">`;
    html += `<div class="screen-action-sub-header">Output Parameters</div>`;
    for (const o of dataAction.outputs) {
      html += buildDataActionOutputRow(o, dataAction.varAttrName);
    }
    html += `</div>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Build a single data action output parameter row with editable controls.
 */
export function buildDataActionOutputRow(output, varAttrName) {
  const valueControl = buildTypeControl({
    dataType: output.dataType,
    value: output.value,
    identifier: output.attrName,
    identifierAttr: "data-output-attr-name",
    inputClass: "data-action-output-input",
    toggleClass: "data-action-output-toggle",
    name: output.name,
    varAttrName,
    extraAttrs: `data-var-attr-name="${escAttr(varAttrName)}"`,
  });

  return `<div class="screen-detail-item screen-var-row data-action-output-row"
               data-output-attr-name="${escAttr(output.attrName)}"
               data-var-attr-name="${escAttr(varAttrName)}">
    <div class="screen-var-info">
      <span class="screen-detail-name">${esc(output.name)}</span>
      <span class="screen-detail-type">${esc(output.dataType)}</span>
    </div>
    <div class="screen-var-value-wrap">
      ${valueControl}
    </div>
  </div>`;
}

/**
 * Build a single action parameter row using the same layout as screen variable rows.
 */
export function buildActionParamRow(param, methodName) {
  const valueControl = buildTypeControl({
    dataType: param.dataType,
    value: null, // action params start empty
    identifier: param.attrName || param.name,
    identifierAttr: "data-param-name",
    inputClass: "action-param-input",
    toggleClass: "action-param-toggle",
    name: param.name,
    methodName,
  });

  return `<div class="screen-detail-item screen-var-row screen-action-param-row"
               data-param-name="${escAttr(param.attrName || param.name)}">
    <div class="screen-var-info">
      <span class="screen-detail-name">${esc(param.name)}${param.mandatory ? '<span class="action-param-required">*</span>' : ""}</span>
      <span class="screen-detail-type">${esc(param.dataType)}</span>
    </div>
    <div class="screen-var-value-wrap">
      ${valueControl}
    </div>
  </div>`;
}
