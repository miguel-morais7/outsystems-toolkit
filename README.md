# OutSystems Reactive Toolkit — Chrome Extension

A Chrome side panel extension for inspecting and editing **OutSystems Reactive** application runtime data, including client variables, producer references, and screens.

## Features

- **Client Variables** — Scan, view, search, filter, and inline-edit client variables across all loaded modules on the current page. Supports Text, Boolean, Integer, Decimal, Date/Time, and more.
- **Producer References** — Discover and list producer references from all `referencesHealth.js` modules, with status indicators (OK / broken).
- **Screen Navigation** — List all screens defined in the application's `moduleinfo` manifest and navigate between them directly from the panel.
- **Auto-Rescan** — Automatically re-scans when the active tab navigates or refreshes.
- **Search & Filter** — Per-section search bars and module dropdown filters for quick lookup.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or your Chromium-based browser).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `chrome-extension` folder.
5. The extension icon will appear in the toolbar. Click it to open the side panel.

## Usage

1. Navigate to an OutSystems Reactive application in your browser.
2. Click the **OutSystems Reactive Toolkit** icon in the toolbar to open the side panel.
3. Click **Scan** to discover client variables, producers, and screens on the current page.
4. Use the search bars and module filters to locate specific items.
5. Click a variable value to edit it inline (read-only variables are marked accordingly).
6. Click a screen name to navigate to that screen.

## Project Structure

```
chrome-extension/
├── manifest.json      # MV3 extension manifest
├── background.js      # Service worker — orchestrates messaging & script injection
├── pageScript.js      # Injected into the page's MAIN world to access OS runtime
├── sidepanel.html     # Side panel markup
├── sidepanel.css      # Side panel styles
├── sidepanel.js       # Side panel UI logic (rendering, events, editing)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## How It Works

1. **Service Worker** (`background.js`) listens for messages from the side panel and injects `pageScript.js` into the active tab's MAIN world using `chrome.scripting.executeScript`.
2. **Page Script** (`pageScript.js`) leverages the OutSystems AMD `require()` loader and `performance.getEntriesByType("resource")` to discover `*.clientVariables.js` and `*.referencesHealth.js` modules at runtime. It exposes global functions (`_osClientVarsScan`, `_osClientVarsSet`, `_osClientVarsGet`) that the service worker invokes.
3. **Side Panel** (`sidepanel.js`) provides the interactive UI — rendering variable tables grouped by module, producer reference lists, and screen navigation. It communicates with the service worker via `chrome.runtime.sendMessage`.

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Access the currently active tab for script injection |
| `scripting` | Inject `pageScript.js` into the page's MAIN world |
| `sidePanel` | Render the extension UI as a Chrome side panel |
| `tabs` | Listen for tab navigation events to trigger auto-rescan |
| `host_permissions (http/https)` | Allow script injection on any HTTP/HTTPS page |

## Requirements

- Chrome 116+ (or any Chromium-based browser with Side Panel API support)
- The target page must be an OutSystems Reactive application that uses the AMD module loader

## License

This project is provided as-is for internal/development use.
