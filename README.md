# OutSystems Reactive Toolkit — Chrome Extension

A Chrome side panel extension for inspecting and editing **OutSystems Reactive** application runtime data. It provides deep visibility into client variables, screen variables, actions, aggregates, static entities, roles, and producer references — all from a convenient side panel.

## Features

### App Metadata
- View application metadata at a glance: app name, environment, debug mode, home module, version info, and more.

### Client Variables
- **Scan & Edit**: Discover and modify client variables across all loaded modules.
- **Type Support**: Handles Text, Boolean, Integer, Decimal, Currency, Date, Time, DateTime, and LongInteger.
- **Grouping & Filtering**: Variables grouped by module with search bar and module-filter dropdown.

### Screens
The most comprehensive section — lists all screens grouped by Flow, parsed from `moduleinfo`.

When expanding a screen:
- **Static Structure**: Input Parameters, Local Variables, Aggregates, Data Actions, Server Actions, and Screen Actions parsed from `mvc.js`.
- **Live Runtime Data** (active screen only): Real-time values fetched via React Fiber traversal and the OutSystems immutable Record/List runtime.

For the currently active screen:
- **Input Parameters & Local Variables** — Inline editing for scalar types; tree-view popup for complex types (Record, RecordList, Object).
- **Screen Actions** — Discover and invoke client-side actions with full input parameter support (scalar and complex types).
- **Data Actions** — Trigger refresh and inspect updated output parameters.
- **Aggregates** — Trigger refresh and inspect updated output.
- **Server Actions** — Invoke server-side actions with input parameter editing and output parameter inspection.

### Static Entities
- Entities grouped by module, showing attribute schemas and all records with display names.
- One-click GUID copy for both entities and individual records.
- Searchable by module, entity name, record name, or GUID.

### Roles
- Lists all security roles defined in the application.
- Badges roles that the current logged-in user has.
- Searchable by role name.

### Producer References
- Lists producer references grouped by consumer module.
- Health status indicators: "OK" (green) or broken (red).
- Search bar and module-filter dropdown.

### UX
- **Auto-Rescan**: Automatically updates when you navigate or refresh the page.
- **Sticky Headers**: Search bars and section headers remain visible while scrolling.
- **Collapsible Sections**: Every section and sub-group can be collapsed.
- **Toast Notifications**: Non-blocking feedback on every save or action trigger.
- **Row Flash**: Visual confirmation (green/red) on edits.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder.
5. The extension icon will appear in the toolbar. Click it to open the side panel.

## Usage

1. Navigate to an OutSystems Reactive application in your browser.
2. Click the **OutSystems Reactive Toolkit** icon in the toolbar to open the side panel.
3. Click **Scan** to discover all runtime data on the current page.
4. Use search bars and module filters to locate specific items.
5. Click a variable value to edit it inline; use the tree-view popup for complex types.
6. Invoke screen actions, server actions, refresh data actions and aggregates directly from the panel.
7. Click a screen name to navigate to that screen.

## Project Structure

```
├── manifest.json              # MV3 extension manifest
├── background.js              # Service worker — message dispatch & script injection
├── background/
│   └── parsers.js             # Fetch + parse logic (moduleinfo, mvc.js, controller.js)
├── sidepanel.html             # Side panel UI layout
├── sidepanel.js               # Orchestrator — manages sections & messaging
├── sidepanel.css              # Styles (CSS custom properties for theming)
├── pageScript/                # Injected into page MAIN world (globals, not ES modules)
│   ├── helpers.js             # Shared utilities (type detection, coercion, list/record APIs)
│   ├── fiber.js               # React Fiber traversal (find active screen model)
│   ├── clientVars.js          # Client variable CRUD & user role checking
│   ├── screenVars.js          # Screen variable read/write/introspect, deep-set, list ops
│   ├── screenActions.js       # Screen action discovery and invocation
│   ├── actionParams.js        # Action parameter storage, deep editing, list ops
│   ├── dataActions.js         # Data action discovery and refresh
│   ├── aggregates.js          # Aggregate discovery and refresh
│   └── serverActions.js       # Server action discovery and invocation
├── sections/                  # Modular UI feature sections
│   ├── appmetadata.js         # App Metadata (read-only key-value display)
│   ├── variables.js           # Client Variables (scan, filter, inline edit)
│   ├── screens/               # Screens (sub-module with 7 files)
│   │   ├── index.js           # Entry point, delegated events, public API
│   │   ├── state.js           # Shared mutable state & DOM references
│   │   ├── render.js          # HTML rendering for screen list & details
│   │   ├── data.js            # Screen expansion, live value fetch, enrichment
│   │   ├── editing.js         # Inline variable editing handlers
│   │   ├── actions.js         # Action invocation (screen, server, data, aggregate)
│   │   └── builders.js        # HTML builders for variable rows & action cards
│   ├── screenVarPopup.js      # Shared popup for complex type tree-view inspect/edit
│   ├── staticEntities.js      # Static Entities (grouped, searchable, GUID copy)
│   ├── roles.js               # Roles (discovery + current-user check)
│   └── producers.js           # Producer References (health status)
├── utils/
│   ├── helpers.js             # Pure functions (escape, debounce, messaging)
│   ├── ui.js                  # DOM helpers (visibility, toasts, flash, status)
│   └── typeControls.js        # Type-aware input widget factory
└── icons/                     # Extension icons (16, 32, 48, 128)
```

## How It Works

1. **Service Worker** (`background.js`) receives messages from the side panel via two dispatch tables: `PAGE_ACTIONS` (execute functions in the page's MAIN world) and `SPECIAL_ACTIONS` (handle fetch + parse operations in the service worker itself).
2. **Page Scripts** (`pageScript/*.js`) are injected into the page's MAIN world in dependency order. They leverage the OutSystems AMD `require()` loader to access runtime modules and traverse the React Fiber tree to find the active screen's model and variables.
3. **Side Panel** (`sidepanel.js`) orchestrates section modules, each with a consistent `init()`/`setData()`/`getState()`/`render()` interface. Auto-scans on panel open and re-scans on tab navigation.

### Section Module Interface

Each section (`sections/*.js`) exports:
- `init()` — Initialize DOM references and event listeners
- `setData(data)` — Receive and store data from scans
- `getState()` — Return current filter/search state
- `render()` — Update the UI based on current state
- `sectionEl` — DOM root element reference

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Access the currently active tab for script injection |
| `scripting` | Inject page scripts into the page's MAIN world |
| `sidePanel` | Render the extension UI as a Chrome side panel |
| `tabs` | Listen for tab navigation events to trigger auto-rescan |
| `host_permissions (http/https)` | Allow script injection on any HTTP/HTTPS page |

## Requirements

- Chrome 116+ (or any Chromium-based browser with Side Panel API support)
- The target page must be an OutSystems Reactive application that uses the AMD module loader

## License

This project is provided as-is for internal/development use.
