/**
 * sections/screens/data.js — Data fetching and screen expansion logic.
 *
 * Handles expanding/collapsing screens, fetching live variable values,
 * and enriching screen actions with runtime metadata.
 */

import { sendMessage } from '../../utils/helpers.js';
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
        await fetchLiveValues(details);
        await enrichScreenActions(details);
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

/**
 * Enrich screen actions with runtime metadata from the live controller.
 * This provides accurate parameter type info and ensures methodName is set.
 */
async function enrichScreenActions(details) {
  if (!details.screenActions || details.screenActions.length === 0) return;

  try {
    const result = await sendMessage({ action: "GET_SCREEN_ACTIONS" });
    if (!result || !result.ok || !result.actions) return;

    // Build a map of runtime actions by normalized name
    const runtimeMap = {};
    for (const a of result.actions) {
      runtimeMap[a.name.toLowerCase()] = a;
    }

    // Merge runtime data into statically-parsed actions
    for (const action of details.screenActions) {
      const runtime = runtimeMap[action.name.toLowerCase()];
      if (runtime) {
        action.methodName = runtime.methodName;
        // Use runtime inputs/locals if they have richer type info
        if (runtime.inputs && runtime.inputs.length > 0) {
          action.inputs = runtime.inputs;
        }
        if (runtime.locals && runtime.locals.length > 0) {
          action.locals = runtime.locals;
        }
      }
    }
  } catch (e) {
    console.warn("[Screens] Failed to enrich screen actions:", e.message);
  }
}

/**
 * Fetch live runtime values for the current screen's variables.
 * Merges the live values back into the details object.
 */
async function fetchLiveValues(details) {
  // Build varDefs from parsed metadata
  const varDefs = [
    ...details.inputParameters.map(v => ({
      name: v.name,
      internalName: v.internalName,
      type: v.type,
      isInput: true,
    })),
    ...details.localVariables.map(v => ({
      name: v.name,
      internalName: v.internalName,
      type: v.type,
      isInput: false,
    })),
  ];

  if (varDefs.length === 0) return;

  try {
    const result = await sendMessage({
      action: "GET_SCREEN_VARS",
      varDefs,
    });

    if (result && result.ok && result.variables) {
      // Merge live values back into details
      const valueMap = {};
      for (const v of result.variables) {
        valueMap[v.internalName] = v;
      }

      for (const v of details.inputParameters) {
        const live = valueMap[v.internalName];
        if (live) {
          v.value = live.value;
          v.readOnly = live.readOnly;
        }
      }

      for (const v of details.localVariables) {
        const live = valueMap[v.internalName];
        if (live) {
          v.value = live.value;
          v.readOnly = live.readOnly;
        }
      }
    }
  } catch (e) {
    // Silently fail — the screen details will still show without live values
    console.warn("[Screens] Failed to fetch live values:", e.message);
  }
}
