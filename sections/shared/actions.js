/**
 * sections/shared/actions.js — Action invocation and refresh.
 *
 * Collects parameter values from the UI and triggers actions.
 * Used by both screens and blocks sections.
 */

import { sendMessage } from '../../utils/helpers.js';
import { flashRow, toast } from '../../utils/ui.js';
import { buildDataActionOutputRow, buildAggregateOutputRow, buildServerActionOutputRow } from './builders.js';

/**
 * Collect parameter values from an action item's inputs section.
 * Shared by invokeScreenAction and invokeServerAction.
 */
function collectParamValues(actionItem) {
  const paramValues = [];
  const inputsSection = actionItem.querySelector(".screen-action-inputs");
  if (inputsSection) {
    const paramRows = inputsSection.querySelectorAll(".screen-action-param-row");
    paramRows.forEach(row => {
      const input = row.querySelector(".action-param-input");
      const toggle = row.querySelector(".action-param-toggle");
      const popupBtn = row.querySelector(".btn-action-param-popup");

      if (popupBtn) {
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
  return paramValues;
}

/**
 * Show/hide loading state on a trigger button.
 */
function setButtonLoading(triggerBtn, loading) {
  const label = triggerBtn.querySelector(".action-btn-label");
  if (loading) {
    triggerBtn.disabled = true;
    if (label) {
      if (!triggerBtn._origLabel) triggerBtn._origLabel = label.textContent;
      label.textContent = "...";
    }
    triggerBtn.classList.add("running");
  } else {
    triggerBtn.disabled = false;
    if (label) label.textContent = triggerBtn._origLabel || "Run";
    triggerBtn.classList.remove("running");
  }
}

/**
 * Invoke a screen action via the trigger button.
 *
 * @param {Element} triggerBtn - The trigger button element
 * @param {number} [viewIndex] - The view instance index
 * @param {Function} [onCacheUpdate] - Optional callback to update cached details
 */
export async function invokeScreenAction(triggerBtn, viewIndex, onCacheUpdate) {
  const methodName = triggerBtn.dataset.method;
  const actionItem = triggerBtn.closest(".screen-action-item");
  if (!actionItem) return;

  const paramValues = collectParamValues(actionItem);
  setButtonLoading(triggerBtn, true);

  try {
    const result = await sendMessage({
      action: "INVOKE_SCREEN_ACTION",
      methodName,
      paramValues,
      viewIndex,
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
    setButtonLoading(triggerBtn, false);
  }
}

/**
 * Refresh a data action and update its output values in the UI.
 *
 * @param {Element} triggerBtn - The trigger button element
 * @param {number} [viewIndex] - The view instance index
 * @param {Function} [onCacheUpdate] - Callback to update cached details: (refreshMethodName, updated) => void
 */
export async function refreshDataAction(triggerBtn, viewIndex, onCacheUpdate) {
  const refreshMethodName = triggerBtn.dataset.refreshMethod;
  const actionItem = triggerBtn.closest(".data-action-item");
  if (!actionItem || !refreshMethodName) return;

  setButtonLoading(triggerBtn, true);

  try {
    const result = await sendMessage({
      action: "REFRESH_DATA_ACTION",
      refreshMethodName,
      viewIndex,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Data action failed.");
    }

    // Re-fetch output values to update the UI
    const liveResult = await sendMessage({ action: "GET_DATA_ACTIONS", viewIndex });
    if (liveResult?.ok && liveResult.dataActions) {
      const updated = liveResult.dataActions.find(
        da => da.refreshMethodName === refreshMethodName
      );
      if (updated && updated.outputs) {
        if (onCacheUpdate) onCacheUpdate(refreshMethodName, updated);

        // Re-render the output rows in place
        const bodyWrap = actionItem.querySelector(".screen-action-body-wrap");
        if (bodyWrap && updated.varAttrName) {
          let outputsHtml = `<div class="screen-action-body screen-action-inputs">`;
          outputsHtml += `<div class="screen-action-sub-header">Output Parameters</div>`;
          for (const o of updated.outputs) {
            outputsHtml += buildDataActionOutputRow(o, updated.varAttrName);
          }
          outputsHtml += `</div>`;
          bodyWrap.innerHTML = outputsHtml;
        }
      }
    }

    flashRow(actionItem, "saved");
    toast("Data action refreshed", "success");
  } catch (err) {
    flashRow(actionItem, "error");
    toast(err.message, "error");
  } finally {
    setButtonLoading(triggerBtn, false);
  }
}

/**
 * Refresh an aggregate and update its output values in the UI.
 *
 * @param {Element} triggerBtn - The trigger button element
 * @param {number} [viewIndex] - The view instance index
 * @param {Function} [onCacheUpdate] - Callback to update cached details: (refreshMethodName, updated) => void
 */
export async function refreshAggregate(triggerBtn, viewIndex, onCacheUpdate) {
  const refreshMethodName = triggerBtn.dataset.refreshMethod;
  const actionItem = triggerBtn.closest(".aggregate-item");
  if (!actionItem || !refreshMethodName) return;

  setButtonLoading(triggerBtn, true);

  try {
    const result = await sendMessage({
      action: "REFRESH_AGGREGATE",
      refreshMethodName,
      viewIndex,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Aggregate refresh failed.");
    }

    // Re-fetch output values to update the UI
    const liveResult = await sendMessage({ action: "GET_AGGREGATES", viewIndex });
    if (liveResult?.ok && liveResult.aggregates) {
      const updated = liveResult.aggregates.find(
        a => a.refreshMethodName === refreshMethodName
      );
      if (updated) {
        if (onCacheUpdate) onCacheUpdate(refreshMethodName, updated);

        // Re-render the output in place
        const bodyWrap = actionItem.querySelector(".screen-action-body-wrap");
        if (bodyWrap && updated.outputs && updated.outputs.length > 0 && updated.varAttrName) {
          let bodyHtml = `<div class="screen-action-body screen-action-inputs">`;
          bodyHtml += `<div class="screen-action-sub-header">Output</div>`;
          for (const o of updated.outputs) {
            bodyHtml += buildAggregateOutputRow(o, updated.varAttrName);
          }
          bodyHtml += `</div>`;
          bodyWrap.innerHTML = bodyHtml;
        }
      }
    }

    flashRow(actionItem, "saved");
    toast("Aggregate refreshed", "success");
  } catch (err) {
    flashRow(actionItem, "error");
    toast(err.message, "error");
  } finally {
    setButtonLoading(triggerBtn, false);
  }
}

/**
 * Invoke a server action via the trigger button.
 *
 * @param {Element} triggerBtn - The trigger button element
 * @param {number} [viewIndex] - The view instance index
 * @param {Function} [onCacheUpdate] - Callback to update cached details: (methodName, outputs) => void
 */
export async function invokeServerAction(triggerBtn, viewIndex, onCacheUpdate) {
  const methodName = triggerBtn.dataset.method;
  const actionItem = triggerBtn.closest(".server-action-item");
  if (!actionItem) return;

  const paramValues = collectParamValues(actionItem);
  setButtonLoading(triggerBtn, true);

  try {
    const result = await sendMessage({
      action: "INVOKE_SERVER_ACTION",
      methodName,
      paramValues,
      viewIndex,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || "Server action failed.");
    }

    // Update output parameter rows with returned values
    if (result.outputs && result.outputs.length > 0) {
      if (onCacheUpdate) onCacheUpdate(methodName, result.outputs);

      // Re-render the output rows in place
      const outputsSection = actionItem.querySelector(".server-action-outputs");
      if (outputsSection) {
        let outputsHtml = `<div class="screen-action-sub-header">Output Parameters</div>`;
        for (const o of result.outputs) {
          outputsHtml += buildServerActionOutputRow(o);
        }
        outputsSection.innerHTML = outputsHtml;
      }
    }

    flashRow(actionItem, "saved");
    toast("Server action completed", "success");
  } catch (err) {
    flashRow(actionItem, "error");
    toast(err.message, "error");
  } finally {
    setButtonLoading(triggerBtn, false);
  }
}
