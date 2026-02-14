/**
 * sections/roles.js — Roles section
 *
 * Manages state, rendering, and event delegation for the
 * roles panel. Fetches roles from the module's controller.js file.
 */

import { esc, debounce } from '../utils/helpers.js';
import { show, hide } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let allRoles = [];

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const inputSearch = document.getElementById("input-search-roles");
const roleList = document.getElementById("role-list");
const roleCount = document.getElementById("role-count");
const emptyState = document.getElementById("empty-state");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("role-section");

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
    inputSearch.addEventListener("input", debounce(render, 150));
}

/** Replace section data after a scan. */
export function setData(roles) {
    allRoles = roles;
}

/** Return counts for the status-bar summary. */
export function getState() {
    return { count: allRoles.length };
}

/** Render (or re-render) the roles list. */
export function render() {
    const query = inputSearch.value.toLowerCase().trim();

    let filtered = allRoles;
    if (query) {
        filtered = filtered.filter((r) => r.name.toLowerCase().includes(query));
    }

    roleCount.textContent = filtered.length;

    if (filtered.length === 0 && allRoles.length > 0) {
        roleList.innerHTML = `<div class="no-results">No roles match your filter.</div>`;
        show(sectionEl);
        return;
    }

    if (filtered.length === 0) {
        hide(sectionEl);
        return;
    }

    let html = "";
    for (const role of filtered) {
        html += buildRoleRow(role);
    }

    roleList.innerHTML = html;
    show(sectionEl);
    hide(emptyState);
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

function buildRoleRow(role) {
    const activeIcon = role.userHasRole
        ? `<span class="role-active-badge" title="Current user has this role">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
           </span>`
        : "";

    return `
    <div class="var-row role-row${role.userHasRole ? " role-active" : ""}" data-role-name="${esc(role.name)}">
      <div class="var-info">
        ${activeIcon}
        <span class="var-name">${esc(role.name)}</span>
      </div>
    </div>`;
}
