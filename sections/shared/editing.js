/**
 * sections/shared/editing.js — Variable editing helpers.
 *
 * Handles setting variable values and updating cached data.
 * Used by both screens and blocks sections.
 */

import { sendMessage } from '../../utils/helpers.js';
import { flashRow, toast } from '../../utils/ui.js';

/**
 * Send a SET_SCREEN_VAR message and handle the response.
 *
 * @param {string} internalName - The internal variable name
 * @param {*} rawValue - The new value
 * @param {string} dataType - The OS data type
 * @param {Element} rowEl - The row element for visual feedback
 * @param {number} [viewIndex] - The view instance index
 * @param {Function} [onSuccess] - Callback on success: (internalName, newValue) => void
 */
export async function doSetVar(internalName, rawValue, dataType, rowEl, viewIndex, onSuccess) {
  try {
    const result = await sendMessage({
      action: "SET_SCREEN_VAR",
      internalName,
      value: rawValue,
      dataType,
      viewIndex,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to set value.");
    }

    if (onSuccess) onSuccess(internalName, result.newValue);

    flashRow(rowEl, "saved");
    toast(`Variable updated`, "success");
    return true;
  } catch (err) {
    flashRow(rowEl, "error");
    toast(err.message, "error");
    return false;
  }
}

/**
 * Commit an input's value to the runtime.
 *
 * @param {HTMLInputElement} input - The input element
 * @param {number} [viewIndex] - The view instance index
 * @param {Function} [onSuccess] - Callback on success: (internalName, newValue) => void
 */
export async function commitVarInput(input, viewIndex, onSuccess) {
  const row = input.closest(".screen-var-row");
  const ok = await doSetVar(
    input.dataset.internalName, input.value, input.dataset.type, row, viewIndex, onSuccess
  );
  if (ok) {
    input.dataset.original = input.value;
  } else {
    input.value = input.dataset.original;
  }
}

/**
 * Send a SET_SCREEN_VAR_DEEP message for a data action output field.
 *
 * @param {string} varAttrName - The variable attribute name
 * @param {string} outputAttrName - The output attribute name
 * @param {*} rawValue - The new value
 * @param {string} dataType - The OS data type
 * @param {Element} rowEl - The row element for visual feedback
 * @param {number} [viewIndex] - The view instance index
 */
export async function doSetDataActionOutput(varAttrName, outputAttrName, rawValue, dataType, rowEl, viewIndex) {
  try {
    const result = await sendMessage({
      action: "SET_SCREEN_VAR_DEEP",
      internalName: varAttrName,
      path: [outputAttrName],
      value: rawValue,
      dataType,
      viewIndex,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to set output value.");
    }

    flashRow(rowEl, "saved");
    toast("Output updated", "success");
    return true;
  } catch (err) {
    flashRow(rowEl, "error");
    toast(err.message, "error");
    return false;
  }
}

/**
 * Commit a data action output input's value to the runtime.
 *
 * @param {HTMLInputElement} input - The input element
 * @param {number} [viewIndex] - The view instance index
 */
export async function commitDataActionOutputInput(input, viewIndex) {
  const row = input.closest(".data-action-output-row");
  const varAttrName = input.dataset.varAttrName || row?.dataset.varAttrName;
  const outputAttrName = input.dataset.outputAttrName;
  if (!varAttrName || !outputAttrName) return;
  const ok = await doSetDataActionOutput(
    varAttrName, outputAttrName, input.value, input.dataset.type, row, viewIndex
  );
  if (ok) {
    input.dataset.original = input.value;
  } else {
    input.value = input.dataset.original;
  }
}
