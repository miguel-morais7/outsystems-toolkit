/**
 * sections/screens/state.js — Shared mutable state and DOM references.
 *
 * All sub-modules import `state` and read/write properties directly.
 */

/** Mutable state — all sub-modules read/write this directly. */
export const state = {
  allScreens: [],
  screenBaseUrl: "",
  moduleName: "",
  currentScreen: "",
  homeScreenName: "",
  platform: "unknown",     // 'reactive' | 'odc' | 'unknown'
  collapsedScreenFlows: {},
  expandedScreens: {},   // screenUrl -> true/false
  loadingScreens: {},    // screenUrl -> true (while fetching)
  expandedActions: {},   // methodName -> true/false
  expandedDataActions: {},  // refreshMethodName -> true/false
  expandedAggregates: {},   // refreshMethodName -> true/false
  expandedServerActions: {},  // methodName -> true/false
  collapsedSubSections: {},  // "screenUrl::sectionKey" -> true
};

/* DOM references */
export const inputSearch = document.getElementById("input-search-screens");
export const screenList = document.getElementById("screen-list");
export const screenCount = document.getElementById("screen-count");
export const emptyState = document.getElementById("empty-state");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("screen-section");

/** Replace section data after a scan. */
export function setData(screens, baseUrl, modName, current, homeScreen, platform) {
  state.allScreens = screens;
  state.screenBaseUrl = baseUrl || "";
  state.moduleName = modName || "";
  state.currentScreen = current || "";
  state.homeScreenName = homeScreen || "";
  state.platform = platform || "unknown";
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: state.allScreens.length };
}
