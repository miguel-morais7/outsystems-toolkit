/**
 * sections/shared/enrichment.js — Runtime enrichment functions.
 *
 * Fetches live variable values and enriches static action/aggregate/data action
 * metadata with runtime information from the page's controller.
 * Used by both screens and blocks sections.
 */

import { sendMessage } from '../../utils/helpers.js';

/**
 * Fetch live runtime values for variables.
 * Merges the live values back into the details object.
 *
 * @param {Object} details - The screen/block details with inputParameters and localVariables
 * @param {number} [viewIndex] - The view instance index (undefined for screen)
 */
export async function fetchLiveValues(details, viewIndex) {
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
      viewIndex,
    });

    if (result && result.ok && result.variables) {
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
    console.warn("[Enrichment] Failed to fetch live values:", e.message);
  }
}

/**
 * Enrich screen actions with runtime metadata from the live controller.
 *
 * @param {Object} details - The screen/block details with screenActions
 * @param {number} [viewIndex] - The view instance index
 */
export async function enrichScreenActions(details, viewIndex) {
  if (!details.screenActions || details.screenActions.length === 0) return;

  try {
    const result = await sendMessage({ action: "GET_SCREEN_ACTIONS", viewIndex });
    if (!result || !result.ok || !result.actions) return;

    const runtimeMap = {};
    for (const a of result.actions) {
      runtimeMap[a.name.toLowerCase()] = a;
    }

    for (const action of details.screenActions) {
      const runtime = runtimeMap[action.name.toLowerCase()];
      if (runtime) {
        action.methodName = runtime.methodName;
        if (runtime.inputs && runtime.inputs.length > 0) {
          action.inputs = runtime.inputs;
        }
        if (runtime.locals && runtime.locals.length > 0) {
          action.locals = runtime.locals;
        }
      }
    }
  } catch (e) {
    console.warn("[Enrichment] Failed to enrich screen actions:", e.message);
  }
}

/**
 * Enrich data actions with runtime metadata from the live controller.
 *
 * @param {Object} details - The screen/block details with dataActions
 * @param {number} [viewIndex] - The view instance index
 */
export async function enrichDataActions(details, viewIndex) {
  if (!details.dataActions || details.dataActions.length === 0) return;

  try {
    const result = await sendMessage({ action: "GET_DATA_ACTIONS", viewIndex });
    if (!result || !result.ok || !result.dataActions) return;

    const runtimeMap = {};
    for (const da of result.dataActions) {
      runtimeMap[da.name.toLowerCase()] = da;
    }

    for (const da of details.dataActions) {
      const runtime = runtimeMap[da.name.toLowerCase()];
      if (runtime) {
        da.refreshMethodName = runtime.refreshMethodName;
        da.varAttrName = runtime.varAttrName || da.varAttrName;
        if (runtime.outputs && runtime.outputs.length > 0) {
          da.outputs = runtime.outputs;
        }
      }
    }
  } catch (e) {
    console.warn("[Enrichment] Failed to enrich data actions:", e.message);
  }
}

/**
 * Enrich aggregates with runtime metadata from the live controller.
 *
 * @param {Object} details - The screen/block details with aggregates
 * @param {number} [viewIndex] - The view instance index
 */
export async function enrichAggregates(details, viewIndex) {
  if (!details.aggregates || details.aggregates.length === 0) return;

  try {
    const result = await sendMessage({ action: "GET_AGGREGATES", viewIndex });
    if (!result || !result.ok || !result.aggregates) return;

    const runtimeMap = {};
    for (const aggr of result.aggregates) {
      runtimeMap[aggr.name.toLowerCase()] = aggr;
    }

    for (const aggr of details.aggregates) {
      const runtime = runtimeMap[aggr.name.toLowerCase()];
      if (runtime) {
        aggr.refreshMethodName = runtime.refreshMethodName;
        aggr.varAttrName = runtime.varAttrName || aggr.varAttrName;
        if (runtime.outputs && runtime.outputs.length > 0) {
          aggr.outputs = runtime.outputs;
        }
      }
    }
  } catch (e) {
    console.warn("[Enrichment] Failed to enrich aggregates:", e.message);
  }
}

/**
 * Enrich server actions with runtime metadata from the live controller.
 *
 * @param {Object} details - The screen/block details with serverActions
 * @param {number} [viewIndex] - The view instance index
 */
export async function enrichServerActions(details, viewIndex) {
  if (!details.serverActions || details.serverActions.length === 0) return;

  try {
    const result = await sendMessage({ action: "GET_SERVER_ACTIONS", viewIndex });
    if (!result || !result.ok || !result.serverActions) return;

    const runtimeMap = {};
    for (const sa of result.serverActions) {
      runtimeMap[sa.name.toLowerCase()] = sa;
    }

    for (const sa of details.serverActions) {
      const runtime = runtimeMap[sa.name.toLowerCase()];
      if (runtime) {
        sa.methodName = runtime.methodName;
        if (runtime.inputs && runtime.inputs.length > 0) {
          sa.inputs = runtime.inputs;
        }
        if (runtime.outputs && runtime.outputs.length > 0) {
          sa.outputs = runtime.outputs;
        }
      }
    }
  } catch (e) {
    console.warn("[Enrichment] Failed to enrich server actions:", e.message);
  }
}
