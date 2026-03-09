/**
 * pageScript/producers.js — Producer resource URL discovery.
 *
 * Depends on: (none)
 *
 * Provides:
 *   - _osProducerResourceUrls()
 */

/* ------------------------------------------------------------------ */
/*  DISCOVER PRODUCER RESOURCE URLs from performance entries            */
/* ------------------------------------------------------------------ */
function _osProducerResourceUrls() {
  try {
    var scripts = performance.getEntriesByType("resource");
    var resources = {};

    scripts.forEach(function (entry) {
      if (
        entry.initiatorType === "script" &&
        entry.name.includes("referencesHealth.js")
      ) {
        var matches = entry.name.match(/([^\/]+)\.referencesHealth\.js/);
        if (matches && matches[1]) {
          resources[matches[1]] = entry.name;
        }
      }
    });

    return { ok: true, resources: resources };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
