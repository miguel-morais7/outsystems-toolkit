/**
 * sections/blocks/data.js — Data fetching and block expansion logic.
 *
 * Handles expanding/collapsing blocks. Delegates live value fetching
 * and enrichment to shared modules.
 */

import { sendMessage } from '../../utils/helpers.js';
import { fetchLiveValues, enrichScreenActions, enrichDataActions, enrichAggregates, enrichServerActions } from '../shared/enrichment.js';
import { state } from './state.js';
import { render } from './render.js';

/**
 * Find the live block entry that matches a parsed block by blockId.
 */
function findLiveBlockById(blockId) {
  const block = state.allBlocks.find(b => b.fullName === blockId);
  if (!block) return null;
  const basePath = block.controllerModuleName.replace(/\.mvc\$controller$/, "");
  for (const lb of state.liveBlocks) {
    if (lb.modulePath && basePath === lb.modulePath) return lb;
    if (lb.dataBlockAttr && (basePath === lb.dataBlockAttr || basePath.endsWith("." + lb.dataBlockAttr))) return lb;
  }
  return null;
}

export async function toggleBlockExpand(blockId, controllerModuleName) {
  // Toggle expansion
  state.expandedBlocks[blockId] = !state.expandedBlocks[blockId];

  // If collapsing, clear details and re-render
  if (!state.expandedBlocks[blockId]) {
    const block = state.allBlocks.find(b => b.fullName === blockId);
    if (block) {
      delete block.details;
    }
    render();
    return;
  }

  const liveBlock = findLiveBlockById(blockId);
  const isLive = !!liveBlock;

  // Always fetch fresh details when expanding
  state.loadingBlocks[blockId] = true;
  render();

  try {
    const response = await sendMessage({
      action: "FETCH_BLOCK_DETAILS",
      baseUrl: state.screenBaseUrl,
      moduleName: state.moduleName,
      controllerModuleName: controllerModuleName,
    });

    if (response.ok) {
      const details = {
        inputParameters: response.inputParameters || [],
        localVariables: response.localVariables || [],
        aggregates: response.aggregates || [],
        dataActions: response.dataActions || [],
        serverActions: response.serverActions || [],
        screenActions: response.screenActions || [],
      };

      // If this block is live, fetch runtime values and enrich with viewIndex
      if (isLive) {
        const viewIndex = liveBlock.viewIndex;
        await Promise.all([
          fetchLiveValues(details, viewIndex),
          enrichScreenActions(details, viewIndex),
          enrichDataActions(details, viewIndex),
          enrichAggregates(details, viewIndex),
          enrichServerActions(details, viewIndex),
        ]);
      }

      // Store details on the block object
      const block = state.allBlocks.find(b => b.fullName === blockId);
      if (block) {
        block.details = details;
      }
    } else {
      const block = state.allBlocks.find(b => b.fullName === blockId);
      if (block) {
        block.details = {
          inputParameters: [],
          localVariables: [],
          aggregates: [],
          dataActions: [],
          serverActions: [],
          screenActions: [],
          error: response.error,
        };
      }
    }
  } catch (e) {
    const block = state.allBlocks.find(b => b.fullName === blockId);
    if (block) {
      block.details = {
        inputParameters: [],
        localVariables: [],
        aggregates: [],
        dataActions: [],
        serverActions: [],
        screenActions: [],
        error: e.message,
      };
    }
  }

  state.loadingBlocks[blockId] = false;
  render();
}
