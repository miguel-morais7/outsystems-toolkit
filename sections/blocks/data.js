/**
 * sections/blocks/data.js — Data fetching and block expansion logic.
 *
 * Handles expanding/collapsing blocks. Delegates live value fetching
 * and enrichment to shared modules.
 *
 * For ODC (runtime-only), skips FETCH_BLOCK_DETAILS and discovers
 * variables/actions entirely from the live controller.
 */

import { sendMessage } from '../../utils/helpers.js';
import { fetchLiveValues, enrichScreenActions, enrichDataActions, enrichAggregates, enrichServerActions } from '../shared/enrichment.js';
import { state, findLiveBlock } from './state.js';
import { render } from './render.js';

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

  const block = state.allBlocks.find(b => b.fullName === blockId);
  const liveBlock = block ? findLiveBlock(block) : null;
  const isLive = !!liveBlock;

  // Always fetch fresh details when expanding
  state.loadingBlocks[blockId] = true;
  render();

  try {
    let details;

    if (state.platform === "odc" && isLive) {
      // ODC: runtime-only discovery — no static mvc.js to parse
      details = {
        inputParameters: [],
        localVariables: [],
        aggregates: [],
        dataActions: [],
        serverActions: [],
        screenActions: [],
      };
      const viewIndex = liveBlock.viewIndex;
      await Promise.all([
        fetchLiveValues(details, viewIndex),
        enrichScreenActions(details, viewIndex),
        enrichDataActions(details, viewIndex),
        enrichAggregates(details, viewIndex),
        enrichServerActions(details, viewIndex),
      ]);
    } else {
      // Reactive: static parse first, then enrich with runtime
      const response = await sendMessage({
        action: "FETCH_BLOCK_DETAILS",
        baseUrl: state.screenBaseUrl,
        moduleName: state.moduleName,
        controllerModuleName: controllerModuleName,
      });

      if (response.ok) {
        details = {
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
      } else {
        details = {
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

    // Store details on the block object
    if (block) {
      block.details = details;
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
