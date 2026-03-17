# OutSystems Toolkit

A Chrome extension that gives you deep runtime visibility into OutSystems applications. Inspect and edit variables, invoke actions, explore data models, and more — all from a convenient side panel.

Supports both **OutSystems 11 (Reactive)** and **ODC** applications.

<!-- TODO: Add Chrome Web Store badge once published -->
<!-- [![Chrome Web Store](https://img.shields.io/chrome-web-store/v/EXTENSION_ID)](https://chrome.google.com/webstore/detail/EXTENSION_ID) -->

## Features

### App Metadata
View application info at a glance: app name, environment, debug mode, home module, and version details.

### Client Variables
Discover and edit client variables across all loaded modules. Supports Text, Boolean, Integer, Decimal, Currency, Date, Time, DateTime, LongInteger, and more. Variables are grouped by module with search and filtering.

### Screens
Lists all screens grouped by UI Flow. Expand any screen to see its full structure:

- **Input Parameters & Local Variables** — View types and live values; inline edit or open a tree-view popup for complex types (Record, RecordList).
- **Screen Actions** — Discover and invoke client-side actions with full input parameter support.
- **Data Actions** — Trigger refresh and inspect output parameters.
- **Aggregates** — Trigger refresh and inspect results.
- **Server Actions** — Invoke server-side actions with input/output parameter editing.

### Blocks
Inspect live block component instances on the current screen. The extension walks the React Fiber tree to find all rendered blocks and exposes the same capabilities as screens — variables, actions, aggregates, and more. A **Block Tree** popup visualizes the full component hierarchy.

### Static Entities
Browse entities grouped by module with attribute schemas and all records. *(Reactive only)*

### Data Models
Explore entity and structure Record definitions grouped by defining module. Each item expands to show its attributes. Filterable by module and kind (Entity vs Structure).

### Roles
Lists all security roles defined in the application, with badges showing which roles the current user has.

### Built-in Function Overrides
Inspect and temporarily override OutSystems built-in functions (like `CurrDateTime`, `GetUserId`, etc.) with hardcoded values — useful for testing time-sensitive logic or impersonation scenarios. Overrides survive rescans.

### Producer References
View producer references grouped by consumer module with health status indicators. *(Reactive only)*

### Quality of Life
- **Auto-Rescan** — Automatically refreshes when you navigate or reload the page.
- **Sticky Headers** — Search bars and section headers stay visible while scrolling.
- **Collapsible Sections** — Every section and sub-group can be collapsed.
- **Toast Notifications** — Non-blocking feedback on every action.

## Installation

### From the Chrome Web Store

<!-- TODO: Add direct link once published -->
1. Visit the [OutSystems Toolkit]() page on the Chrome Web Store.
2. Click **Add to Chrome**.

### From Source (Developer Mode)

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium-based browser).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder.
5. The extension icon will appear in the toolbar.

## Usage

1. Navigate to any OutSystems application.
2. Click the **OutSystems Toolkit** icon in the toolbar to open the side panel.
3. The extension auto-scans on open. Use the **Scan** button to manually refresh.
4. Search and filter to locate specific items.
5. Click variable values to edit inline, or use the tree-view popup for complex types.
6. Invoke actions, refresh aggregates and data actions directly from the panel.
7. Click a screen name to navigate to it. Expand blocks to inspect their internals.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access the current tab for script injection |
| `scripting` | Inject page scripts to read OutSystems runtime data |
| `sidePanel` | Render the UI as a Chrome side panel |
| `tabs` | Detect tab navigation for auto-rescan |
| Host permissions (`http/https`) | Allow script injection on any page |

## Requirements

- Chrome 116+ (or any Chromium-based browser with Side Panel API support)
- The target page must be an OutSystems application (Reactive or ODC)

## Privacy

This extension runs entirely locally. It does **not** collect, transmit, or store any user data. All inspection and editing happens in your browser — no external servers are contacted.

## Contributing

Contributions are welcome! This is a zero-dependency, no-build-step project — vanilla JavaScript (ES6 modules) running natively in Chrome. Load the extension in developer mode and you're ready to go.

See [`CLAUDE.md`](CLAUDE.md) for detailed architecture documentation.

## License

[MIT](LICENSE) — Miguel Morais
