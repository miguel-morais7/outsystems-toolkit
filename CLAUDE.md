# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Extension (Manifest V3) for inspecting and editing OutSystems Reactive application runtime data via a side panel. Written in vanilla JavaScript (ES6 modules) with zero build tools, bundlers, or npm dependencies.

## Development Workflow

**No build step.** Load the extension directly in Chrome:
1. Go to `chrome://extensions`, enable Developer Mode
2. Click "Load unpacked" and select this repository folder
3. Changes to JS/CSS/HTML take effect after reloading the extension

There are no test runners, linters, or package.json. All code runs natively in Chrome 116+.

## Architecture

### Three-Layer Communication Model

```
Side Panel (sidepanel.js)  <->  Service Worker (background.js)  <->  Page Scripts (pageScript/*.js)
       UI orchestration          Message bridge & injection          OutSystems runtime access
```

- **Side Panel** (`sidepanel.js`): Bootstraps section modules, manages scan workflow, handles auto-rescan on tab navigation. Communicates with background via `chrome.runtime.sendMessage`. Auto-scans on panel open and re-scans on tab navigation (1.5s delay, up to 3 retries at 2s intervals).
- **Service Worker** (`background.js`): ES module service worker. Receives messages via dispatch tables (`PAGE_ACTIONS` and `SPECIAL_ACTIONS`), injects page scripts into MAIN world via `chrome.scripting.executeScript`, returns results. Delegates fetch+parse operations to `background/parsers.js`.
- **Page Scripts** (`pageScript/*.js`): Run in the page's MAIN world. Injected in dependency order: `helpers.js` and `fiber.js` first (shared utilities and React Fiber traversal), then feature modules. All functions are globals (not ES modules) since they run in MAIN world.

#### Message Flow

All messages go through `background.js`, which uses two dispatch tables:
- **`PAGE_ACTIONS`**: Actions that execute a function in the page's MAIN world (e.g. `SCAN`, `SET`, `GET_SCREEN_VARS`, `GET_BUILTIN_FUNCTIONS`, `OVERRIDE_BUILTIN_FUNCTIONS`). See the table in `background.js` for the full list.
- **`SPECIAL_ACTIONS`**: Actions handled in the service worker itself (`FETCH_SCREENS`, `FETCH_ROLES`, `FETCH_SCREEN_DETAILS`, `NAVIGATE`). These do HTTP fetches and parsing rather than page injection.

#### Adding a New Message Action

**For PAGE_ACTIONS** (runs in page MAIN world):
1. Add entry to `PAGE_ACTIONS` in `background.js`: `ACTION_NAME: { func: (...args) => _osMyFunc(...args), args: msg => [msg.prop1, msg.prop2] }`
2. Implement `_osMyFunc()` as a global in the appropriate `pageScript/*.js` file
3. If it's a new page script file, add it to the injection array in `ensurePageScriptInjected()`

**For SPECIAL_ACTIONS** (runs in service worker):
1. Add entry to `SPECIAL_ACTIONS`: `ACTION_NAME: msg => myHandler(msg)`
2. Implement handler in `background.js` or `background/parsers.js`

### Page Script Modules (`pageScript/`)

Files are injected as plain scripts (not ES modules) into the page's MAIN world. Injection is idempotent (guarded by function existence check) and scripts are lost on page navigation.

| File | Responsibility |
|---|---|
| `helpers.js` | Shared utilities: `_isList()`, `_listCount()`, `_listGet()`, `_navigateToTarget()`, `_flushAndRerender()`, type coercion, introspection helpers. Must be injected first. |
| `fiber.js` | React Fiber tree traversal: `_findCurrentScreenModel()`, `_findCurrentScreenViewInstance()`. Depends on helpers. |
| `clientVars.js` | Client variable CRUD and user role checking |
| `producers.js` | Producer resource URL discovery via `performance.getEntriesByType()` |
| `appDefinition.js` | App definition metadata discovery via AMD `require()` |
| `roles.js` | Role discovery and current-user role checking |
| `screenVars.js` | Screen variable read/write/introspect, deep-set, list append/delete |
| `screenActions.js` | Screen action discovery and invocation |
| `actionParams.js` | Temporary action parameter storage, deep editing, list operations |
| `dataActions.js` | Data action discovery and refresh |
| `aggregates.js` | Aggregate discovery and refresh |
| `serverActions.js` | Server action discovery and invocation |
| `builtinFunctions.js` | Built-in function discovery, override with hardcoded values, restore originals |
| `dataModels.js` | ODC entity and structure discovery via dynamic chunk importing |

#### Page Script Conventions

- **Naming**: Public functions use `_os` prefix (e.g., `_osScreenActionsGet`). Internal helpers use `_` prefix without `os` (e.g., `_isList`, `_coerceValue`).
- **Return pattern**: Every public function wraps in try/catch and returns `{ ok: true, ...data }` on success or `{ ok: false, error: e.message }` on failure.
- **Async functions**: Functions that invoke actions return Promises (resolved by Chrome's `executeScript` structured clone). The `.then()` returns `{ ok: true, ... }` and `.catch()` returns `{ ok: false, error }`.
- **Finding the current screen**: Action-related scripts start with `var viewInstance = _findCurrentScreenViewInstance(); var ctrl = viewInstance.controller; var proto = Object.getPrototypeOf(ctrl);`
- **Discovery by method suffix**: Screen actions end in `$Action` (excluding lifecycle + `EventHandler`), server actions end in `$ServerAction`, data actions and aggregates have their own discovery patterns.
- **Complex param storage**: `window.__osActionParams` is a global map keyed by `"methodName.attrName"`, initialized by `_osActionParamInit()` and mutated by `_osActionParamDeepSet()`.

### Section-Based UI Module System

Each feature lives in `sections/` and exports a consistent interface consumed by `sidepanel.js`:
- `init()` — Set up DOM and event listeners
- `setData(data)` — Receive scan results
- `getState()` — Return filter/search state (typically `{ count }`)
- `render()` — Update UI from current state
- `sectionEl` — DOM root element reference

Sections are registered in `sidepanel.js`:
```js
const sections = [appmetadata, variables, screens, blocks, builtinFunctions, staticEntities, dataModels, roles, producers];
```

The **Screens** section is split into sub-modules under `sections/screens/`:
- `index.js` — Entry point, all delegated event listeners, re-exports public API
- `state.js` — Shared mutable state object and DOM references
- `render.js` — HTML rendering for screen list, expanded details, sub-sections
- `data.js` — Screen expansion logic: calls `FETCH_SCREEN_DETAILS` (static parse), then `fetchLiveValues()` + `enrich*()` from `sections/shared/enrichment.js` to merge runtime data

The **Blocks** section (`sections/blocks/`) mirrors the Screens structure for inspecting block component instances found on the current screen:
- `index.js` — Entry point, all delegated event listeners, re-exports public API
- `state.js` — Shared mutable state; `state.liveBlocks` holds runtime block instances with `viewIndex` for targeting
- `render.js` — HTML rendering for block list, expanded details
- `data.js` — Block expansion: calls `FETCH_SCREEN_DETAILS` with the block's controller module, then enriches via shared enrichment functions

**Block discovery**: `DISCOVER_BLOCKS` page action walks the React Fiber tree to find all live block view instances. Each block has a `viewIndex` used to target all subsequent page script calls. The `viewIndex` is passed as-is to `GET_SCREEN_VARS`, `GET_SCREEN_ACTIONS`, etc. — the same page functions work for both screens and blocks.

**Shared modules** (`sections/shared/`) are used by both screens and blocks:
- `enrichment.js` — `fetchLiveValues()`, `enrichScreenActions()`, `enrichDataActions()`, `enrichAggregates()`, `enrichServerActions()` — all accept an optional `viewIndex` for targeting blocks vs. the current screen
- `actions.js` — `invokeScreenAction()`, `refreshDataAction()`, `refreshAggregate()`, `invokeServerAction()`
- `editing.js` — `doSetVar()`, `commitVarInput()`, `doSetDataActionOutput()`, `commitDataActionOutputInput()`
- `builders.js` — HTML builder functions for variable rows, action cards, sub-sections
- `render.js` — `buildSubSection()` and related detail panel builders

**Enrich pattern**: Static parse from `background/parsers.js` gives structure (variable/action names and types from mvc.js). Runtime enrich calls page scripts to get live method names, parameter types, and current values. Name matching is case-insensitive: `runtimeMap[sa.name.toLowerCase()]`.

`sections/screenVarPopup.js` is a shared popup for inspecting/editing complex types (Record, RecordList, Object) with tree-view navigation. Used by screen variables, block variables, and action parameters.

`sections/builtinFunctions.js` lets users inspect and override OutSystems environment built-in functions (CurrDateTime, GetUserId, etc.) with hardcoded values. Overrides survive rescans (stored in-memory in the section).

`sections/dataModels.js` displays entity and structure Record definitions parsed from model.js files, grouped by defining module. Each item is expandable to show attributes. Filterable by module and kind (Entity vs Structure).

`sections/blockTreePopup.js` is a read-only popup showing the full React component hierarchy (screen root → all blocks), with the selected block highlighted and ancestor path expanded. Opened via `.btn-block-tree` buttons in the blocks section.

### Background Parsers

`background/parsers.js` isolates fetch+parse logic from Chrome APIs:
- `fetchScreens(pageUrl)` — Parse moduleinfo for screen list, static entities, version info; enriches entities from model.js and screens with role requirements from mvc.js
- `fetchRoles(pageUrl)` — Parse controller.js for roles
- `fetchScreenDetails(baseUrl, moduleName, flow, screenName)` — Parse mvc.js for variables/actions

### Shared Utilities

- `utils/helpers.js` — Pure functions: `esc()` (HTML escape), `escAttr()`, `debounce()`, `sendMessage()` (promise-based chrome messaging), `formatDateForInput()` (ISO to HTML input format)
- `utils/ui.js` — DOM helpers: `show()`/`hide()`, `flashRow()`, `toast()`, `showStatus()`/`hideStatus()`
- `utils/typeControls.js` — `buildTypeControl()`: shared HTML factory for type-appropriate input widgets (Boolean toggles, date/time pickers, number/text inputs, complex-type inspect buttons). Dispatches by OS DataType and carries context via `data-*` attributes.

## Key Technical Details

- **No transpilation**: All code must be valid ES6+ that Chrome 116+ supports natively
- **Module loading**: Side panel uses ES modules (`type="module"` in sidepanel.html); page scripts are injected as plain scripts (non-module) into MAIN world, so they use globals instead of imports/exports
- **OutSystems runtime access**: Page scripts hook into the AMD loader (`require()`) to access `*.clientVariables.js`, `*.referencesHealth.js`, `*.appDefinition.js`, and `*.mvc.js` modules
- **React Fiber traversal**: Screen live editing finds the active screen's React component tree to read/write `model.variables` and trigger re-renders via `forceUpdate()`
- **Immutable data structures**: The OutSystems runtime uses immutable Records (`record.get()/set()`) and Lists (`list.count()/get()/push()/remove()`). Helper functions in `pageScript/helpers.js` abstract over both old and new runtime APIs.
- **Type coercion**: Variable types are detected from getter function source code inspection, record constructor metadata (`attributesToDeclare`), and runtime value inspection. Supported OutSystems types: Text, Boolean, Integer, Decimal, Currency, Date, Time, DateTime, LongInteger, Phone Number, Email. Uses `ServerDataConverter` integration for date/time coercion.
- **Path-based navigation**: Complex variable editing uses structured path arrays (e.g. `["listOut", {index:0}, "nameAttr"]`) to traverse nested Records and RecordLists.
- **CSS**: Single file (`sidepanel.css`) with CSS custom properties for theming. Key class patterns: `.section` (collapsible wrapper), `.var-row` (data rows), `.screen-action-item` (triggerable actions), `.btn-trigger-action` (run buttons with specialized variants like `.btn-trigger-server-action`).

## ODC (OutSystems Developer Cloud) Support

The toolkit supports both traditional Reactive and ODC applications. Platform is auto-detected at scan time via `detectPlatform()` in `background.js`:
- **Reactive**: `OSManifestLoader` global exists
- **ODC**: `<meta name="indexVersionToken">` tag exists

### Key Differences from Reactive

| Aspect | Reactive | ODC |
|--------|----------|-----|
| Component structure | Class components (`fiber.stateNode`) | Function components (`fiber.pendingProps`) |
| Module system | AMD `require()` | ES modules, dynamic `import()` |
| Screen discovery | `moduleinfo` endpoint JSON | Static route array in bundle JS |
| Global APIs | `OSManifestLoader`, `OS`, `ServerDataConverter` | `OutSystemsDebugger`, own wrapper types |
| Static file parsing | Named files (`*.mvc.js`, `*.clientVariables.js`) | Hashed chunks (`_oschunk-*.js`), no static parsing |
| Block dedup | Implicit | Explicit controller identity set (`seenControllers`) |

### ODC-Specific Page Script Functions

ODC functions use `_osOdc` prefix (e.g., `_osOdcClientVarsScan`, `_osOdcRolesScan`, `_osOdcDataModelsScan`). Dispatch tables in `background.js` branch by platform.

### ODC Limitations

Features unavailable in ODC: static entities, producer references.

**Built-in function overrides** work in ODC via a prototype-patching approach: the frozen builtins chunk export cannot be modified directly, so the toolkit patches `PublicApiHelper.prototype.BuiltinFunctions` (the getter that JS nodes use to access builtins) to return a mutable clone. See `_osOdcEnsurePrototypePatched()` in `pageScript/builtinFunctions.js`.

### ODC Reference Files

`odc-chunks/` contains sample ODC app bundles and chunk files with analysis reports in `odc-chunks/reports/`. These are reference material for understanding ODC bundle structure, not runtime data.
