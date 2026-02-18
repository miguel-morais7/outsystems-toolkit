/**
 * sections/screens/index.js — Entry point: init() + re-exports.
 *
 * Wires up all event listeners and re-exports the public API
 * expected by sidepanel.js: { sectionEl, init, setData, getState, render }.
 */

import { debounce, sendMessage } from '../../utils/helpers.js';
import { initPopupListeners, openVarPopup, openActionParamPopup } from '../screenVarPopup.js';
import { state, inputSearch, screenList } from './state.js';
import { render } from './render.js';
import { doSetScreenVar, commitScreenVarInput } from './editing.js';
import { invokeScreenAction } from './actions.js';
import { toggleScreenExpand } from './data.js';

export { sectionEl, setData, getState } from './state.js';
export { render } from './render.js';

/** Wire up event listeners. Call once at startup. */
export function init() {
  inputSearch.addEventListener("input", debounce(render, 150));

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
      doSetScreenVar(boolBtn.dataset.internalName, newVal, "Boolean", row);
      return;
    }

    // Trigger action button
    const triggerBtn = e.target.closest(".btn-trigger-action");
    if (triggerBtn) {
      e.stopPropagation();
      invokeScreenAction(triggerBtn);
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
        const key = section.dataset.screenUrl + "::" + section.dataset.subKey;
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

  /* Keyboard: Enter → save, Escape → revert */
  screenList.addEventListener("keydown", (e) => {
    const input = e.target.closest("input.screen-var-input:not([readonly])");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitScreenVarInput(input);
    }
    if (e.key === "Escape") {
      input.value = input.dataset.original;
      input.blur();
    }
  });

  /* Blur → save if value changed */
  screenList.addEventListener("focusout", (e) => {
    const input = e.target.closest("input.screen-var-input:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitScreenVarInput(input);
    }
  });

  /* Date/time/datetime pickers fire "change" */
  screenList.addEventListener("change", (e) => {
    const input = e.target.closest("input.screen-var-date:not([readonly])");
    if (!input) return;
    if (input.value !== input.dataset.original) {
      commitScreenVarInput(input);
    }
  });

  /* ---- Popup event listeners (delegated to screenVarPopup module) ---- */
  initPopupListeners(document.getElementById("var-popup-overlay"));
}
