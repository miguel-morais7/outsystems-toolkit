/**
 * utils/typeControls.js — Shared type-control builder
 *
 * Builds HTML for type-appropriate input controls (Boolean toggles,
 * date/time pickers, text/number inputs, complex-type inspect buttons).
 * Shared between the screens section and action parameter editing.
 */

import { esc, escAttr, formatDateForInput } from './helpers.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Data types that are displayed as read-only inspect buttons. */
export const READ_ONLY_TYPES = ["RecordList", "Record", "Object", "BinaryData"];

/** SVG icon for the complex-type inspect button. */
export const INSPECT_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M15 3h6v6"/><path d="M10 14L21 3"/>
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
</svg>`;

/* ------------------------------------------------------------------ */
/*  Builder                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the HTML for a type-appropriate input control.
 * Shared between screen variables and action parameters.
 *
 * @param {Object} opts
 * @param {string} opts.dataType - OS type name
 * @param {*}      [opts.value] - Current display value (null/undefined for empty)
 * @param {string} opts.identifier - Data attribute value (internalName or attrName)
 * @param {string} opts.identifierAttr - Data attribute name (e.g. "data-internal-name")
 * @param {string} opts.inputClass - CSS class for the input (e.g. "screen-var-input" or "action-param-input")
 * @param {string} opts.toggleClass - CSS class for boolean toggle (e.g. "screen-var-toggle" or "action-param-toggle")
 * @param {string} opts.name - Display name (for inspect button title)
 * @param {string} [opts.methodName] - Action method name (for action param inspect buttons)
 * @param {boolean} [opts.isReadOnly] - Whether the control is read-only
 * @param {string}  [opts.extraAttrs] - Additional HTML attributes to inject (e.g. 'data-module="Foo"')
 * @returns {string} HTML string
 */
export function buildTypeControl(opts) {
  const { dataType, value, identifier, identifierAttr, inputClass, toggleClass, name, methodName, isReadOnly, extraAttrs = "" } = opts;
  const isComplex = READ_ONLY_TYPES.includes(dataType);

  if (dataType === "Boolean" && !isComplex) {
    const active = value === true || value === "true" || value === "True";
    return `<button class="bool-toggle ${escAttr(toggleClass)} ${active ? "active" : ""}"
                    ${identifierAttr}="${escAttr(identifier)}" data-type="Boolean"
                    ${extraAttrs} ${isReadOnly ? "disabled" : ""}>
              <span class="knob"></span>
            </button>`;
  }

  if ((dataType === "Date" || dataType === "Time" || dataType === "Date Time") && !isComplex) {
    const inputType = dataType === "Date" ? "date" : dataType === "Time" ? "time" : "datetime-local";
    const displayValue = value != null ? formatDateForInput(value, dataType) : "";
    return `<input class="var-value var-value-date screen-var-date ${escAttr(inputClass)}"
                   type="${inputType}"
                   value="${escAttr(displayValue)}"
                   ${identifierAttr}="${escAttr(identifier)}"
                   data-type="${escAttr(dataType)}"
                   data-original="${escAttr(displayValue)}"
                   ${extraAttrs}
                   ${isReadOnly ? "readonly" : ""}
                   ${dataType === "Time" ? 'step="1"' : ""} />`;
  }

  if (isComplex) {
    // Complex types — show inspect popup button
    if (methodName) {
      // Action parameter complex type
      return `<button class="btn-icon btn-action-param-popup"
                      data-method="${escAttr(methodName)}"
                      data-attr-name="${escAttr(identifier)}"
                      data-type="${escAttr(dataType)}"
                      data-name="${escAttr(name)}"
                      title="Inspect ${esc(name)}">
                ${INSPECT_ICON_SVG}
              </button>`;
    }
    // Screen variable complex type
    return `<button class="btn-icon btn-var-popup"
                    data-internal-name="${escAttr(identifier)}"
                    data-type="${escAttr(dataType)}"
                    data-name="${escAttr(name)}"
                    title="Inspect ${esc(name)}">
              ${INSPECT_ICON_SVG}
            </button>`;
  }

  // Numeric types → number input
  const isNumeric = ["Integer", "Decimal", "Currency", "Long Integer"].includes(dataType);
  const inputType = isNumeric ? "number" : "text";
  const step = (dataType === "Decimal" || dataType === "Currency") ? 'step="any"' : "";
  const displayValue = value != null ? String(value) : "";
  return `<input class="var-value ${escAttr(inputClass)}"
                 type="${inputType}"
                 value="${escAttr(displayValue)}"
                 ${identifierAttr}="${escAttr(identifier)}"
                 data-type="${escAttr(dataType)}"
                 data-original="${escAttr(displayValue)}"
                 ${step} ${extraAttrs}
                 ${isReadOnly ? "readonly" : ""} />`;
}
