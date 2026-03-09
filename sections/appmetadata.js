/**
 * sections/appmetadata.js — App Metadata section
 *
 * Displays read-only key-value metadata from the appDefinition module.
 * Shows application name, environment, debug status, and other
 * deployment-level information.
 */

import { esc } from '../utils/helpers.js';
import { show, hide } from '../utils/ui.js';

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */
let metadataEntries = []; // Array of { key, label, value }
let versionInfo = null;   // { versionToken, versionSequence }
let platform = "unknown"; // 'reactive' | 'odc' | 'unknown'

/* ================================================================== */
/*  DOM references                                                     */
/* ================================================================== */
const metadataList = document.getElementById("metadata-list");
const metadataCount = document.getElementById("metadata-count");
const emptyState = document.getElementById("empty-state");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("metadata-section");

/* ================================================================== */
/*  Public API                                                         */
/* ================================================================== */

/** Wire up event listeners. Call once at startup. */
export function init() {
  // No event listeners — this section is purely read-only
}

/** Replace section data after a scan. */
export function setData(appDef, platformType) {
  platform = platformType || "unknown";
  if (!appDef) {
    metadataEntries = [];
    versionInfo = null;
    return;
  }
  metadataEntries = buildEntries(appDef);
  appendVersionEntries();
}

/** Accept version info from moduleinfo (arrives separately from FETCH_SCREENS). */
export function setVersionInfo(info) {
  versionInfo = info;
  appendVersionEntries();
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: metadataEntries.length };
}

/** Render (or re-render) the metadata list. */
export function render() {
  // Build display entries: platform row first (if known), then metadata
  const labels = { reactive: "Reactive", odc: "ODC" };
  const displayEntries = [];

  if (labels[platform]) {
    displayEntries.push({ key: "platform", label: "Platform", value: labels[platform] });
  }
  displayEntries.push(...metadataEntries);

  if (displayEntries.length === 0) {
    hide(sectionEl);
    return;
  }

  metadataCount.textContent = displayEntries.length;

  let html = "";
  for (const entry of displayEntries) {
    html += buildMetadataRow(entry);
  }

  metadataList.innerHTML = html;
  show(sectionEl);
  hide(emptyState);
}

/* ================================================================== */
/*  Private helpers                                                    */
/* ================================================================== */

/**
 * Convert the raw appDefinition object into a curated array of
 * display-friendly { label, value, key } entries.
 */
function buildEntries(appDef) {
  // Shared fields (present in both Reactive and ODC)
  const fields = [
    { key: "applicationName",          label: "Application" },
    { key: "environmentName",          label: "Environment" },
    { key: "debugEnabled",             label: "Debug Mode" },
    { key: "homeModuleName",           label: "Home Module" },
    { key: "userProviderName",         label: "User Provider" },
    { key: "defaultTransition",        label: "Transition" },
    { key: "isWeb",                    label: "Is Web" },
    { key: "showWatermark",            label: "Watermark" },
    { key: "applicationKey",           label: "App Key" },
    { key: "environmentKey",           label: "Environment Key" },
    { key: "homeModuleKey",            label: "Module Key" },
    // ODC-specific fields
    { key: "defaultScreenName",        label: "Default Screen" },
    { key: "appVersion",               label: "App Version" },
    { key: "clientRuntimeVersion",     label: "Runtime Version" },
    { key: "buildSDKVersion",          label: "Build SDK" },
    { key: "frontendBuildWorkerVersion", label: "Build Worker" },
  ];

  const entries = [];
  for (const f of fields) {
    if (f.key in appDef) {
      entries.push({
        key: f.key,
        label: f.label,
        value: formatValue(appDef[f.key]),
      });
    }
  }
  return entries;
}

function formatValue(val) {
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

function appendVersionEntries() {
  if (!versionInfo) return;
  // Remove any previously-added version entries (idempotent)
  metadataEntries = metadataEntries.filter(e => e.key !== 'versionSequence' && e.key !== 'versionToken');
  if (versionInfo.versionSequence !== null && versionInfo.versionSequence !== undefined) {
    metadataEntries.push({ key: 'versionSequence', label: 'Version Sequence', value: String(versionInfo.versionSequence) });
  }
  if (versionInfo.versionToken) {
    metadataEntries.push({ key: 'versionToken', label: 'Version Token', value: versionInfo.versionToken });
  }
}

function buildMetadataRow(entry) {
  return `
    <div class="var-row metadata-row" data-key="${esc(entry.key)}">
      <div class="var-info">
        <span class="var-name">${esc(entry.label)}</span>
      </div>
      <div class="var-value-wrap">
        <span class="metadata-value">${esc(entry.value)}</span>
      </div>
    </div>`;
}
