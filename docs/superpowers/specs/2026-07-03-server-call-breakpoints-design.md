# Server Call Breakpoints & Editable Replay — Design

**Status:** Awaiting user review
**Date:** 2026-07-03
**Section:** Server Calls (`sections/network.js`, `pageScript/networkInspector.js`)

## Goal

Turn the read-only Server Calls log into an active debugging tool. Two capabilities:

1. **Editable replay** — re-issue a captured call with a modified URL, headers, and/or body.
2. **Breakpoints** — pause a server call *in flight*, edit the request before it reaches
   the server and/or the response before it reaches the client, then continue.

Editable replay (#1) is a subset of the breakpoint machinery (#2): both need a
"send this possibly-edited request" primitive and an editor UI. They share code.

## Why this is feasible

The existing inspector patches `window.fetch` and `XMLHttpRequest` in the page's
MAIN world (`_osNetworkStart`, networkInspector.js:69). That hook is the exact seam
we need:

- The hook runs *inside* the app's request path. Because the OutSystems runtime
  `await`s the fetch promise, the hook can **block the real request by awaiting a
  promise of its own** — the app simply shows its spinner until we resume. This is
  what makes a true breakpoint (not just an after-the-fact log) possible.
- The same hook already captures both Reactive and ODC screenservices calls, so
  interception inherits cross-platform support with no new discovery logic.

## Scope & boundaries

- **`fetch` only for interception.** Modern OutSystems Reactive and ODC screenservices
  calls go through `fetch`. Rewriting an `XMLHttpRequest`'s `responseText` in place is
  not practically possible without faking the whole XHR object, and modifying an XHR
  request after `send()` requires an abort/re-open dance. **XHR calls continue to be
  captured and are replayable, but are never paused/intercepted.** The UI marks XHR
  rows as non-breakable. (First implementation task: confirm the target apps' calls are
  `fetch` — expected given the existing capture already sees them.)
- **No persistence.** Breakpoint arming state and parked requests live in memory only.
  A page reload clears them (consistent with the existing ring-buffer behavior).

## Arming model (how a user chooses what to pause)

DevTools-like, chosen for familiarity and minimal UI:

- **`Break on request`** toggle — pause matching calls *before* they are sent.
- **`Break on response`** toggle — pause matching calls *after* the server responds,
  *before* the app sees the body.
- **Endpoint filter** (text) — substring matched against the endpoint name / URL.
  Empty = match all. Independent of the existing log search box.
- **`Break on next`** button — one-shot: arms a single pause for the next matching
  call, then auto-disarms. Lowest risk of accidentally freezing the app during a busy
  screen.

Replayed requests (`__osReplay`) are never intercepted, to avoid a replay-pauses-itself loop.

## Parked-request UX

Parked calls are the priority surface, so they are **pinned at the top of the list**
with a distinct "paused" style, above the normal (newest-first) log. Each parked row
is expanded by default and shows:

- **Request phase:** editable URL (single line), editable headers (key/value or raw
  JSON textarea), editable body (textarea, pretty-printed JSON). Buttons: **Continue**
  (send with edits) and **Abort** (fail the call with a network error).
- **Response phase:** read-only request summary + editable status and editable response
  body (textarea). Buttons: **Continue** (deliver edited body) and **Abort**.

A request that breaks on both phases surfaces twice in sequence: first in the request
phase; after Continue and the server round-trip, again in the response phase.

Multiple concurrent parked calls are supported — each is an independent row awaiting its
own resume.

## Safety

A parked request holds the app's UI hostage (expected for a breakpoint), but must never
hang *forever*:

- **Auto-continue timeout.** A parked call left untouched for `PARK_TIMEOUT_MS`
  (default 30s) auto-continues unmodified. Prevents a closed/crashed panel from freezing
  the app permanently.
- **Poll-while-armed.** Normally the section polls only while expanded (network.js:135).
  While any breakpoint is armed *or* any call is parked, polling continues even if the
  section is collapsed, so parked calls always surface and can be resumed.
- **Faster poll while active.** Poll interval drops from `POLL_MS` (1200ms) to
  `ACTIVE_POLL_MS` (~300ms) while armed/parked so pauses feel responsive; reverts when idle.
- **Release-all.** A visible control (and disarming all breakpoints) continues every
  parked call unmodified.

## Data flow

### New page-script functions (`pageScript/networkInspector.js`)

State: `window.__osNetBreak = { onRequest, onResponse, filter, breakNext }` and
`window.__osNetPaused = { <id>: { entry, phase, resolve, parkedAt, snapshot } }`.

- `_osNetworkSetBreakpoints({onRequest, onResponse, filter, breakNext})` — set arming state.
- `_osNetworkGetPaused()` — return parked calls with phase + current request/response data.
- `_osNetworkResume(id, phase, edits)` — resolve the parked promise with edits → hook
  continues. `edits` carries `{url, method, headers, body}` (request) or
  `{status, responseBody}` (response). Missing fields = use original.
- `_osNetworkAbort(id)` — reject the parked promise → the app's call fails with an error.
- `_osNetworkReplayEdited({url, method, headers, body})` — fire an edited request
  (powers editable replay; records a new `replayed` entry as today).

Internal helper `_osNetPark(entry, phase, data)` returns a Promise stored in
`__osNetPaused`, resolved by `_osNetworkResume`/`_osNetworkAbort` or the auto-timeout.

### Rewritten fetch hook (async)

```
window.fetch = async function (input, init) {
  if (!serverCall) return origFetch(...)
  entry = record(...)                          // as today
  if (breakOnRequest && matches && !replay) {
    edits = await _osNetPark(entry, 'request') // or throws on abort
    apply edits to url/method/headers/body
  }
  response = await origFetch(editedArgs)
  entry.status/duration = ...
  text = await response.clone().text()         // now awaited (needed for response phase)
  entry.responseBody = cap(text)
  if (breakOnResponse && matches) {
    edits = await _osNetPark(entry, 'response', text) // or throws on abort
    if (changed) response = new Response(edits.responseBody,
                                         { status: edits.status, headers: response.headers })
  }
  return response
}
```

XHR hook is unchanged (capture only).

### New service-worker actions (`background.js` `PAGE_ACTIONS`)

`NETWORK_SET_BREAKPOINTS`, `NETWORK_GET_PAUSED`, `NETWORK_RESUME`, `NETWORK_ABORT`,
`NETWORK_REPLAY_EDITED` — each mapped to its `_osNetwork*` function following the
existing dispatch-table pattern.

### Panel (`sections/network.js`)

- New DOM: breakpoint toggles, filter input, "Break on next" and "Release all" in the
  section header (added to `sidepanel.html`).
- Poll loop also calls `NETWORK_GET_PAUSED`; parked calls render pinned at top.
- Handlers for Continue / Abort / edited-replay send the corresponding actions.
- Poll cadence + poll-while-collapsed logic updated per Safety section.

## Error handling

- Abort surfaces to the app as a rejected fetch (its normal error path) and the entry is
  flagged `error: "Aborted via breakpoint"`.
- Editing an invalid body (non-JSON) is allowed — sent as-is (raw text). No forced JSON
  validation, but the editor flags unparseable JSON as a non-blocking warning.
- `new Response(...)` preserves the original response headers (notably `content-type`).
- If the panel disconnects mid-park, the auto-continue timeout releases the call.

## Testing

Live verification against the demo app via Playwright (per project convention: inject
page scripts with `addScriptTag`, drive a screen that issues a screenservices call):

1. Capture still works unchanged (regression).
2. Editable replay: edit a body, replay, confirm the server receives the edited payload.
3. Break-on-request: arm, trigger a call, confirm it parks; edit + Continue; confirm the
   server received edits; Abort; confirm the app sees a failed call.
4. Break-on-response: arm, trigger, edit response body/status + Continue; confirm the app
   renders the modified data.
5. Safety: park a call and let it auto-continue after the timeout; confirm no hang.
6. Both platforms: repeat request/response break on a Reactive and an ODC app.

## Out of scope (YAGNI)

- Persisting breakpoints across reloads.
- XHR interception.
- Rule lists / regex matching (substring filter only).
- Modifying response headers (only status + body are editable).
