/**
 * sections/screens/index.js — Entry point: init() + re-exports.
 *
 * Wires up all event listeners and re-exports the public API
 * expected by sidepanel.js: { sectionEl, init, setData, getState, render }.
 */

import { debounce, sendMessage } from '../../utils/helpers.js';
import { initPopupListeners, openVarPopup, openActionParamPopup, openDataActionOutputPopup } from '../screenVarPopup.js';
import { doSetVar, commitVarInput, doSetDataActionOutput, commitDataActionOutputInput } from '../shared/editing.js';
import { invokeScreenAction, refreshDataAction, refreshAggregate, invokeServerAction } from '../shared/actions.js';
import {
  state, inputSearch, screenList,
  btnCurrentOnly, roleFilterEl, btnRoleFilter, roleFilterPanel,
  inputSearchRoles, roleFilterOptions, btnRoleClear
} from './state.js';
import { render, populateRoleFilter, updateRoleFilterLabel } from './render.js';
import { toggleScreenExpand } from './data.js';

export { sectionEl, setData, getState } from './state.js';
export { render, populateRoleFilter } from './render.js';

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

/** Update cached data action details after refresh. */
function updateCachedDataAction(refreshMethodName, updated) {
  for (const screen of state.allScreens) {
    if (screen.details?.dataActions) {
      const da = screen.details.dataActions.find(d => d.refreshMethodName === refreshMethodName);
      if (da) {
        da.outputs = updated.outputs;
        da.varAttrName = updated.varAttrName || da.varAttrName;
      }
    }
  }
}

/** Update cached aggregate details after refresh. */
function updateCachedAggregate(refreshMethodName, updated) {
  for (const screen of state.allScreens) {
    if (screen.details?.aggregates) {
      const aggr = screen.details.aggregates.find(a => a.refreshMethodName === refreshMethodName);
      if (aggr) {
        aggr.outputs = updated.outputs;
        aggr.varAttrName = updated.varAttrName || aggr.varAttrName;
      }
    }
  }
}

/** Update cached server action details after invocation. */
function updateCachedServerAction(methodName, outputs) {
  for (const screen of state.allScreens) {
    if (screen.details?.serverActions) {
      const sa = screen.details.serverActions.find(s => s.methodName === methodName);
      if (sa) {
        sa.outputs = outputs;
      }
    }
  }
}

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));

  // Current screen toggle
  btnCurrentOnly.addEventListener("click", () => {
    state.currentScreenOnly = !state.currentScreenOnly;
    btnCurrentOnly.classList.toggle("active", state.currentScreenOnly);
    render();
  });

  // Role filter dropdown toggle
  btnRoleFilter.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !roleFilterPanel.classList.contains("hidden");
    roleFilterPanel.classList.toggle("hidden", isOpen);
    btnRoleFilter.classList.toggle("open", !isOpen);
    if (!isOpen) inputSearchRoles.focus();
  });

  // Prevent clicks inside panel from closing it
  roleFilterPanel.addEventListener("click", (e) => e.stopPropagation());

  // Close dropdown on outside click
  document.addEventListener("click", () => {
    if (!roleFilterPanel.classList.contains("hidden")) {
      roleFilterPanel.classList.add("hidden");
      btnRoleFilter.classList.remove("open");
    }
  });

  // Search within role options
  inputSearchRoles.addEventListener("input", debounce(() => {
    const q = inputSearchRoles.value.toLowerCase().trim();
    for (const opt of roleFilterOptions.querySelectorAll(".multi-select-option")) {
      const match = !q || opt.dataset.role.toLowerCase().includes(q);
      opt.classList.toggle("hidden-option", !match);
    }
  }, 100));

  // Checkbox change (delegated)
  roleFilterOptions.addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const role = cb.value;
    if (cb.checked) {
      if (!state.selectedRoles.includes(role)) state.selectedRoles.push(role);
    } else {
      state.selectedRoles = state.selectedRoles.filter(r => r !== role);
    }
    updateRoleFilterLabel();
    render();
  });

  // Clear all roles
  btnRoleClear.addEventListener("click", () => {
    state.selectedRoles = [];
    for (const cb of roleFilterOptions.querySelectorAll('input[type="checkbox"]')) {
      cb.checked = false;
    }
    updateRoleFilterLabel();
    render();
  });

  screenList.addEventListener("click", (e) => {
    // Inspect popup icon for complex screen variables
    const popupBtn = e.target.closest(".btn-var-popup");
    if (popupBtn) {
      e.stopPropagation();
      openVarPopup(popupBtn.dataset.internalName, popupBtn.dataset.name, popupBtn.dataset.type);
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
        actionPopupBtn.dataset.type
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
        daOutputPopupBtn.dataset.type
      );
      return;
    }

    // Navigate button
    const navBtn = e.target.closest(".btn-navigate");
    if (navBtn) {
      e.stopPropagation();
      sendMessage({ action: "NAVIGATE", url: navBtn.dataset.url });
      return;
    }

    // Boolean toggle for screen vars
    const boolBtn = e.target.closest(".screen-var-toggle:not([disabled])");
    if (boolBtn) {
      e.stopPropagation();
      const isActive = boolBtn.classList.contains("active");
      const newVal = !isActive;
      boolBtn.classList.toggle("active", newVal);
      const row = boolBtn.closest(".screen-var-row");
      doSetVar(boolBtn.dataset.internalName, newVal, "Boolean", row, undefined, updateCachedVarValue);
      return;
    }

    // Trigger aggregate refresh button
    const aggrTriggerBtn = e.target.closest(".btn-trigger-aggregate");
    if (aggrTriggerBtn) {
      e.stopPropagation();
      refreshAggregate(aggrTriggerBtn, undefined, updateCachedAggregate);
      return;
    }

    // Trigger data action refresh button
    const daTriggerBtn = e.target.closest(".btn-trigger-data-action");
    if (daTriggerBtn) {
      e.stopPropagation();
      refreshDataAction(daTriggerBtn, undefined, updateCachedDataAction);
      return;
    }

    // Trigger server action button
    const serverTriggerBtn = e.target.closest(".btn-trigger-server-action");
    if (serverTriggerBtn) {
      e.stopPropagation();
      invokeServerAction(serverTriggerBtn, undefined, updateCachedServerAction);
      return;
    }

    // Trigger screen action button
    const triggerBtn = e.target.closest(".btn-trigger-action");
    if (triggerBtn) {
      e.stopPropagation();
      invokeScreenAction(triggerBtn);
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
        newVal, "Boolean", row
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

    // Screen row expand/collapse (click on the row itself, not navigate button)
    const screenRow = e.target.closest(".screen-row");
    if (screenRow && !e.target.closest(".btn-navigate")) {
      const screenUrl = screenRow.dataset.screenUrl;
      const flow = screenRow.dataset.flow;
      const name = screenRow.dataset.name;
      toggleScreenExpand(screenUrl, flow, name);
      return;
    }

    // Module header collapse
    const header = e.target.closest(".module-header");
    if (header) {
      const mod = header.dataset.module;
      const body = header.nextElementSibling;
      const isCollapsed = header.classList.toggle("collapsed");
      body.classList.toggle("collapsed", isCollapsed);
      state.collapsedScreenFlows[mod] = isCollapsed;
    }
  });

  /* Keyboard: Enter -> save, Escape -> revert */
  screenList.addEventListener("keydown", (e) => {
    // Data action output inputs
    const daInput = e.target.closest("input.data-action-output-input:not([readonly])");
    if (daInput) {
      if (e.key === "Enter") { e.preventDefault(); commitDataActionOutputInput(daInput); }
      if (e.key === "Escape") { daInput.value = daInput.dataset.original; daInput.blur(); }
      return;
    }
    // Screen variable inputs
    const input = e.target.closest("input.screen-var-input:not([readonly])");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitVarInput(input, undefined, updateCachedVarValue);
    }
    if (e.key === "Escape") {
      input.value = input.dataset.original;
      input.blur();
    }
  });

  /* Blur -> save if value changed */
  screenList.addEventListener("focusout", (e) => {
    const daInput = e.target.closest("input.data-action-output-input:not([readonly])");
    if (daInput) {
      if (daInput.value !== daInput.dataset.original) commitDataActionOutputInput(daInput);
      return;
    }
    const input = e.target.closest("input.screen-var-input:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitVarInput(input, undefined, updateCachedVarValue);
    }
  });

  /* Date/time/datetime pickers fire "change" */
  screenList.addEventListener("change", (e) => {
    // Data action output date inputs have both classes
    const daDateInput = e.target.closest("input.data-action-output-input.screen-var-date:not([readonly])");
    if (daDateInput) {
      if (daDateInput.value !== daDateInput.dataset.original) commitDataActionOutputInput(daDateInput);
      return;
    }
    const input = e.target.closest("input.screen-var-date:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitVarInput(input, undefined, updateCachedVarValue);
    }
  });

  /* ---- Popup event listeners (delegated to screenVarPopup module) ---- */
  initPopupListeners(document.getElementById("var-popup-overlay"));
}
