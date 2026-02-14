/**
 * sections/screens/editing.js — Screen variable editing helpers.
 *
 * Handles setting screen variable values and updating cached data.
 */

import { sendMessage } from '../../utils/helpers.js';
import { flashRow, toast } from '../../utils/ui.js';
import { state } from './state.js';

/** Send a SET_SCREEN_VAR message and handle the response. */
export async function doSetScreenVar(internalName, rawValue, dataType, rowEl) {
  try {
    const result = await sendMessage({
      action: "SET_SCREEN_VAR",
      internalName,
      value: rawValue,
      dataType,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to set value.");
    }

    // Update cached live value
    updateCachedVarValue(internalName, result.newValue);

    flashRow(rowEl, "saved");
    toast(`Variable updated`, "success");
    return true;
  } catch (err) {
    flashRow(rowEl, "error");
    toast(err.message, "error");
    return false;
  }
}

/** Commit an input's value to the runtime. */
export async function commitScreenVarInput(input) {
  const row = input.closest(".screen-var-row");
  const ok = await doSetScreenVar(
    input.dataset.internalName, input.value, input.dataset.type, row
  );
  if (ok) {
    input.dataset.original = input.value;
  } else {
    input.value = input.dataset.original;
  }
}

/** Update the cached variable value in the screen's details. */
function updateCachedVarValue(internalName, newValue) {
  for (const screen of state.allScreens) {
    if (screen.details) {
      for (const v of [...screen.details.inputParameters, ...screen.details.localVariables]) {
        if (v.internalName === internalName) {
          v.value = newValue;
          return;
        }
      }
    }
  }
}
