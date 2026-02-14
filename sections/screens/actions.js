/**
 * sections/screens/actions.js — Screen action invocation.
 *
 * Collects parameter values from the UI and triggers screen actions.
 */

import { sendMessage } from '../../utils/helpers.js';
import { flashRow, toast } from '../../utils/ui.js';

/**
 * Invoke a screen action via the trigger button.
 * Collects param values from input parameter rows and sends INVOKE_SCREEN_ACTION.
 */
export async function invokeScreenAction(triggerBtn) {
  const methodName = triggerBtn.dataset.method;
  const actionItem = triggerBtn.closest(".screen-action-item");
  if (!actionItem) return;

  // Collect parameter values from the inputs section only (not locals)
  const paramValues = [];
  const inputsSection = actionItem.querySelector(".screen-action-inputs");
  if (inputsSection) {
    const paramRows = inputsSection.querySelectorAll(".screen-action-param-row");
    paramRows.forEach(row => {
      const input = row.querySelector(".action-param-input");
      const toggle = row.querySelector(".action-param-toggle");
      const popupBtn = row.querySelector(".btn-action-param-popup");

      if (popupBtn) {
        // Complex type — value is stored in page's temp map
        paramValues.push({
          value: null,
          dataType: popupBtn.dataset.type || "Record",
          attrName: popupBtn.dataset.attrName,
          isComplex: true,
        });
      } else if (input) {
        paramValues.push({
          value: input.value,
          dataType: input.dataset.type || "Text",
        });
      } else if (toggle) {
        paramValues.push({
          value: toggle.classList.contains("active"),
          dataType: "Boolean",
        });
      }
    });
  }

  // Visual feedback: show loading state
  triggerBtn.disabled = true;
  const label = triggerBtn.querySelector(".action-btn-label");
  const origLabel = label ? label.textContent : "";
  if (label) label.textContent = "...";
  triggerBtn.classList.add("running");

  try {
    const result = await sendMessage({
      action: "INVOKE_SCREEN_ACTION",
      methodName,
      paramValues,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Action failed.");
    }

    flashRow(actionItem, "saved");
    toast("Action triggered", "success");
  } catch (err) {
    flashRow(actionItem, "error");
    toast(err.message, "error");
  } finally {
    triggerBtn.disabled = false;
    if (label) label.textContent = origLabel;
    triggerBtn.classList.remove("running");
  }
}
