# Design: Server Call Inspector, Action Tracer, State Snapshots

Date: 2026-07-03
Status: approved (user requested all three features, delegated design decisions)

## Overview

Three new features for the OutSystems Toolkit extension. The existing toolkit covers
*active* manipulation (read/edit variables, invoke actions, override built-ins). These
features add the *observational* side (what did the app do on its own?) and
*test-scenario* tooling (repeatable variable states).

All three follow the established architecture: a page script injected into the MAIN
world, `PAGE_ACTIONS` entries in `background.js`, and a section module registered in
`sidepanel.js` with the standard `{ sectionEl, init, setData, getState, render }`
interface.

## Feature 1 — Server Call Inspector ("Network" section)

Logs every OutSystems server round-trip (data actions, server actions, aggregates —
anything hitting `/screenservices/`) with request/response payloads and a replay button.

### Page script: `pageScript/networkInspector.js`

- `_osNetworkStart()` — idempotent. Patches `window.fetch` and
  `XMLHttpRequest.prototype` (`open`/`setRequestHeader`/`send`) once; guard via
  `window.__osNetLog`. Only URLs containing `/screenservices/` are recorded.
  Records into `window.__osNetLog = { seq, enabled, entries: [] }`, ring buffer
  capped at 200 entries. Payloads capped at 200 KB each.
  Entry shape: `{ id, seq, method, url, endpoint, startedAt, durationMs, status,
  requestBody, requestHeaders, responseBody, error, replayed }`.
  `endpoint` = URL path segments after `screenservices/` (e.g.
  `ActionGetEmployees`), best-effort.
- `_osNetworkGetEntries(sinceSeq)` — returns `{ ok, enabled, entries }` newer than
  `sinceSeq` (side panel polls this).
- `_osNetworkSetEnabled(on)` — pause/resume recording (hooks stay installed).
- `_osNetworkClear()` — empty the buffer.
- `_osNetworkReplay(id)` — re-issues the stored request via page-context `fetch`
  with the captured method/headers/body. The patched fetch records the replay as a
  new entry flagged `replayed: true`. Cookies flow automatically (same-origin,
  `credentials: "include"`); the captured `X-CSRFToken` header is replayed too.

Hooks are lost on full page reload — the side panel re-arms them on every scan.
SPA navigations keep the hooks alive (same document).

### UI: `sections/network.js`, section `#network-section`

- Auto-armed on every successful scan (`onScanned()` sends `NETWORK_START`).
- Polls `NETWORK_GET_ENTRIES` every 1 s **only while the section is expanded**.
- Row: status chip (HTTP status, green/red), endpoint name, duration, relative time.
  Expanded: full URL, pretty-printed request/response JSON, Replay button.
- Header controls: search filter, pause/resume toggle, clear button.
- Platform: Reactive and ODC (both use `/screenservices/`).

## Feature 2 — Action Execution Tracer ("Action Trace" section)

Chronological timeline of client-side logic: which screen actions, event handlers,
data actions, aggregate refreshes, and server actions fired, with arguments,
duration and errors.

### Page script: `pageScript/actionTracer.js`

- `_osTracerStart()` — enables tracing and wraps controller prototype methods of the
  current screen and all live blocks (`_findCurrentScreenViewInstance()` +
  `_osDiscoverBlocks()`/`_findViewInstanceByIndex()`).
  Wrapped suffixes: `$Action` (excluding lifecycle: onInitialize/onReady/onRender/
  onDestroy/onParametersChanged), `$ServerAction`, `$DataActRefresh`, `$AggrRefresh`.
  Event handlers (`…EventHandler$Action`) ARE traced (unlike the actions section —
  they're what users click). Each wrapper is marked (`fn.__osTraced`) and the
  original kept for restore; wrapped protos tracked in `window.__osTraceWrapped`.
- Wrapper records `{ seq, ts, source (screen/block name), kind, name, methodName,
  args, durationMs, status: "ok"|"error"|"running", error }` into
  `window.__osTraceLog` (ring buffer, 300 entries). Promise results settle the
  entry asynchronously. Args serialized via `_safeSerialize` with the trailing
  callContext argument elided; serialized args capped at 4 KB per entry.
- `_osTracerGetEntries(sinceSeq)` — poll endpoint; **also re-ensures wrapping** each
  call (cheap + idempotent), so newly navigated screens/new blocks get wrapped
  without explicit re-arm.
- `_osTracerSetEnabled(on)`, `_osTracerClear()`.

Works on both platforms — controller prototypes and method suffixes are identical
in Reactive and ODC (same machinery the actions sections already rely on).

### UI: `sections/tracer.js`, section `#tracer-section`

- Auto-armed on scan; polls only while expanded (same policy as Network).
- Row: kind badge (Action / Event / Server / Data / Aggregate), name, source
  (screen vs block), duration, status icon, relative time. Expanded: method name,
  serialized args, error message.
- Header controls: search filter, pause/resume, clear.

## Feature 3 — State Snapshots ("Snapshots" section)

Named, persistent captures of client + current-screen variable values; restore
in one click; export/import as JSON to share reproduction scenarios.

### Page script: `pageScript/snapshots.js`

- `_osSnapshotCapture()` — returns `{ ok, snapshot }` with:
  - `clientVars`: iterates loaded client-variable modules (Reactive
    `window.__osCV_*` getters; ODC `window.__osODC_CV_*` instances), capturing
    `{ module, name, value, type, platform }` for writable scalar variables.
  - `screenVars`: from the current screen's model AND all live blocks (screens
    often keep their editable state inside blocks) — variable defs discovered via
    `getVariablesRecordConstructor()` metadata (`attributesToDeclare()` on
    Reactive, `Attributes` on ODC), skipping aggregate/data-action internals.
    Each entry is tagged with its `source` ("Screen" or the block path) so
    restore can target the right view. Scalars captured with type; complex
    values (Record/RecordList/Object) exported as plain JSON and flagged
    `complex: true`.
  - `context`: `{ url, screenPath, capturedAt }`.
- `_osSnapshotRestore(snapshot)` — sets client vars through the platform-appropriate
  setter (`_osClientVarsSet` / `_osOdcClientVarsSet`, reusing their coercion), sets
  scalar screen vars on `model.variables` with `_coerceValue`, then one
  `_flushAndRerender`. **Complex screen variables are not restored in v1** (JSON →
  immutable Record hydration is unreliable); they're skipped and reported.
  Returns `{ ok, restored, skipped: [{ name, reason }] }`.

### UI: `sections/snapshots.js`, section `#snapshot-section`

- Persistence: `chrome.storage.local` under key `osSnapshots` (new `storage`
  permission in the manifest). Snapshots keyed by app origin so lists stay relevant
  per app; the section shows snapshots for the current origin.
- Header controls: name input + Capture button; Import button (hidden file input).
- Row: name, captured date, screen, variable count. Buttons: Restore, Export
  (Blob download `<name>.json`), Delete.
- Restore reports per-variable failures/skips via toast + expandable detail.

## Cross-cutting changes

- `manifest.json`: add `"storage"` permission.
- `background.js`: 10 new `PAGE_ACTIONS` entries (NETWORK_START/GET_ENTRIES/
  SET_ENABLED/CLEAR/REPLAY, TRACER_GET_ENTRIES/SET_ENABLED/CLEAR/START,
  SNAPSHOT_CAPTURE/RESTORE); 3 new files in the injection array.
- `sidepanel.html`: three new section blocks (Network, Action Trace, Snapshots)
  placed after Blocks.
- `sidepanel.js`: register the three sections; after each successful scan call
  `network.onScanned()`, `tracer.onScanned()`, `snapshots.onScanned()` from a
  shared post-scan hook used by both Reactive and ODC flows.
- `sidepanel.css`: styles for status chips, kind badges, JSON payload blocks,
  and snapshot rows — reusing existing `.var-row`/`.section` patterns.
- Docs: README feature list + CLAUDE.md architecture tables updated.

## Error handling

- All page functions keep the `{ ok: true, … } | { ok: false, error }` convention.
- Polling backs off (stops until next expand/scan) when a poll returns `ok: false`.
- Payload/arg serialization is size-capped and never throws (falls back to
  `String(value)` / `"[unserializable]"`).
- Restore never aborts midway on a single failure — it accumulates `skipped`.

## Testing

No test runner exists (by design — zero-tooling repo). Verification plan:
1. `node --check` on every touched JS file.
2. Live verification against the public demo app
   (`https://personal-wrs92ssk.outsystemscloud.com/OutSystemsToolkitDemo/Demo`)
   by injecting the page scripts via automated browser and exercising:
   hook capture on data/server action calls, replay, tracer wrapping + entries,
   snapshot capture → mutate → restore round-trip.
3. Manual extension smoke test instructions for the user.
