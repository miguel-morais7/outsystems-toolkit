/**
 * pageScript/networkInspector.js — Server call capture and replay.
 *
 * Depends on: helpers.js
 *
 * Patches window.fetch and XMLHttpRequest in the page's MAIN world to
 * record every OutSystems server round-trip (URLs containing
 * "/screenservices/"). Entries live in a ring buffer on window.__osNetLog
 * and are drained by the side panel via _osNetworkGetEntries polling.
 *
 * Provides:
 *   - _osNetworkStart()
 *   - _osNetworkGetEntries()
 *   - _osNetworkSetEnabled()
 *   - _osNetworkClear()
 *   - _osNetworkReplay()
 */

var _OS_NET_MAX_ENTRIES = 200;
var _OS_NET_MAX_BODY = 200 * 1024;

/** True when the URL is an OutSystems server call worth recording. */
function _osNetIsServerCall(url) {
  return typeof url === "string" && url.indexOf("/screenservices/") !== -1;
}

/** Best-effort action name from a screenservices URL path. */
function _osNetParseEndpoint(url) {
  try {
    var path = new URL(url, location.href).pathname;
    var idx = path.indexOf("/screenservices/");
    var segments = path.slice(idx + "/screenservices/".length).split("/").filter(Boolean);
    // Reactive: {ApiName}/{Flow}/{Screen}/{ActionName}/{hash} — the action name
    // is the last non-hash segment. ODC follows the same trailing-hash shape.
    if (segments.length === 0) return path;
    var last = segments[segments.length - 1];
    if (segments.length > 1 && /^[0-9a-f]{16,}$/i.test(last)) {
      return segments[segments.length - 2];
    }
    return last;
  } catch (_) {
    return url;
  }
}

function _osNetCap(body) {
  if (body === null || body === undefined) return null;
  var str = typeof body === "string" ? body : String(body);
  if (str.length > _OS_NET_MAX_BODY) {
    return str.slice(0, _OS_NET_MAX_BODY) + "…[truncated]";
  }
  return str;
}

function _osNetPush(entry) {
  var log = window.__osNetLog;
  if (!log || !log.enabled) return null;
  log.seq++;
  entry.seq = log.seq;
  entry.id = "net" + log.seq;
  log.entries.push(entry);
  if (log.entries.length > _OS_NET_MAX_ENTRIES) log.entries.shift();
  return entry;
}

/* ------------------------------------------------------------------ */
/*  START — install fetch/XHR hooks (idempotent)                       */
/* ------------------------------------------------------------------ */
function _osNetworkStart() {
  try {
    if (window.__osNetLog) {
      window.__osNetLog.enabled = true;
      return { ok: true, alreadyInstalled: true };
    }

    window.__osNetLog = { seq: 0, enabled: true, entries: [] };

    /* ---- fetch ---- */
    var origFetch = window.fetch;
    window.__osNetOrigFetch = origFetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (!_osNetIsServerCall(url)) {
        return origFetch.apply(this, arguments);
      }

      var method = (init && init.method) || (input && input.method) || "GET";
      var body = init && typeof init.body === "string" ? init.body : null;
      var headers = {};
      try {
        var rawHeaders = (init && init.headers) || (input && input.headers) || {};
        if (typeof rawHeaders.forEach === "function") {
          rawHeaders.forEach(function (v, k) { headers[k] = v; });
        } else {
          for (var k in rawHeaders) headers[k] = rawHeaders[k];
        }
      } catch (_) {}

      var entry = _osNetPush({
        method: method.toUpperCase(),
        url: url,
        endpoint: _osNetParseEndpoint(url),
        startedAt: new Date().toISOString(),
        durationMs: null,
        status: null,
        requestBody: _osNetCap(body),
        requestHeaders: headers,
        responseBody: null,
        error: null,
        replayed: !!(init && init.__osReplay),
      });
      var t0 = performance.now();

      var promise = origFetch.apply(this, arguments);
      if (!entry) return promise;

      return promise.then(function (response) {
        entry.durationMs = Math.round(performance.now() - t0);
        entry.status = response.status;
        try {
          response.clone().text().then(function (text) {
            entry.responseBody = _osNetCap(text);
          }).catch(function () {});
        } catch (_) {}
        return response;
      }).catch(function (err) {
        entry.durationMs = Math.round(performance.now() - t0);
        entry.error = err && err.message ? err.message : String(err);
        throw err;
      });
    };

    /* ---- XMLHttpRequest ---- */
    var XHR = XMLHttpRequest.prototype;
    var origOpen = XHR.open;
    var origSetHeader = XHR.setRequestHeader;
    var origSend = XHR.send;

    XHR.open = function (method, url) {
      if (_osNetIsServerCall(url)) {
        this.__osNet = { method: String(method).toUpperCase(), url: url, headers: {} };
      }
      return origOpen.apply(this, arguments);
    };
    XHR.setRequestHeader = function (name, value) {
      if (this.__osNet) this.__osNet.headers[name] = value;
      return origSetHeader.apply(this, arguments);
    };
    XHR.send = function (body) {
      var meta = this.__osNet;
      if (meta) {
        var entry = _osNetPush({
          method: meta.method,
          url: meta.url,
          endpoint: _osNetParseEndpoint(meta.url),
          startedAt: new Date().toISOString(),
          durationMs: null,
          status: null,
          requestBody: _osNetCap(typeof body === "string" ? body : null),
          requestHeaders: meta.headers,
          responseBody: null,
          error: null,
          replayed: false,
        });
        if (entry) {
          var t0 = performance.now();
          this.addEventListener("loadend", function () {
            entry.durationMs = Math.round(performance.now() - t0);
            entry.status = this.status;
            if (this.status === 0) {
              entry.error = "Network error or request aborted.";
            } else {
              try {
                if (!this.responseType || this.responseType === "text") {
                  entry.responseBody = _osNetCap(this.responseText);
                }
              } catch (_) {}
            }
          });
        }
      }
      return origSend.apply(this, arguments);
    };

    return { ok: true, alreadyInstalled: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  GET ENTRIES — drain entries newer than sinceSeq                    */
/* ------------------------------------------------------------------ */
function _osNetworkGetEntries(sinceSeq) {
  try {
    var log = window.__osNetLog;
    if (!log) return { ok: true, enabled: false, entries: [], lastSeq: 0 };

    var since = sinceSeq || 0;
    var fresh = [];
    for (var i = 0; i < log.entries.length; i++) {
      if (log.entries[i].seq > since) fresh.push(log.entries[i]);
    }
    // Also refresh recently-settled entries the panel may hold as pending
    // (response bodies arrive asynchronously) — resend the last few settled.
    return { ok: true, enabled: log.enabled, entries: fresh, lastSeq: log.seq };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Return current state of specific entries (for pending-response refresh).
 */
function _osNetworkGetByIds(ids) {
  try {
    var log = window.__osNetLog;
    if (!log) return { ok: true, entries: [] };
    var wanted = {};
    (ids || []).forEach(function (id) { wanted[id] = true; });
    var out = log.entries.filter(function (e) { return wanted[e.id]; });
    return { ok: true, entries: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  ENABLE / CLEAR                                                     */
/* ------------------------------------------------------------------ */
function _osNetworkSetEnabled(on) {
  try {
    if (!window.__osNetLog) {
      var started = _osNetworkStart();
      if (!started.ok) return started;
    }
    window.__osNetLog.enabled = !!on;
    return { ok: true, enabled: window.__osNetLog.enabled };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _osNetworkClear() {
  try {
    if (window.__osNetLog) window.__osNetLog.entries = [];
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------------ */
/*  REPLAY — re-issue a captured request                               */
/* ------------------------------------------------------------------ */
function _osNetworkReplay(id) {
  try {
    var log = window.__osNetLog;
    if (!log) return { ok: false, error: "Network inspector is not running." };

    var entry = null;
    for (var i = 0; i < log.entries.length; i++) {
      if (log.entries[i].id === id) { entry = log.entries[i]; break; }
    }
    if (!entry) return { ok: false, error: "Entry not found (may have been evicted)." };
    if (entry.requestBody && entry.requestBody.indexOf("…[truncated]") !== -1) {
      return { ok: false, error: "Request body was truncated — cannot replay faithfully." };
    }

    // The patched fetch records the replay as a new entry (flagged replayed).
    return window.fetch(entry.url, {
      method: entry.method,
      headers: entry.requestHeaders || {},
      body: entry.method === "GET" || entry.method === "HEAD" ? undefined : entry.requestBody,
      credentials: "include",
      __osReplay: true,
    }).then(function (response) {
      return { ok: true, status: response.status };
    }).catch(function (err) {
      return { ok: false, error: err.message || String(err) };
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
