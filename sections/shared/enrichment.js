/**
 * sections/shared/enrichment.js — Runtime enrichment functions.
 *
 * Fetches live variable values and enriches static action/aggregate/data action
 * metadata with runtime information from the page's controller.
 * Used by both screens and blocks sections.
 *
 * When no static definitions exist (ODC runtime-only mode), the functions
 * populate details directly from runtime discovery instead of merging.
 */

import { sendMessage } from '../../utils/helpers.js';

/**
 * Fetch live runtime values for variables.
 * Merges the live values back into the details object.
 * When no static defs exist, the page script auto-discovers variables
 * from VariablesRecord.Attributes (ODC) and we populate details directly.
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

  // Even with empty varDefs, call GET_SCREEN_VARS — the page script can
  // auto-discover variables from VariablesRecord.Attributes (ODC runtime)
  try {
    const result = await sendMessage({
      action: "GET_SCREEN_VARS",
      varDefs,
      viewIndex,
    });

    if (result && result.ok && result.variables) {
      if (varDefs.length === 0 && result.variables.length > 0) {
        // Runtime-only discovery (ODC): populate details from discovered vars
        for (const v of result.variables) {
          details.localVariables.push({
            name: v.name,
            internalName: v.internalName,
            type: v.type,
            isInput: v.isInput,
            value: v.value,
            readOnly: v.readOnly,
          });
        }
        return;
      }

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
 * When no static defs exist (ODC), populates details.screenActions from runtime.
 *
 * @param {Object} details - The screen/block details with screenActions
 * @param {number} [viewIndex] - The view instance index
 */
export async function enrichScreenActions(details, viewIndex) {
  try {
    const result = await sendMessage({ action: "GET_SCREEN_ACTIONS", viewIndex });
    if (!result || !result.ok || !result.actions) return;

    // Runtime-only (ODC): no static defs — use runtime data directly
    if (!details.screenActions || details.screenActions.length === 0) {
      details.screenActions = result.actions;
      return;
    }

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
 * When no static defs exist (ODC), populates details.dataActions from runtime.
 *
 * @param {Object} details - The screen/block details with dataActions
 * @param {number} [viewIndex] - The view instance index
 */
export async function enrichDataActions(details, viewIndex) {
  try {
    const result = await sendMessage({ action: "GET_DATA_ACTIONS", viewIndex });
    if (!result || !result.ok || !result.dataActions) return;

    // Runtime-only (ODC): no static defs — use runtime data directly
    if (!details.dataActions || details.dataActions.length === 0) {
      details.dataActions = result.dataActions;
      return;
    }

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
 * When no static defs exist (ODC), populates details.aggregates from runtime.
 *
 * @param {Object} details - The screen/block details with aggregates
 * @param {number} [viewIndex] - The view instance index
 */
export async function enrichAggregates(details, viewIndex) {
  try {
    const result = await sendMessage({ action: "GET_AGGREGATES", viewIndex });
    if (!result || !result.ok || !result.aggregates) return;

    // Runtime-only (ODC): no static defs — use runtime data directly
    if (!details.aggregates || details.aggregates.length === 0) {
      details.aggregates = result.aggregates;
      return;
    }

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
 * When no static defs exist (ODC), populates details.serverActions from runtime.
 *
 * @param {Object} details - The screen/block details with serverActions
 * @param {number} [viewIndex] - The view instance index
 */
export async function enrichServerActions(details, viewIndex) {
  try {
    const result = await sendMessage({ action: "GET_SERVER_ACTIONS", viewIndex });
    if (!result || !result.ok || !result.serverActions) return;

    // Runtime-only (ODC): no static defs — use runtime data directly
    if (!details.serverActions || details.serverActions.length === 0) {
      details.serverActions = result.serverActions;
      return;
    }

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
