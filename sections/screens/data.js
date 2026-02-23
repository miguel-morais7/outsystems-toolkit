/**
 * sections/screens/data.js — Data fetching and screen expansion logic.
 *
 * Handles expanding/collapsing screens. Delegates live value fetching
 * and enrichment to shared modules.
 */

import { sendMessage } from '../../utils/helpers.js';
import { fetchLiveValues, enrichScreenActions, enrichDataActions, enrichAggregates, enrichServerActions } from '../shared/enrichment.js';
import { state } from './state.js';
import { render } from './render.js';

export async function toggleScreenExpand(screenUrl, flow, screenName) {
  // Toggle expansion
  state.expandedScreens[screenUrl] = !state.expandedScreens[screenUrl];

  // If collapsing, clear details and re-render
  if (!state.expandedScreens[screenUrl]) {
    const screen = state.allScreens.find(s => s.screenUrl === screenUrl);
    if (screen) {
      delete screen.details;  // Clear cached details
    }
    render();
    return;
  }

  const isCurrent = screenUrl === state.currentScreen;

  // Always fetch fresh details when expanding
  state.loadingScreens[screenUrl] = true;
  render();

  try {
    const screen = state.allScreens.find(s => s.screenUrl === screenUrl);
    const response = await sendMessage({
      action: "FETCH_SCREEN_DETAILS",
      baseUrl: state.screenBaseUrl,
      moduleName: state.moduleName,
      flow: flow,
      screenName: screenName,
      controllerModuleName: screen?.controllerModuleName || null,
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

      // If this is the current screen, fetch live runtime values and action metadata
      if (isCurrent) {
        await Promise.all([
          fetchLiveValues(details),
          enrichScreenActions(details),
          enrichDataActions(details),
          enrichAggregates(details),
          enrichServerActions(details),
        ]);
      }

      // Store details directly on the screen object
      const screen = state.allScreens.find(s => s.screenUrl === screenUrl);
      if (screen) {
        screen.details = details;
      }
    } else {
      // Store error details
      const screen = state.allScreens.find(s => s.screenUrl === screenUrl);
      if (screen) {
        screen.details = {
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
    // Store error details
    const screen = state.allScreens.find(s => s.screenUrl === screenUrl);
    if (screen) {
      screen.details = {
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

  state.loadingScreens[screenUrl] = false;
  render();
}
