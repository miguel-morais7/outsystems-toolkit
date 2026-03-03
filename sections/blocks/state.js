/**
 * sections/blocks/state.js — Shared mutable state and DOM references.
 *
 * All sub-modules import `state` and read/write properties directly.
 */

/** Mutable state — all sub-modules read/write this directly. */
export const state = {
  allBlocks: [],          // from fetchScreens().blocks (static parse) or runtime (ODC)
  liveBlocks: [],         // from DISCOVER_BLOCKS (runtime, with viewIndex)
  screenBaseUrl: "",
  moduleName: "",
  platform: "unknown",    // 'reactive' | 'odc' | 'unknown'
  expandedBlocks: {},     // blockId -> true/false
  loadingBlocks: {},      // blockId -> true (while fetching)
  expandedActions: {},    // methodName -> true/false
  expandedDataActions: {},   // refreshMethodName -> true/false
  expandedAggregates: {},    // refreshMethodName -> true/false
  expandedServerActions: {},  // methodName -> true/false
  collapsedSubSections: {},  // "blockId::sectionKey" -> true
  collapsedBlockGroups: {},  // group -> true/false
};

/* DOM references */
export const inputSearch = document.getElementById("input-search-blocks");
export const blockList = document.getElementById("block-list");
export const blockCount = document.getElementById("block-count");

/** The root section element (exported for the orchestrator). */
export const sectionEl = document.getElementById("block-section");

/** Replace section data after a scan. */
export function setData(blocks, baseUrl, modName, liveBlocks, platform) {
  state.allBlocks = blocks;
  state.screenBaseUrl = baseUrl || "";
  state.moduleName = modName || "";
  state.liveBlocks = liveBlocks || [];
  state.platform = platform || "unknown";
  state.expandedBlocks = {};
  state.loadingBlocks = {};
  state.expandedActions = {};
  state.expandedDataActions = {};
  state.expandedAggregates = {};
  state.expandedServerActions = {};
  state.collapsedSubSections = {};
  state.collapsedBlockGroups = {};
}

/**
 * Find the live block entry that matches a parsed block.
 * Tries exact modulePath match first, then falls back to suffix-matching
 * the data-block DOM attribute against the block's controllerModuleName.
 */
export function findLiveBlock(block) {
  const basePath = block.controllerModuleName.replace(/\.mvc\$controller$/, "");
  for (const lb of state.liveBlocks) {
    if (lb.modulePath && basePath === lb.modulePath) return lb;
    if (lb.dataBlockAttr && (basePath === lb.dataBlockAttr || basePath.endsWith("." + lb.dataBlockAttr))) return lb;
  }
  return null;
}

/** Return counts for the status-bar summary. */
export function getState() {
  return { count: state.allBlocks.length };
}
