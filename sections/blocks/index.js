/**
 * sections/blocks/index.js — Entry point: init() + re-exports.
 *
 * Wires up all event listeners and re-exports the public API
 * expected by sidepanel.js: { sectionEl, init, setData, getState, render }.
 */

import { debounce } from '../../utils/helpers.js';
import { openVarPopup, openActionParamPopup, openDataActionOutputPopup } from '../screenVarPopup.js';
import { initBlockTreePopup, openBlockTreePopup } from '../blockTreePopup.js';
import { doSetVar, commitVarInput, doSetDataActionOutput, commitDataActionOutputInput } from '../shared/editing.js';
import { invokeScreenAction, refreshDataAction, refreshAggregate, invokeServerAction } from '../shared/actions.js';
import { state, inputSearch, blockList } from './state.js';
import { render } from './render.js';
import { toggleBlockExpand } from './data.js';

export { sectionEl, setData, getState } from './state.js';
export { render } from './render.js';

/**
 * Get the viewIndex for the block that contains the given element.
 */
function getViewIndex(el) {
  const blockRow = el.closest(".block-row") || el.closest(".screen-details")?.previousElementSibling;
  if (blockRow && blockRow.dataset.viewIndex) {
    return parseInt(blockRow.dataset.viewIndex, 10);
  }
  // Walk up to find the block row via the details panel
  let sibling = el.closest(".screen-details");
  if (sibling) {
    const row = sibling.previousElementSibling;
    if (row && row.dataset.viewIndex) {
      return parseInt(row.dataset.viewIndex, 10);
    }
  }
  return undefined;
}

/** Update the cached variable value in the block's details. */
function updateCachedVarValue(internalName, newValue) {
  for (const block of state.allBlocks) {
    if (block.details) {
      for (const v of [...block.details.inputParameters, ...block.details.localVariables]) {
        if (v.internalName === internalName) {
          v.value = newValue;
          return;
        }
      }
    }
  }
}

/** Update cached data action details after refresh. */
function updateCachedDataAction(refreshMethodName, updated) {
  for (const block of state.allBlocks) {
    if (block.details?.dataActions) {
      const da = block.details.dataActions.find(d => d.refreshMethodName === refreshMethodName);
      if (da) {
        da.outputs = updated.outputs;
        da.varAttrName = updated.varAttrName || da.varAttrName;
      }
    }
  }
}

/** Update cached aggregate details after refresh. */
function updateCachedAggregate(refreshMethodName, updated) {
  for (const block of state.allBlocks) {
    if (block.details?.aggregates) {
      const aggr = block.details.aggregates.find(a => a.refreshMethodName === refreshMethodName);
      if (aggr) {
        aggr.outputs = updated.outputs;
        aggr.varAttrName = updated.varAttrName || aggr.varAttrName;
      }
    }
  }
}

/** Update cached server action details after invocation. */
function updateCachedServerAction(methodName, outputs) {
  for (const block of state.allBlocks) {
    if (block.details?.serverActions) {
      const sa = block.details.serverActions.find(s => s.methodName === methodName);
      if (sa) {
        sa.outputs = outputs;
      }
    }
  }
}

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));
  initBlockTreePopup(document.getElementById("block-tree-overlay"));

  blockList.addEventListener("click", (e) => {
    // Inspect popup icon for complex variables
    const popupBtn = e.target.closest(".btn-var-popup");
    if (popupBtn) {
      e.stopPropagation();
      openVarPopup(popupBtn.dataset.internalName, popupBtn.dataset.name, popupBtn.dataset.type, getViewIndex(popupBtn));
      return;
    }

    // Inspect popup icon for complex action parameters
    const actionPopupBtn = e.target.closest(".btn-action-param-popup");
    if (actionPopupBtn) {
      e.stopPropagation();
      openActionParamPopup(
        actionPopupBtn.dataset.method,
        actionPopupBtn.dataset.attrName,
        actionPopupBtn.dataset.name,
        actionPopupBtn.dataset.type,
        getViewIndex(actionPopupBtn)
      );
      return;
    }

    // Inspect popup icon for complex data action output parameters
    const daOutputPopupBtn = e.target.closest(".btn-data-action-output-popup");
    if (daOutputPopupBtn) {
      e.stopPropagation();
      openDataActionOutputPopup(
        daOutputPopupBtn.dataset.varAttrName,
        daOutputPopupBtn.dataset.outputAttrName,
        daOutputPopupBtn.dataset.name,
        daOutputPopupBtn.dataset.type,
        getViewIndex(daOutputPopupBtn)
      );
      return;
    }

    // Boolean toggle for block vars
    const boolBtn = e.target.closest(".screen-var-toggle:not([disabled])");
    if (boolBtn) {
      e.stopPropagation();
      const isActive = boolBtn.classList.contains("active");
      const newVal = !isActive;
      boolBtn.classList.toggle("active", newVal);
      const row = boolBtn.closest(".screen-var-row");
      doSetVar(boolBtn.dataset.internalName, newVal, "Boolean", row, getViewIndex(boolBtn), updateCachedVarValue);
      return;
    }

    // Trigger aggregate refresh button
    const aggrTriggerBtn = e.target.closest(".btn-trigger-aggregate");
    if (aggrTriggerBtn) {
      e.stopPropagation();
      refreshAggregate(aggrTriggerBtn, getViewIndex(aggrTriggerBtn), updateCachedAggregate);
      return;
    }

    // Trigger data action refresh button
    const daTriggerBtn = e.target.closest(".btn-trigger-data-action");
    if (daTriggerBtn) {
      e.stopPropagation();
      refreshDataAction(daTriggerBtn, getViewIndex(daTriggerBtn), updateCachedDataAction);
      return;
    }

    // Trigger server action button
    const serverTriggerBtn = e.target.closest(".btn-trigger-server-action");
    if (serverTriggerBtn) {
      e.stopPropagation();
      invokeServerAction(serverTriggerBtn, getViewIndex(serverTriggerBtn), updateCachedServerAction);
      return;
    }

    // Trigger screen action button
    const triggerBtn = e.target.closest(".btn-trigger-action");
    if (triggerBtn) {
      e.stopPropagation();
      invokeScreenAction(triggerBtn, getViewIndex(triggerBtn));
      return;
    }

    // Aggregate header expand/collapse toggle
    const aggrHeader = e.target.closest(".aggregate-header");
    if (aggrHeader && !e.target.closest(".btn-trigger-aggregate")) {
      e.stopPropagation();
      const aggrItem = aggrHeader.closest(".aggregate-item");
      if (aggrItem) {
        const rm = aggrItem.dataset.refreshMethod;
        state.expandedAggregates[rm] = !state.expandedAggregates[rm];
        aggrItem.classList.toggle("expanded", !!state.expandedAggregates[rm]);
        const body = aggrItem.querySelector(".screen-action-body-wrap");
        if (body) body.classList.toggle("collapsed", !state.expandedAggregates[rm]);
      }
      return;
    }

    // Data action header expand/collapse toggle
    const daHeader = e.target.closest(".data-action-header");
    if (daHeader && !e.target.closest(".btn-trigger-data-action")) {
      e.stopPropagation();
      const daItem = daHeader.closest(".data-action-item");
      if (daItem) {
        const rm = daItem.dataset.refreshMethod;
        state.expandedDataActions[rm] = !state.expandedDataActions[rm];
        daItem.classList.toggle("expanded", !!state.expandedDataActions[rm]);
        const body = daItem.querySelector(".screen-action-body-wrap");
        if (body) body.classList.toggle("collapsed", !state.expandedDataActions[rm]);
      }
      return;
    }

    // Server action header expand/collapse toggle
    const saHeader = e.target.closest(".server-action-header");
    if (saHeader && !e.target.closest(".btn-trigger-server-action")) {
      e.stopPropagation();
      const saItem = saHeader.closest(".server-action-item");
      if (saItem) {
        const method = saItem.dataset.method;
        state.expandedServerActions[method] = !state.expandedServerActions[method];
        saItem.classList.toggle("expanded", !!state.expandedServerActions[method]);
        const body = saItem.querySelector(".screen-action-body-wrap");
        if (body) body.classList.toggle("collapsed", !state.expandedServerActions[method]);
      }
      return;
    }

    // Action header expand/collapse toggle
    const actionHeader = e.target.closest(".screen-action-header");
    if (actionHeader && !e.target.closest(".btn-trigger-action")) {
      e.stopPropagation();
      const actionItem = actionHeader.closest(".screen-action-item");
      if (actionItem) {
        const method = actionItem.dataset.method;
        state.expandedActions[method] = !state.expandedActions[method];
        actionItem.classList.toggle("expanded", !!state.expandedActions[method]);
        const body = actionItem.querySelector(".screen-action-body-wrap");
        if (body) body.classList.toggle("collapsed", !state.expandedActions[method]);
      }
      return;
    }

    // Boolean toggle for data action outputs
    const daOutputToggle = e.target.closest(".data-action-output-toggle:not([disabled])");
    if (daOutputToggle) {
      e.stopPropagation();
      const isActive = daOutputToggle.classList.contains("active");
      const newVal = !isActive;
      daOutputToggle.classList.toggle("active", newVal);
      const row = daOutputToggle.closest(".data-action-output-row");
      doSetDataActionOutput(
        row?.dataset.varAttrName,
        daOutputToggle.dataset.outputAttrName,
        newVal, "Boolean", row, getViewIndex(daOutputToggle)
      );
      return;
    }

    // Boolean toggle for action params
    const actionParamToggle = e.target.closest(".action-param-toggle");
    if (actionParamToggle) {
      e.stopPropagation();
      actionParamToggle.classList.toggle("active");
      return;
    }

    // Sub-section header expand/collapse
    const subHeader = e.target.closest(".screen-detail-header-toggle");
    if (subHeader) {
      e.stopPropagation();
      const section = subHeader.closest(".screen-detail-section");
      if (section) {
        const key = section.dataset.entityKey + "::" + section.dataset.subKey;
        state.collapsedSubSections[key] = !state.collapsedSubSections[key];
        section.classList.toggle("sub-collapsed", !!state.collapsedSubSections[key]);
        const body = section.querySelector(".screen-detail-body");
        if (body) body.classList.toggle("collapsed", !!state.collapsedSubSections[key]);
      }
      return;
    }

    // Block tree popup button
    const treeBtn = e.target.closest(".btn-block-tree");
    if (treeBtn) {
      e.stopPropagation();
      const viewIndex = parseInt(treeBtn.dataset.viewIndex, 10);
      const blockName = treeBtn.dataset.blockName || "Block";
      openBlockTreePopup(viewIndex, blockName);
      return;
    }

    // Block row expand/collapse
    const blockRow = e.target.closest(".block-row");
    if (blockRow) {
      const blockId = blockRow.dataset.blockId;
      const controllerModule = blockRow.dataset.controllerModule;
      toggleBlockExpand(blockId, controllerModule);
      return;
    }

    // Module header collapse
    const header = e.target.closest(".module-header");
    if (header) {
      const mod = header.dataset.module;
      const body = header.nextElementSibling;
      const isCollapsed = header.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      state.collapsedBlockGroups[mod] = isCollapsed;
    }
  });

  /* Keyboard: Enter -> save, Escape -> revert */
  blockList.addEventListener("keydown", (e) => {
    // Data action output inputs
    const daInput = e.target.closest("input.data-action-output-input:not([readonly])");
    if (daInput) {
      if (e.key === "Enter") { e.preventDefault(); commitDataActionOutputInput(daInput, getViewIndex(daInput)); }
      if (e.key === "Escape") { daInput.value = daInput.dataset.original; daInput.blur(); }
      return;
    }
    // Variable inputs
    const input = e.target.closest("input.screen-var-input:not([readonly])");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitVarInput(input, getViewIndex(input), updateCachedVarValue);
    }
    if (e.key === "Escape") {
      input.value = input.dataset.original;
      input.blur();
    }
  });

  /* Blur -> save if value changed */
  blockList.addEventListener("focusout", (e) => {
    const daInput = e.target.closest("input.data-action-output-input:not([readonly])");
    if (daInput) {
      if (daInput.value !== daInput.dataset.original) commitDataActionOutputInput(daInput, getViewIndex(daInput));
      return;
    }
    const input = e.target.closest("input.screen-var-input:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitVarInput(input, getViewIndex(input), updateCachedVarValue);
    }
  });

  /* Date/time/datetime pickers fire "change" */
  blockList.addEventListener("change", (e) => {
    const daDateInput = e.target.closest("input.data-action-output-input.screen-var-date:not([readonly])");
    if (daDateInput) {
      if (daDateInput.value !== daDateInput.dataset.original) commitDataActionOutputInput(daDateInput, getViewIndex(daDateInput));
      return;
    }
    const input = e.target.closest("input.screen-var-date:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitVarInput(input, getViewIndex(input), updateCachedVarValue);
    }
  });
}
