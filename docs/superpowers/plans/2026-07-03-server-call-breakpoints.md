# Server Call Breakpoints & Editable Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Server Calls section pause a screenservices `fetch` in flight to edit the request before it reaches the server and the response before it reaches the client, and re-issue any captured call with an edited request.

**Architecture:** The existing MAIN-world `window.fetch` hook (`pageScript/networkInspector.js`) is rewritten to be `async` so it can `await` a "park" promise mid-flight — because the OutSystems runtime already `await`s the fetch, parking naturally suspends the call (app spinner stays up) until the side panel resumes it with edits or aborts it. The side panel discovers parked calls through its existing poll loop and renders them as editable rows pinned above the log. New service-worker dispatch entries bridge panel ↔ page as usual.

**Tech Stack:** Vanilla ES6 (Chrome 116+), no build step, no test runner. Page scripts run as plain scripts in the page MAIN world (globals, `_os`-prefixed). Panel uses ES modules. Verification is live via the Playwright MCP browser against the public demo app (no unit-test framework exists).

## Global Constraints

- No build tools, bundlers, or npm. All code must be ES6+ that Chrome 116+ runs natively. — verbatim from CLAUDE.md.
- Page scripts are plain scripts in MAIN world: use `var`/`function` globals, no `import`/`export`. Public functions use the `_os` prefix; internal helpers use `_` without `os`.
- Every public page function wraps its body in try/catch and returns `{ ok: true, ...data }` on success or `{ ok: false, error: e.message }` on failure.
- Interception is **`fetch`-only**. XHR stays capture-and-replay-only and is never paused.
- No persistence: breakpoint state and parked calls are in-memory and cleared on page reload.
- Replayed requests (`__osReplay`) are never intercepted.
- The tracer relies on wrapped functions delegating `toString()` to the original — do not touch that; it is unrelated but shares the page-script world.
- Demo app for verification (no login): `https://personal-wrs92ssk.outsystemscloud.com/OutSystemsToolkitDemo/Demo`
- Playwright verification recipe: navigate the MCP browser to the demo app, then in `browser_run_code_unsafe` inject scripts in dependency order via `await page.addScriptTag({ path: '<abs>/pageScript/helpers.js' })`, then `fiber.js`, then `networkInspector.js`. Call `_os*` globals via `page.evaluate` wrapping snippets as `(function(){...})()` or `(async function(){...})()`. Absolute repo path: `C:/Users/HP/outsystems-toolkit`.

---

## File Structure

- `pageScript/networkInspector.js` (modify) — add breakpoint state, park machinery, arming/paused/resume/abort functions, edited-replay; rewrite the `fetch` hook to `async` with request+response breakpoints. XHR hook unchanged.
- `background.js` (modify) — add five `PAGE_ACTIONS` dispatch entries.
- `sidepanel.html` (modify) — add breakpoint controls to the Server Calls header.
- `sidepanel.css` (modify) — styles for arming controls, paused banner, paused rows, editors.
- `sections/network.js` (modify) — arming-control wiring; poll for paused calls; dynamic poll cadence + poll-while-collapsed-when-armed; render + handle parked rows (continue/abort); editable replay.

---

## Task 1: Page-script interception primitives

**Files:**
- Modify: `pageScript/networkInspector.js` (add constants near line 20; add functions after `_osNetworkReplay`, i.e. after line 285)

**Interfaces:**
- Produces:
  - `window.__osNetBreak = { onRequest:boolean, onResponse:boolean, filter:string, breakNext:boolean }`
  - `window.__osNetPaused` — map `id -> { id, phase:"request"|"response", endpoint, url, method, requestHeaders, requestBody, status, responseBody, parkedAt, _resolve, _reject }`
  - `_osNetBreakState() -> object` (internal), `_osNetPausedMap() -> object` (internal), `_osNetMatchesBreak(entry) -> boolean` (internal), `_osNetPark(entry, phase, responseText) -> Promise<edits|{timedOut:true}>` (internal, rejects on abort)
  - `_osNetworkSetBreakpoints(cfg) -> { ok, breakpoints }`
  - `_osNetworkGetPaused() -> { ok, paused: [...] }`
  - `_osNetworkResume(id, phase, edits) -> { ok }`
  - `_osNetworkAbort(id) -> { ok }`

- [ ] **Step 1: Add the park-timeout constant**

In `pageScript/networkInspector.js`, after line 20 (`var _OS_NET_MAX_BODY = ...`), add:

```js
var _OS_NET_PARK_TIMEOUT_MS = 30000; // auto-continue a parked call left untouched this long
```

- [ ] **Step 2: Add state + matching + park helpers**

Append after `_osNetworkReplay` (end of file, after line 285):

```js
/* ------------------------------------------------------------------ */
/*  BREAKPOINTS — pause requests/responses in flight                   */
/* ------------------------------------------------------------------ */

function _osNetBreakState() {
  if (!window.__osNetBreak) {
    window.__osNetBreak = { onRequest: false, onResponse: false, filter: "", breakNext: false };
  }
  return window.__osNetBreak;
}

function _osNetPausedMap() {
  if (!window.__osNetPaused) window.__osNetPaused = {};
  return window.__osNetPaused;
}

/** True when this entry's endpoint/url matches the current break filter (empty = all). */
function _osNetMatchesBreak(entry) {
  var f = (_osNetBreakState().filter || "").toLowerCase();
  if (!f) return true;
  return (entry.endpoint || "").toLowerCase().indexOf(f) !== -1 ||
         (entry.url || "").toLowerCase().indexOf(f) !== -1;
}

/**
 * Suspend a call. Returns a Promise the fetch hook awaits:
 *   - resolves to an edits object (or {timedOut:true}) → continue
 *   - rejects (via _osNetworkAbort) → the app's fetch fails
 */
function _osNetPark(entry, phase, responseText) {
  var paused = _osNetPausedMap();
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      if (paused[entry.id]) {
        delete paused[entry.id];
        resolve({ timedOut: true });
      }
    }, _OS_NET_PARK_TIMEOUT_MS);

    paused[entry.id] = {
      id: entry.id,
      phase: phase,
      endpoint: entry.endpoint,
      url: entry.url,
      method: entry.method,
      requestHeaders: entry.requestHeaders,
      requestBody: entry.requestBody,
      status: entry.status,
      responseBody: phase === "response" ? _osNetCap(responseText) : null,
      parkedAt: new Date().toISOString(),
      _resolve: function (edits) { clearTimeout(timer); delete paused[entry.id]; resolve(edits || {}); },
      _reject: function (err) { clearTimeout(timer); delete paused[entry.id]; reject(err); },
    };
  });
}
```

- [ ] **Step 3: Add the public arming/paused/resume/abort functions**

Append immediately after the code from Step 2:

```js
function _osNetworkSetBreakpoints(cfg) {
  try {
    var b = _osNetBreakState();
    if (cfg) {
      if ("onRequest" in cfg) b.onRequest = !!cfg.onRequest;
      if ("onResponse" in cfg) b.onResponse = !!cfg.onResponse;
      if ("filter" in cfg) b.filter = String(cfg.filter || "");
      if ("breakNext" in cfg) b.breakNext = !!cfg.breakNext;
    }
    return { ok: true, breakpoints: { onRequest: b.onRequest, onResponse: b.onResponse, filter: b.filter, breakNext: b.breakNext } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _osNetworkGetPaused() {
  try {
    var paused = _osNetPausedMap();
    var out = [];
    for (var id in paused) {
      if (!Object.prototype.hasOwnProperty.call(paused, id)) continue;
      var p = paused[id];
      out.push({
        id: p.id, phase: p.phase, endpoint: p.endpoint, url: p.url, method: p.method,
        requestHeaders: p.requestHeaders, requestBody: p.requestBody,
        status: p.status, responseBody: p.responseBody, parkedAt: p.parkedAt,
      });
    }
    return { ok: true, paused: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _osNetworkResume(id, phase, edits) {
  try {
    var p = _osNetPausedMap()[id];
    if (!p) return { ok: false, error: "No paused request with that id (it may have timed out)." };
    if (phase && p.phase !== phase) return { ok: false, error: "Paused request is in the '" + p.phase + "' phase." };
    p._resolve(edits || {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _osNetworkAbort(id) {
  try {
    var p = _osNetPausedMap()[id];
    if (!p) return { ok: false, error: "No paused request with that id." };
    p._reject(new Error("Aborted via breakpoint"));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 4: Write the verification snippet and run it (expect FAIL before Steps 1-3, PASS after)**

With the Playwright MCP browser on the demo app and `helpers.js`, `fiber.js`, `networkInspector.js` injected (see Global Constraints), run in `browser_run_code_unsafe`:

```js
return await page.evaluate(async () => {
  const set = _osNetworkSetBreakpoints({ onRequest: true, filter: "abc" });
  const fakeEntry = { id: "net-test-1", endpoint: "DoThing", url: "/screenservices/x/DoThing", method: "POST", requestHeaders: {}, requestBody: "{}" };
  const parked = _osNetPark(fakeEntry, "request");           // returns a Promise
  const seen = _osNetworkGetPaused();                        // should list net-test-1
  const resumed = _osNetworkResume("net-test-1", "request", { body: "EDITED" });
  const edits = await parked;                                // should resolve with our edits
  return {
    setOk: set.ok && set.breakpoints.onRequest === true && set.breakpoints.filter === "abc",
    pausedCount: seen.paused.length, pausedPhase: seen.paused[0] && seen.paused[0].phase,
    resumeOk: resumed.ok, editedBody: edits.body,
    gone: _osNetworkGetPaused().paused.length,
  };
});
```

Expected result object: `{ setOk: true, pausedCount: 1, pausedPhase: "request", resumeOk: true, editedBody: "EDITED", gone: 0 }`.

- [ ] **Step 5: Commit**

```bash
git add pageScript/networkInspector.js
git commit -m "feat: page-script breakpoint primitives for server calls"
```

---

## Task 2: Async fetch hook with request breakpoint + edited replay

**Files:**
- Modify: `pageScript/networkInspector.js` (replace the `window.fetch` assignment, lines 81-131; add `_osNetworkReplayEdited` at end of file)

**Interfaces:**
- Consumes: `_osNetBreakState`, `_osNetMatchesBreak`, `_osNetPark`, `_osNetPush`, `_osNetCap`, `_osNetParseEndpoint`, `_osNetIsServerCall` (Task 1 + existing).
- Produces: rewritten `window.fetch` that honors request breakpoints; `_osNetworkReplayEdited(request) -> Promise<{ ok, status } | { ok:false, error }>` where `request = { url, method, headers, body }`. New entry field `entry.edited: boolean`.

- [ ] **Step 1: Replace the fetch hook with an async version (request breakpoint only for now)**

Replace lines 81-131 (the entire `window.fetch = function (input, init) { ... };` block) with:

```js
    window.fetch = async function (input, init) {
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

      var isReplay = !!(init && init.__osReplay);
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
        replayed: isReplay,
        edited: false,
      });

      // Effective request args (a request breakpoint may overwrite these).
      var reqUrl = url, reqMethod = method.toUpperCase(), reqHeaders = headers, reqBody = body;

      var b = _osNetBreakState();
      var wantReqBreak = !isReplay && (b.onRequest || b.breakNext) && entry && _osNetMatchesBreak(entry);
      if (wantReqBreak) {
        b.breakNext = false; // consume one-shot
        try {
          var reqEdits = await _osNetPark(entry, "request");
          if (reqEdits && !reqEdits.timedOut) {
            if (typeof reqEdits.url === "string") reqUrl = reqEdits.url;
            if (typeof reqEdits.method === "string") reqMethod = reqEdits.method.toUpperCase();
            if (reqEdits.headers && typeof reqEdits.headers === "object") reqHeaders = reqEdits.headers;
            if (typeof reqEdits.body === "string") reqBody = reqEdits.body;
            entry.url = reqUrl; entry.method = reqMethod;
            entry.requestHeaders = reqHeaders; entry.requestBody = _osNetCap(reqBody);
            entry.endpoint = _osNetParseEndpoint(reqUrl);
            entry.edited = true;
          }
        } catch (abortErr) {
          entry.error = "Aborted via breakpoint";
          entry.durationMs = 0;
          throw abortErr;
        }
      }

      var t0 = performance.now();
      var response;
      try {
        if (entry && entry.edited) {
          var reqInit = Object.assign({}, init || {}, {
            method: reqMethod,
            headers: reqHeaders,
            body: (reqMethod === "GET" || reqMethod === "HEAD") ? undefined : reqBody,
          });
          delete reqInit.__osReplay;
          response = await origFetch.call(this, reqUrl, reqInit);
        } else {
          response = await origFetch.apply(this, arguments);
        }
      } catch (err) {
        if (entry) {
          entry.durationMs = Math.round(performance.now() - t0);
          entry.error = err && err.message ? err.message : String(err);
        }
        throw err;
      }

      if (!entry) return response;

      entry.durationMs = Math.round(performance.now() - t0);
      entry.status = response.status;
      var text = null;
      try { text = await response.clone().text(); } catch (_) {}
      entry.responseBody = _osNetCap(text);

      return response;
    };
```

Note: the response body is now read with `await response.clone().text()` (Task 3 needs `text`); this replaces the old fire-and-forget `.then` read.

- [ ] **Step 2: Add `_osNetworkReplayEdited` at end of file**

Append after `_osNetworkAbort`:

```js
/* Re-issue a request with panel-supplied edits (powers editable replay). */
function _osNetworkReplayEdited(request) {
  try {
    if (!window.__osNetLog) return { ok: false, error: "Network inspector is not running." };
    if (!request || !request.url) return { ok: false, error: "Missing request URL." };
    var method = (request.method || "GET").toUpperCase();
    return window.fetch(request.url, {
      method: method,
      headers: request.headers || {},
      body: (method === "GET" || method === "HEAD") ? undefined : (request.body || null),
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
```

- [ ] **Step 3: Verify request breakpoint end-to-end against the demo app**

With scripts injected and `_osNetworkStart()` called, run in `browser_run_code_unsafe`:

```js
return await page.evaluate(async () => {
  _osNetworkStart();
  _osNetworkSetBreakpoints({ onRequest: true, filter: "" });
  // Fire a screenservices call directly (edited path is exercised on resume).
  const url = "/screenservices/OutSystemsToolkitDemo/Demo/DoesNotExist/probe";
  const p = fetch(url, { method: "POST", body: JSON.stringify({ a: 1 }) }).then(r => r.status).catch(() => "neterr");
  // Wait a tick for the hook to park it.
  await new Promise(r => setTimeout(r, 50));
  const paused = _osNetworkGetPaused().paused;
  const id = paused[0] && paused[0].id;
  const resumed = _osNetworkResume(id, "request", { body: JSON.stringify({ a: 2 }) });
  await p; // let it complete (404 or network error is fine)
  const entry = window.__osNetLog.entries.find(e => e.id === id);
  return { parked: paused.length, resumeOk: resumed.ok, edited: entry && entry.edited, sentBody: entry && entry.requestBody };
});
```

Expected: `{ parked: 1, resumeOk: true, edited: true, sentBody: "{\"a\":2}" }` (status of the call itself is irrelevant — the demo endpoint may 404; we only assert the edit was applied).

- [ ] **Step 4: Verify abort path**

```js
return await page.evaluate(async () => {
  _osNetworkSetBreakpoints({ onRequest: true, filter: "" });
  const url = "/screenservices/OutSystemsToolkitDemo/Demo/DoesNotExist/probe2";
  let outcome = "pending";
  const p = fetch(url, { method: "POST", body: "{}" }).then(() => outcome = "resolved").catch(() => outcome = "rejected");
  await new Promise(r => setTimeout(r, 50));
  const id = _osNetworkGetPaused().paused[0].id;
  _osNetworkAbort(id);
  await p;
  const entry = window.__osNetLog.entries.find(e => e.id === id);
  return { outcome, entryError: entry && entry.error };
});
```

Expected: `{ outcome: "rejected", entryError: "Aborted via breakpoint" }`.

- [ ] **Step 5: Verify capture still works with no breakpoints (regression)**

```js
return await page.evaluate(async () => {
  _osNetworkSetBreakpoints({ onRequest: false, onResponse: false });
  const before = window.__osNetLog.entries.length;
  await fetch("/screenservices/OutSystemsToolkitDemo/Demo/DoesNotExist/probe3", { method: "POST", body: "{}" }).catch(() => {});
  await new Promise(r => setTimeout(r, 100));
  const e = window.__osNetLog.entries[window.__osNetLog.entries.length - 1];
  return { grew: window.__osNetLog.entries.length > before, hasStatusOrError: e.status !== null || !!e.error, hasResponseOrError: e.responseBody !== null || !!e.error };
});
```

Expected: `{ grew: true, hasStatusOrError: true, hasResponseOrError: true }`.

- [ ] **Step 6: Commit**

```bash
git add pageScript/networkInspector.js
git commit -m "feat: async fetch hook with request breakpoint and edited replay"
```

---

## Task 3: Response breakpoint + response rewrite

**Files:**
- Modify: `pageScript/networkInspector.js` (extend the async fetch hook added in Task 2, just before its final `return response;`)

**Interfaces:**
- Consumes: `b` (break state), `entry`, `text`, `response`, `_osNetMatchesBreak`, `_osNetPark`, `_osNetCap` (in scope from Task 2's hook).
- Produces: the fetch hook now parks in the `"response"` phase when `onResponse` is armed and replaces the delivered `Response` when edited.

- [ ] **Step 1: Insert the response-breakpoint block**

In the `window.fetch` hook, find:

```js
      var text = null;
      try { text = await response.clone().text(); } catch (_) {}
      entry.responseBody = _osNetCap(text);

      return response;
    };
```

Replace it with:

```js
      var text = null;
      try { text = await response.clone().text(); } catch (_) {}
      entry.responseBody = _osNetCap(text);

      if (b.onResponse && _osNetMatchesBreak(entry)) {
        try {
          var respEdits = await _osNetPark(entry, "response", text);
          if (respEdits && !respEdits.timedOut &&
              (typeof respEdits.responseBody === "string" || typeof respEdits.status === "number")) {
            var newBody = typeof respEdits.responseBody === "string" ? respEdits.responseBody : text;
            var newStatus = typeof respEdits.status === "number" ? respEdits.status : response.status;
            entry.responseBody = _osNetCap(newBody);
            entry.status = newStatus;
            entry.edited = true;
            try {
              response = new Response(newBody, { status: newStatus, statusText: response.statusText, headers: response.headers });
            } catch (_) {
              response = new Response(newBody, { headers: response.headers });
            }
          }
        } catch (abortErr) {
          entry.error = "Aborted via breakpoint";
          throw abortErr;
        }
      }

      return response;
    };
```

- [ ] **Step 2: Verify the delivered response body is rewritten**

```js
return await page.evaluate(async () => {
  _osNetworkStart();
  _osNetworkSetBreakpoints({ onRequest: false, onResponse: true, filter: "" });
  const url = "/screenservices/OutSystemsToolkitDemo/Demo/DoesNotExist/probe4";
  const p = fetch(url, { method: "POST", body: "{}" }).then(r => r.text());
  await new Promise(r => setTimeout(r, 80));
  const paused = _osNetworkGetPaused().paused;
  const id = paused[0] && paused[0].id;
  const phase = paused[0] && paused[0].phase;
  _osNetworkResume(id, "response", { responseBody: '{"injected":true}', status: 200 });
  const delivered = await p;
  return { phase, delivered };
});
```

Expected: `{ phase: "response", delivered: "{\"injected\":true}" }` — the app-visible body is the injected one, regardless of what the server actually returned.

- [ ] **Step 3: Verify request→response both-phase sequencing**

```js
return await page.evaluate(async () => {
  _osNetworkSetBreakpoints({ onRequest: true, onResponse: true, filter: "" });
  const url = "/screenservices/OutSystemsToolkitDemo/Demo/DoesNotExist/probe5";
  const p = fetch(url, { method: "POST", body: "{}" }).then(r => r.text()).catch(() => "err");
  const phases = [];
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 80));
    const pk = _osNetworkGetPaused().paused[0];
    if (!pk) break;
    phases.push(pk.phase);
    _osNetworkResume(pk.id, pk.phase, {});
  }
  await p;
  return { phases };
});
```

Expected: `{ phases: ["request", "response"] }`.

- [ ] **Step 4: Commit**

```bash
git add pageScript/networkInspector.js
git commit -m "feat: response breakpoint with response rewrite for server calls"
```

---

## Task 4: Service-worker dispatch entries

**Files:**
- Modify: `background.js` (add to the `PAGE_ACTIONS` table, after line 226 `NETWORK_REPLAY:` entry)

**Interfaces:**
- Consumes: `_osNetworkSetBreakpoints`, `_osNetworkGetPaused`, `_osNetworkResume`, `_osNetworkAbort`, `_osNetworkReplayEdited` (Tasks 1-2).
- Produces: message actions `NETWORK_SET_BREAKPOINTS { breakpoints }`, `NETWORK_GET_PAUSED`, `NETWORK_RESUME { id, phase, edits }`, `NETWORK_ABORT { id }`, `NETWORK_REPLAY_EDITED { request }`.

- [ ] **Step 1: Add the five dispatch entries**

In `background.js`, immediately after the `NETWORK_REPLAY:` line (226), add:

```js
  NETWORK_SET_BREAKPOINTS:   { func: (cfg) => _osNetworkSetBreakpoints(cfg),         args: msg => [msg.breakpoints || {}] },
  NETWORK_GET_PAUSED:        { func: () => _osNetworkGetPaused(),                    args: () => [] },
  NETWORK_RESUME:            { func: (id, phase, edits) => _osNetworkResume(id, phase, edits), args: msg => [msg.id, msg.phase, msg.edits || {}] },
  NETWORK_ABORT:             { func: (id) => _osNetworkAbort(id),                    args: msg => [msg.id] },
  NETWORK_REPLAY_EDITED:     { func: (req) => _osNetworkReplayEdited(req),           args: msg => [msg.request || {}] },
```

- [ ] **Step 2: Verify the extension loads and the round-trip works**

Load unpacked (`chrome://extensions` → reload the toolkit), open the demo app, open the side panel and let it scan. Open the side panel's DevTools console and run:

```js
chrome.runtime.sendMessage({ action: "NETWORK_SET_BREAKPOINTS", breakpoints: { onRequest: true, filter: "" } }, r => console.log("set", r));
chrome.runtime.sendMessage({ action: "NETWORK_GET_PAUSED" }, r => console.log("paused", r));
```

Expected console output: `set { ok: true, breakpoints: { onRequest: true, ... } }` and `paused { ok: true, paused: [] }`. No errors in the service-worker console.

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: dispatch entries for server call breakpoints"
```

---

## Task 5: Breakpoint controls markup + styles

**Files:**
- Modify: `sidepanel.html` (insert a controls block inside `#network-section`, after line 223 `</div>` closing `.producer-search-wrapper`, before line 224 `<div id="network-list">`)
- Modify: `sidepanel.css` (append new rules at end of file)

**Interfaces:**
- Produces DOM ids/classes consumed by Task 6: `#btn-break-request`, `#btn-break-response`, `#input-break-filter`, `#btn-break-next`, `#btn-break-release`.

- [ ] **Step 1: Add the controls markup**

In `sidepanel.html`, between line 223 (`</div>` closing `.producer-search-wrapper`) and line 224 (`<div id="network-list" ...>`), insert:

```html
      <div class="net-break-bar">
        <span class="net-break-label">Breakpoints:</span>
        <button id="btn-break-request" class="filter-toggle net-break-toggle" title="Pause matching calls before they are sent">Request</button>
        <button id="btn-break-response" class="filter-toggle net-break-toggle" title="Pause matching calls before the app sees the response">Response</button>
        <input id="input-break-filter" class="net-break-filter" type="text" placeholder="endpoint filter (all)" autocomplete="off" />
        <button id="btn-break-next" class="filter-toggle" title="Pause only the next matching call">Break next</button>
        <button id="btn-break-release" class="filter-toggle" title="Continue all paused calls unmodified">Release all</button>
      </div>
```

- [ ] **Step 2: Add styles**

Append to `sidepanel.css`:

```css
/* --- Server call breakpoints --- */
.net-break-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 8px 8px; }
.net-break-label { font-size: 11px; opacity: 0.7; }
.net-break-toggle.active { background: var(--accent, #2d6cdf); color: #fff; border-color: var(--accent, #2d6cdf); }
.net-break-filter { flex: 1 1 120px; min-width: 90px; font-size: 12px; padding: 3px 6px; }

.net-paused-banner {
  padding: 5px 8px; margin: 2px 0 6px; border-radius: 4px;
  background: #b8860b22; color: #b8860b; font-size: 11px; font-weight: 600;
  border: 1px solid #b8860b55;
}
.net-row-paused { border-left: 3px solid #b8860b; background: #b8860b11; }
.net-paused-phase { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #b8860b; font-weight: 700; }
.net-edit-label { font-size: 10px; opacity: 0.7; margin: 6px 0 2px; text-transform: uppercase; letter-spacing: 0.03em; }
.net-edit-input { width: 100%; box-sizing: border-box; font-size: 12px; padding: 3px 6px; }
.net-edit-area { width: 100%; box-sizing: border-box; min-height: 80px; font-family: monospace; font-size: 11px; padding: 4px 6px; resize: vertical; }
.net-edit-warn { font-size: 10px; color: #c0392b; min-height: 12px; }
.net-edit-actions { display: flex; gap: 6px; margin-top: 6px; }
.btn-net-abort { background: #c0392b; color: #fff; border-color: #c0392b; }
```

- [ ] **Step 3: Verify controls render**

Reload the extension, open the panel on the demo app, expand Server Calls. Expected: a "Breakpoints:" row with Request / Response toggle buttons, a filter input, and Break-next / Release-all buttons. Buttons are clickable but do nothing yet (no wiring). No layout breakage of the existing search bar.

- [ ] **Step 4: Commit**

```bash
git add sidepanel.html sidepanel.css
git commit -m "feat: breakpoint controls markup and styles for Server Calls"
```

---

## Task 6: Panel wiring — arming, polling, and parked rows

**Files:**
- Modify: `sections/network.js` (state block ~lines 16-38; `init` ~44-73; `poll` ~134-184; `render` ~105-128; add handlers + `buildPausedRow`)

**Interfaces:**
- Consumes: actions `NETWORK_SET_BREAKPOINTS`, `NETWORK_GET_PAUSED`, `NETWORK_RESUME`, `NETWORK_ABORT` (Task 4); DOM ids from Task 5.
- Produces: `paused` state array of `{ id, phase, endpoint, url, method, requestHeaders, requestBody, status, responseBody }`; parked rows with `.btn-net-continue` / `.btn-net-abort`.

- [ ] **Step 1: Add state + constants + DOM refs**

In `sections/network.js`, after line 17 (`const POLL_MS = 1200;`) add:

```js
const ACTIVE_POLL_MS = 300; // faster cadence while a breakpoint is armed or a call is parked
```

After line 26 (`const expandedIds = new Set();`) add:

```js
let paused = [];                 // parked calls from the page
let breakOnRequest = false;
let breakOnResponse = false;
let breakFilter = "";
```

After line 36 (`const clearBtn = ...`) add:

```js
const breakReqBtn = document.getElementById("btn-break-request");
const breakRespBtn = document.getElementById("btn-break-response");
const breakFilterInput = document.getElementById("input-break-filter");
const breakNextBtn = document.getElementById("btn-break-next");
const breakReleaseBtn = document.getElementById("btn-break-release");
```

- [ ] **Step 2: Convert polling to self-scheduling and add arming listeners in `init`**

In `init`, replace the last line `pollTimer = setInterval(poll, POLL_MS);` with:

```js
  breakReqBtn.addEventListener("click", () => { breakOnRequest = !breakOnRequest; pushBreakpoints(); });
  breakRespBtn.addEventListener("click", () => { breakOnResponse = !breakOnResponse; pushBreakpoints(); });
  breakFilterInput.addEventListener("input", debounce(() => { breakFilter = breakFilterInput.value.trim(); pushBreakpoints(); }, 200));
  breakNextBtn.addEventListener("click", handleBreakNext);
  breakReleaseBtn.addEventListener("click", handleReleaseAll);

  scheduleNextPoll();
```

Add these functions after `init` (before `setData`):

```js
function isActive() { return breakOnRequest || breakOnResponse || paused.length > 0; }

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, isActive() ? ACTIVE_POLL_MS : POLL_MS);
}

async function pushBreakpoints() {
  updateBreakUI();
  await sendMessage({ action: "NETWORK_SET_BREAKPOINTS", breakpoints: { onRequest: breakOnRequest, onResponse: breakOnResponse, filter: breakFilter } }).catch(() => null);
  scheduleNextPoll();
}

function updateBreakUI() {
  breakReqBtn.classList.toggle("active", breakOnRequest);
  breakRespBtn.classList.toggle("active", breakOnResponse);
}

async function handleBreakNext() {
  const r = await sendMessage({ action: "NETWORK_SET_BREAKPOINTS", breakpoints: { breakNext: true } }).catch(() => null);
  if (r?.ok) toast("Armed — next matching call will pause.", "info");
  scheduleNextPoll();
}

async function handleReleaseAll() {
  const toRelease = paused.slice();
  for (const p of toRelease) {
    await sendMessage({ action: "NETWORK_RESUME", id: p.id, phase: p.phase, edits: {} }).catch(() => null);
  }
  poll();
}
```

Note `pollTimer` is now managed by `setTimeout`; the existing `let pollTimer = null;` (line 24) is reused unchanged.

- [ ] **Step 3: Rewrite `poll` to fetch paused calls and self-schedule**

Replace the entire `poll` function (lines 134-184) with:

```js
async function poll() {
  try {
    if (!scanned || pollInFlight) return;
    if (sectionEl.classList.contains("hidden")) return;
    if (!isActive() && sectionEl.classList.contains("collapsed")) return;

    pollInFlight = true;
    try {
      const result = await sendMessage({ action: "NETWORK_GET_ENTRIES", sinceSeq: lastSeq }).catch(() => null);
      let changed = false;

      if (result?.ok) {
        if (result.lastSeq < lastSeq) { entries = []; expandedIds.clear(); lastSeq = 0; }
        enabled = !!result.enabled;
        updateToggleUI();

        if (result.entries.length > 0) {
          for (const entry of result.entries) entries.push(entry);
          while (entries.length > MAX_PANEL_ENTRIES) entries.shift();
          lastSeq = result.lastSeq;
          changed = true;
        }

        const pendingIds = entries.filter(en => en.status === null && !en.error).map(en => en.id);
        if (pendingIds.length > 0) {
          const refresh = await sendMessage({ action: "NETWORK_GET_BY_IDS", ids: pendingIds }).catch(() => null);
          if (refresh?.ok && refresh.entries.length > 0) {
            for (const fresh of refresh.entries) {
              const idx = entries.findIndex(en => en.id === fresh.id);
              if (idx !== -1 && (entries[idx].status !== fresh.status || entries[idx].responseBody !== fresh.responseBody)) {
                entries[idx] = fresh;
                changed = true;
              }
            }
          }
        }
      }

      const pausedRes = await sendMessage({ action: "NETWORK_GET_PAUSED" }).catch(() => null);
      if (pausedRes?.ok) {
        const next = pausedRes.paused || [];
        if (next.length !== paused.length || next.some((p, i) => !paused[i] || paused[i].id !== p.id || paused[i].phase !== p.phase)) {
          changed = true;
        }
        paused = next;
      }

      if (changed) render();
    } finally {
      pollInFlight = false;
    }
  } finally {
    scheduleNextPoll();
  }
}
```

- [ ] **Step 4: Render parked rows at the top of the log**

Replace the `render` function (lines 105-128) with:

```js
export function render() {
  countEl.textContent = entries.length;

  const filtered = searchTerm
    ? entries.filter(en =>
        (en.endpoint || "").toLowerCase().includes(searchTerm) ||
        (en.url || "").toLowerCase().includes(searchTerm))
    : entries;

  let html = "";
  if (paused.length > 0) {
    html += `<div class="net-paused-banner">${paused.length} paused — the app is waiting</div>`;
    for (const p of paused) html += buildPausedRow(p);
  }

  if (filtered.length === 0 && paused.length === 0) {
    const msg = entries.length === 0
      ? (enabled ? "Listening for server calls — interact with the app…" : "Capture paused.")
      : "No calls match your search.";
    listEl.innerHTML = `<div class="net-empty">${esc(msg)}</div>`;
    return;
  }

  for (let i = filtered.length - 1; i >= 0; i--) html += buildRow(filtered[i]);
  listEl.innerHTML = html;
}
```

- [ ] **Step 5: Add `buildPausedRow` and its handlers**

Add `buildPausedRow` after `buildRow` (end of file):

```js
function buildPausedRow(p) {
  const headersJson = prettyJson(JSON.stringify(p.requestHeaders || {}));
  let editor;
  if (p.phase === "request") {
    editor = `
      <div class="net-edit-label">URL</div>
      <input class="net-edit-input net-edit-url" value="${escAttr(p.url)}" />
      <div class="net-edit-label">Method</div>
      <input class="net-edit-input net-edit-method" value="${escAttr(p.method)}" />
      <div class="net-edit-label">Headers (JSON)</div>
      <textarea class="net-edit-area net-edit-headers">${esc(headersJson)}</textarea>
      <div class="net-edit-label">Body</div>
      <textarea class="net-edit-area net-edit-body">${esc(prettyJson(p.requestBody))}</textarea>`;
  } else {
    editor = `
      <div class="net-edit-label">Status</div>
      <input class="net-edit-input net-edit-status" value="${escAttr(String(p.status == null ? 200 : p.status))}" />
      <div class="net-edit-label">Response body</div>
      <textarea class="net-edit-area net-edit-resp">${esc(prettyJson(p.responseBody))}</textarea>`;
  }
  return `
  <div class="var-row net-row net-row-paused" data-id="${escAttr(p.id)}" data-phase="${escAttr(p.phase)}">
    <div class="net-row-main">
      <span class="net-paused-phase">${esc(p.phase)}</span>
      <span class="net-endpoint" title="${escAttr(p.url)}">${esc(p.endpoint)}</span>
    </div>
    <div class="net-details">
      ${editor}
      <div class="net-edit-actions">
        <button class="btn-trigger-action btn-net-continue" data-id="${escAttr(p.id)}" data-phase="${escAttr(p.phase)}">Continue</button>
        <button class="btn-trigger-action btn-net-abort" data-id="${escAttr(p.id)}">Abort</button>
      </div>
    </div>
  </div>`;
}
```

Add the click handlers to the existing `listEl.addEventListener("click", ...)` in `init`, at the very top of the callback (before the `.btn-net-replay` check):

```js
    const continueBtn = e.target.closest(".btn-net-continue");
    if (continueBtn) {
      e.stopPropagation();
      handleContinue(continueBtn.closest(".net-row-paused"));
      return;
    }
    const abortBtn = e.target.closest(".btn-net-abort");
    if (abortBtn) {
      e.stopPropagation();
      handleAbort(abortBtn.dataset.id);
      return;
    }
```

Add these handler functions near `handleReplay`:

```js
async function handleContinue(row) {
  const id = row.dataset.id;
  const phase = row.dataset.phase;
  let edits = {};
  if (phase === "request") {
    edits.url = row.querySelector(".net-edit-url").value;
    edits.method = row.querySelector(".net-edit-method").value.trim();
    edits.body = row.querySelector(".net-edit-body").value;
    const rawHeaders = row.querySelector(".net-edit-headers").value;
    try { edits.headers = JSON.parse(rawHeaders); } catch { /* keep original headers on invalid JSON */ }
  } else {
    const statusNum = parseInt(row.querySelector(".net-edit-status").value, 10);
    if (!Number.isNaN(statusNum)) edits.status = statusNum;
    edits.responseBody = row.querySelector(".net-edit-resp").value;
  }
  const r = await sendMessage({ action: "NETWORK_RESUME", id, phase, edits }).catch(() => null);
  if (r?.ok) { toast("Continued.", "success"); poll(); }
  else toast(r?.error || "Could not continue.", "error");
}

async function handleAbort(id) {
  const r = await sendMessage({ action: "NETWORK_ABORT", id }).catch(() => null);
  if (r?.ok) { toast("Aborted.", "info"); poll(); }
  else toast(r?.error || "Could not abort.", "error");
}
```

- [ ] **Step 6: Verify the full breakpoint flow in the real UI**

Reload the extension, open the demo app + panel, scan, expand Server Calls. Click **Request** (turns active). Interact with the demo app so it makes a server call (e.g. trigger any data-loading action / navigate a screen). Expected:
1. A gold "1 paused — the app is waiting" banner appears with an editable request row; the app's UI is visibly waiting.
2. Edit the Body, click **Continue** → the parked row disappears, the app proceeds, and a new normal log entry shows the (edited) call.
3. Repeat, click **Abort** instead → the app shows a failed/error state for that call and the entry is flagged `ERR`.
4. Turn on **Response**, trigger a call, edit the response body, **Continue** → the app renders the modified data.
5. With Request armed, collapse the section, trigger a call, wait — confirm it still auto-continues after 30s (safety timeout) even though collapsed; or expand and Continue it.

- [ ] **Step 7: Commit**

```bash
git add sections/network.js
git commit -m "feat: panel wiring for server call breakpoints (arming, polling, parked rows)"
```

---

## Task 7: Editable replay in the log rows

**Files:**
- Modify: `sections/network.js` (`buildRow` details section ~lines 259-278; add `.btn-net-replay-edited` handler + `handleReplayEdited`)

**Interfaces:**
- Consumes: action `NETWORK_REPLAY_EDITED { request }` (Task 4).
- Produces: an editable request body/headers in expanded normal rows plus a "Replay with edits" button.

- [ ] **Step 1: Make the expanded request editable and add the button**

In `buildRow`, replace the `details` block (lines 260-277, the `if (isExpanded) { details = \`...\`; }` body) with:

```js
    details = `
    <div class="net-details">
      <div class="net-detail-url">${esc(entry.method)} ${esc(entry.url)}</div>
      <div class="net-edit-label">Request headers (JSON)</div>
      <textarea class="net-edit-area net-replay-headers">${esc(prettyJson(JSON.stringify(entry.requestHeaders || {})))}</textarea>
      <div class="net-edit-label">Request body</div>
      <textarea class="net-edit-area net-replay-body">${esc(prettyJson(entry.requestBody))}</textarea>
      <div class="net-detail-label">Response</div>
      <pre class="net-payload">${esc(entry.error ? entry.error : prettyJson(entry.responseBody))}</pre>
      <div class="net-detail-actions">
        <button class="btn-trigger-action btn-net-replay" data-id="${escAttr(entry.id)}" title="Re-issue this request as captured">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Replay
        </button>
        <button class="btn-trigger-action btn-net-replay-edited" data-id="${escAttr(entry.id)}" data-url="${escAttr(entry.url)}" data-method="${escAttr(entry.method)}" title="Re-issue with the edits above">
          Replay with edits
        </button>
      </div>
    </div>`;
```

- [ ] **Step 2: Add the handler**

In the `listEl` click callback in `init`, add before the `.btn-net-replay` check (but after the paused-row checks from Task 6):

```js
    const replayEditedBtn = e.target.closest(".btn-net-replay-edited");
    if (replayEditedBtn) {
      e.stopPropagation();
      handleReplayEdited(replayEditedBtn.closest(".net-row"), replayEditedBtn.dataset.url, replayEditedBtn.dataset.method);
      return;
    }
```

Add the handler near `handleReplay`:

```js
async function handleReplayEdited(row, url, method) {
  const request = { url, method };
  request.body = row.querySelector(".net-replay-body").value;
  const rawHeaders = row.querySelector(".net-replay-headers").value;
  try { request.headers = JSON.parse(rawHeaders); } catch { request.headers = {}; }
  const r = await sendMessage({ action: "NETWORK_REPLAY_EDITED", request }).catch(() => null);
  if (r?.ok) { toast(`Replayed (edited) — HTTP ${r.status}`, "success"); poll(); }
  else toast(r?.error || "Replay failed.", "error");
}
```

Note: `.btn-net-replay` must be matched with `.closest(".net-row")` for its own row — the existing `handleReplay(replayBtn.dataset.id)` is unchanged and still works.

- [ ] **Step 3: Verify editable replay**

Reload the extension, open the demo app + panel, scan, trigger a server call so a row appears. Expand it. Edit the request body, click **Replay with edits**. Expected: a toast `Replayed (edited) — HTTP <status>`, and a new row appears flagged `replay` whose recorded request body matches your edit (expand it to confirm).

- [ ] **Step 4: Commit**

```bash
git add sections/network.js
git commit -m "feat: editable replay for captured server calls"
```

---

## Self-Review Notes

- **Spec coverage:** editable replay → Tasks 2+7; break-on-request → Tasks 1-2+6; break-on-response + Response rewrite → Tasks 3+6; arming model (toggles + filter + break-next) → Tasks 5-6; parked-row UX (pinned, editable, continue/abort) → Task 6; safety (auto-continue timeout → Task 1; poll-while-armed + faster cadence → Task 6; release-all → Task 6); fetch-only boundary → enforced by hook (Tasks 2-3), XHR untouched; both platforms → same fetch seam that already captures both (verified via demo app; ODC re-check is the app-level verification in Task 6 against an ODC app if available).
- **Placeholder scan:** none — every code step contains full code; every verify step has a runnable snippet and an expected result.
- **Type consistency:** `edits` shape `{url, method, headers, body}` (request) / `{status, responseBody}` (response) is identical in `_osNetPark` consumers (Tasks 2-3), `_osNetworkResume` (Task 1), and the panel senders (Tasks 6). Field `entry.edited` introduced in Task 2 and read in Tasks 2-3. `paused` entry shape matches `_osNetworkGetPaused` output (Task 1) and `buildPausedRow` reads (Task 6).
- **Open verification item:** ODC uses the same `fetch` seam as Reactive (the existing capture already sees both), so interception should work identically; confirm on an ODC app during Task 6 if one is reachable, otherwise note Reactive-verified and ODC-by-construction.
