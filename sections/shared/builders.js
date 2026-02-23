/**
 * sections/shared/builders.js — Shared item builder functions.
 *
 * Builds HTML for variable items, action items, and action parameter rows.
 * Used by both screens and blocks sections.
 */

import { esc, escAttr } from '../../utils/helpers.js';
import { buildTypeControl } from '../../utils/typeControls.js';

/**
 * Build a single variable/input param item.
 * If isLive is true and the variable has a live value, show editable controls.
 */
export function buildVarItem(v, isLive) {
  const hasLiveValue = isLive && v.value !== undefined;

  // If not live or no live value, show simple display
  if (!hasLiveValue) {
    return `<div class="screen-detail-item">
      <span class="screen-detail-name">${esc(v.name)}</span>
      <span class="screen-detail-type">${esc(v.type)}</span>
    </div>`;
  }

  // Live with value — show editable control
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
 * Build an interactive action item.
 * Shows the action name, Run button, input parameters (editable),
 * and local variables (read-only display).
 *
 * @param {Object} action - The action object
 * @param {Object} expandedActions - Map of methodName -> true/false
 */
export function buildClientActionItem(action, expandedActions) {
  const hasInputs = action.inputs && action.inputs.length > 0;
  const hasLocals = action.locals && action.locals.length > 0;
  const hasBody = hasInputs || hasLocals;
  const isExpanded = !!expandedActions[action.methodName];

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
 * Build an interactive data action item.
 * Shows the data action name, Run button, and output parameters (editable).
 *
 * @param {Object} dataAction - The data action object
 * @param {Object} expandedDataActions - Map of refreshMethodName -> true/false
 */
export function buildDataActionItem(dataAction, expandedDataActions) {
  const hasOutputs = dataAction.outputs && dataAction.outputs.length > 0;
  const isExpanded = !!expandedDataActions[dataAction.refreshMethodName];

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

/**
 * Build an interactive server action item.
 * Shows the server action name, Run button, input parameters (editable),
 * and output parameters (read-only initially, values shown after invocation).
 *
 * @param {Object} serverAction - The server action object
 * @param {Object} expandedServerActions - Map of methodName -> true/false
 */
export function buildServerActionItem(serverAction, expandedServerActions) {
  const hasInputs = serverAction.inputs && serverAction.inputs.length > 0;
  const hasOutputs = serverAction.outputs && serverAction.outputs.length > 0;
  const hasBody = hasInputs || hasOutputs;
  const isExpanded = !!expandedServerActions[serverAction.methodName];

  let html = `<div class="screen-action-item server-action-item ${isExpanded ? "expanded" : ""}" data-method="${escAttr(serverAction.methodName)}">`;
  html += `<div class="screen-action-header server-action-header">`;
  if (hasBody) {
    html += `<svg class="screen-action-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
  html += `<span class="screen-detail-name">${esc(serverAction.name)}</span>`;
  html += `<button class="btn-trigger-action btn-trigger-server-action" data-method="${escAttr(serverAction.methodName)}" title="Run ${esc(serverAction.name)}">`;
  html += `<svg class="action-play-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  html += `<span class="action-btn-label">Run</span>`;
  html += `</button>`;
  html += `</div>`;

  if (hasBody) {
    html += `<div class="screen-action-body-wrap ${isExpanded ? "" : "collapsed"}">`;

    // Input Parameters — editable
    if (hasInputs) {
      html += `<div class="screen-action-body screen-action-inputs">`;
      html += `<div class="screen-action-sub-header">Input Parameters</div>`;
      for (const p of serverAction.inputs) {
        html += buildActionParamRow({
          name: p.name,
          attrName: p.paramName || p.name,
          dataType: p.dataType,
          mandatory: false,
        }, serverAction.methodName);
      }
      html += `</div>`;
    }

    // Output Parameters — read-only display (name + type + value after invocation)
    if (hasOutputs) {
      html += `<div class="screen-action-body server-action-outputs">`;
      html += `<div class="screen-action-sub-header">Output Parameters</div>`;
      for (const o of serverAction.outputs) {
        html += buildServerActionOutputRow(o);
      }
      html += `</div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Build a single server action output parameter row.
 * Read-only display of name, type, and value (if available after invocation).
 */
export function buildServerActionOutputRow(output) {
  const isComplex = ["Record", "RecordList", "Object", "BinaryData"].includes(output.dataType);
  const hasValue = output.value !== null && output.value !== undefined;

  let valueHtml;
  if (isComplex) {
    valueHtml = `<span class="screen-detail-type">${esc(output.dataType)}</span>`;
  } else if (hasValue) {
    valueHtml = `<input class="var-value server-action-output-value" type="text"
                        value="${escAttr(String(output.value))}" readonly
                        data-output-attr-name="${escAttr(output.attrName)}" />`;
  } else {
    valueHtml = `<span class="server-action-output-placeholder" data-output-attr-name="${escAttr(output.attrName)}">--</span>`;
  }

  return `<div class="screen-detail-item screen-var-row server-action-output-row"
               data-output-attr-name="${escAttr(output.attrName)}">
    <div class="screen-var-info">
      <span class="screen-detail-name">${esc(output.name)}</span>
      <span class="screen-detail-type">${esc(output.dataType)}</span>
    </div>
    <div class="screen-var-value-wrap">
      ${valueHtml}
    </div>
  </div>`;
}

/**
 * Build an interactive aggregate item.
 * Shows the aggregate name, Run button, and output parameters.
 *
 * @param {Object} aggregate - The aggregate object
 * @param {Object} expandedAggregates - Map of refreshMethodName -> true/false
 */
export function buildAggregateItem(aggregate, expandedAggregates) {
  const hasOutputs = aggregate.outputs && aggregate.outputs.length > 0;
  const isExpanded = !!expandedAggregates[aggregate.refreshMethodName];

  let html = `<div class="screen-action-item aggregate-item ${isExpanded ? "expanded" : ""}" data-refresh-method="${escAttr(aggregate.refreshMethodName)}">`;
  html += `<div class="screen-action-header aggregate-header">`;
  if (hasOutputs) {
    html += `<svg class="screen-action-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
  html += `<span class="screen-detail-name">${esc(aggregate.name)}</span>`;
  html += `<button class="btn-trigger-action btn-trigger-aggregate" data-refresh-method="${escAttr(aggregate.refreshMethodName)}" title="Refresh ${esc(aggregate.name)}">`;
  html += `<svg class="action-play-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  html += `<span class="action-btn-label">Run</span>`;
  html += `</button>`;
  html += `</div>`;

  if (hasOutputs) {
    html += `<div class="screen-action-body-wrap ${isExpanded ? "" : "collapsed"}">`;
    html += `<div class="screen-action-body screen-action-inputs">`;
    html += `<div class="screen-action-sub-header">Output</div>`;
    for (const o of aggregate.outputs) {
      html += buildAggregateOutputRow(o, aggregate.varAttrName);
    }
    html += `</div>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Build a single aggregate output parameter row.
 * Reuses data-action-output CSS classes so existing event handlers apply.
 */
export function buildAggregateOutputRow(output, varAttrName) {
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
