# Lightweight Charts Line Tools Core

This package is the central core orchestrator for individual drawing tools built for [Lightweight Charts v5+](https://github.com/tradingview/lightweight-charts) plugin system. It is designed as a modern, high-performance **drop-in replacement** for the legacy [v3.8 Line Tools Build](https://github.com/difurious/lightweight-charts-line-tools). This and all the line tools are converted from the 3.8 build via **Vibe Coding** and painstakingly tested by me to ensure it's not AI slop. I am going to use this in my custom trading tool I built. I have been using the 3.8 build for years, its time to go to lightweight v5 and here it is.

The Core handles the "Hard Math" and "UI Logic"—including coordinate interpolation, infinite line clipping, selection states, drag-and-drop anchors, and axis label stacking—allowing individual drawing tools to remain modular, lightweight, and easy to maintain.

## 🎥 Video Demo
https://github.com/user-attachments/assets/900a6759-d0cd-42e5-a09c-7ed0d94bd42e

## 🧩 Modular & Community Driven
The core is designed to be a flexible foundation. While a standard set of line tool plugins is provided, this architecture is intended to empower developers to build their own custom tools using the core's orchestration capabilities. Improvements to the core logic, or the line tools are always welcome.

**Note:** I am not taking requests for new specific tool types. The purpose of this core orchestrator is to facilitate the community in creating and maintaining their own unique line tools that utilize the core. The intent is for anyone to make a new tool and share it with the community for all to use. 

## 🛠 Building the Core

To build the core orchestrator from source, ensure you have [Node.js](https://nodejs.org/) installed.

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## 📂 Output Targets

*   **`/dist` — Production Bundles**
    Contains the production-ready builds of the orchestrator. This includes **ESM** (for modern bundlers like Vite or Webpack) and **UMD** formats (for direct browser `<script>` usage). Both development and minified (`.min.js`) versions are provided, including full sourcemaps for debugging.

*   **`/docs` — Technical Documentation**
    A full static documentation site generated automatically via **TypeDoc**. By opening `docs/index.html` in any browser, you can explore an exhaustive, extensively notated reference of the entire Core library. Every class, interface, internal utility, and public method is documented directly from the source code to provide a clear roadmap for developers.



## 📦 The Plugin Ecosystem

**<span style="color:red">IMPORTANT</span>:** The Core package is strictly an orchestrator; it does **<span style="color:red">NOT include any line tools by default. To use any drawing functionality, you must install the specific tool plugins you require and register them with the Core instance.</span>** This modular approach allows you to keep your application footprint as small as possible by only including the logic for the tools you actually use.

Below are the official companion packages and the string keys used to invoke them via `addLineTool`:

- **[Standard Lines](https://github.com/difurious/lightweight-charts-line-tools-lines):** (`TrendLine`, `Ray`, `Arrow`, `ExtendedLine`, `HorizontalLine`, `HorizontalRay`, `VerticalLine`, `CrossLine`, `Callout`)
- **[Freehand Tools](https://github.com/difurious/lightweight-charts-line-tools-freehand):** (`Brush`, `Highlighter`)
- **[Rectangle Tool](https://github.com/difurious/lightweight-charts-line-tools-rectangle):** (`Rectangle`)
- **[Circle Tool](https://github.com/difurious/lightweight-charts-line-tools-circle):** (`Circle`)
- **[Triangle Tool](https://github.com/difurious/lightweight-charts-line-tools-triangle):** (`Triangle`)
- **[Path Tool](https://github.com/difurious/lightweight-charts-line-tools-path):** (`Path`)
- **[Parallel Channel](https://github.com/difurious/lightweight-charts-line-tools-parallel-channel):** (`ParallelChannel`)
- **[Fibonacci Retracement](https://github.com/difurious/lightweight-charts-line-tools-fib-retracement):** (`FibRetracement`)
- **[Price Range](https://github.com/difurious/lightweight-charts-line-tools-price-range):** (`PriceRange`)
- **[Long/Short Position](https://github.com/difurious/lightweight-charts-line-tools-long-short-position):** (`LongShortPosition`)
- **[Text Tool](https://github.com/difurious/lightweight-charts-line-tools-text):** (`Text`)
- **[Market Depth](https://github.com/difurious/lightweight-charts-line-tools-market-depth):** (`MarketDepth`)

## 🐛 Known Bugs

The following issues are known, feel free to work on their fix

*   ❌ **Mouse Pointer Transitions:** Cursor styles may not always update immediately when moving between different hit-test regions of a tool (e.g., moving from a line border to a resize anchor). It's cosmetic and does not affect functionality

*   ❌ **Text Alignment Perception:** The `text.alignment` property (internal text alignment) can be subtle and difficult to notice depending on the box dimensions. 
    *   **Recommendation:** Use `text.box.alignment` instead. This property controls the alignment of the entire box relative to the anchor point and is the intended method for primary positioning.

## 🚀 Basic Integration

To enable drawing, you need both the core and the specific tool plugins you intend to use. 

## 1. Example Install

```bash
npm install github:difurious/lightweight-charts-line-tools-core github:difurious/lightweight-charts-line-tools-rectangle lightweight-charts
```

```typescript
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { createLineToolsPlugin } from 'lightweight-charts-line-tools-core';
import { LineToolRectangle } from 'lightweight-charts-line-tools-rectangle';

const chart = createChart(document.getElementById('chart-container'));

// Lightweight Charts v5 way to add a series
const series = chart.addSeries(CandlestickSeries, {
    // optional series options
});

// Initialize the Core Orchestrator
const lineTools = createLineToolsPlugin(chart, series);

// Register the specific tool classes you have installed
lineTools.registerLineTool('Rectangle', LineToolRectangle);

// Start interactive drawing mode (user clicks to place points)
lineTools.addLineTool('Rectangle');
```

# The Test App

### 🧪 Testing & Validation

For developers and contributors, I provide a dedicated **[React Test Application](https://github.com/difurious/lightweight-charts-line-tools-plugin-test-app)**. 

This app is used to verify the integrity of the Core and all 12 plugins (21 line tools). It features an **Automated Test Surface Generator** that produces massive grids of tools to validate every style property, culling edge-case, and coordinate interpolation variant in a single view. Turn on the subscriptions and double click any tool you see to get its properties - options to understand what options do what. This is also a visual way to confirm all aspects of the tool are working properly.

## ✨ Core Features & Capabilities

The core orchestrator is built to handle the heavy lifting of chart interactions, allowing you to focus on the visual logic of your tools. Here is what the Core brings to your chart:

### 🖱️ Advanced Interaction & UX
*   **Hybrid Drawing Modes:** Seamlessly switch between **Interactive Mode** (click-to-draw with real-time ghosting) and **Programmatic Mode** (instant rendering via API). You can have code update or change the line tool in real time if necessary. 
*   **Intelligent Interaction Manager:** Automatic handling of hover detection, selection states, and high-performance drag-and-drop logic for tool bodies and anchors.
*   **Shift-Key Constraints:** Built-in support for geometric locking, such as forcing horizontal lines (TrendLine).
*   **Virtual Anchor Support:** Capability to manage "Virtual Handles"—resize points that don't exist in your data but allow complex manipulation (e.g., the 8-handle grid of a Rectangle or the mid-line handles of a Parallel Channel).
*   **Smart Cursors:** Dynamic mouse pointer cursor management that changes based on tool orientation, resize direction (NWSE vs. NESW), or "not-allowed" states for non-editable tools.

### 💾 Data Integrity & Persistence
*   **Full State Serialization:** Export the entire visual state of your chart to a clean, valid JSON string for database storage or local persistence.
*   **Non-Destructive Import:** Re-hydrate saved tools instantly. The core intelligently updates existing tools by ID while creating new ones, preventing data loss.
*   **V3.8 Event Parity:** Fully compatible event delegates for `AfterEdit` (perfect for auto-saving to backends) and `DoubleClick` (ideal for triggering your own way to modify the tools options via your custom UI since on double-click, it passes that tool options in the event.). 
*   **Precise Point Mapping:** Methods to retrieve, update, or delete tools using unique IDs or flexible Regular Expressions for bulk cleanup.

### 📐 Geometric & Mathematical Power
*   **"Blank Space" Interpolation:** logic allows tools to be drawn and tracked in the "past or future" — the empty space to the right or left of the current data bars where no chart data exists.
*   **Unbounded Point Handling:** Support for tools with a fixed point count (e.g., 1, 2, 3+) (Rectangle/TrendLine/Triangle) or variable, "infinite" point arrays (drawing) (Brush/Path/Highlighter).
*   **Infinite Line Clipping:** Advanced parametric math to handle Rays and Extended Lines. If the tool is actually off screen and no part of it (including extensions) can be seen, it does not render the tool. It does the cull check for each tool individually.

### 🚀 High-Performance Rendering
*   **Multi-Stage Culling Engine:** When deciding to cull (not draw), it uses dual-layer visibility checking using AABB (Axis-Aligned Bounding Box) for shapes and Sub-Segment intersection tests for complex polylines. The sub-segments are used to optimize what is checked for infinite extensions if it is seen on screen or not. 
*   **Price Axis Label Stacking:** A dedicated manager that detects Y-axis label collisions and shifts them vertically in real-time, ensuring every price label level remains readable.
*   **Composite Renderer Architecture:** Ability to stack multiple renderers (Lines, Polygons, Rectangles, and Text) within a single tool to create complex visualizations.
*   **Total Customization Overrides:** Flexibility to completely override Core logic for specialized tools, enabling the tool full control of the logic to make your tool work how you want.

### 🛠 Developer Extensibility
*   **Modular "Plugin" Design:** The core is strictly an orchestrator. You are encouraged to utilize the `BaseLineTool` and generic renderers to build your own 13th, 14th, or 100th line tool (make sure to share your line tool creations).
*   **Bespoke Hit-Testing:** Granular control over hit-test areas, allowing you to prioritize specific parts of a tool (like a border, text box, or background fill) for user to click and edit the tool.






# 📖 Public API Reference

The following methods are implemented by the Core and are accessible via the plugin instance. These are the methods that a front end user would utilize.

## Tool Registration & Creation


#### `registerLineTool(type, toolClass)`
Maps a tool identifier string to its implementation class. Must be called before adding a tool.

#### `addLineTool(type, points?, options?)`
The primary entry point for adding tools.
- **Interactive Mode:** Pass `[]` for `points` to allow the user to click on the chart to place points.
- **Programmatic Mode:** Pass an array of `LineToolPoint` objects to create the tool at specific coordinates.

#### `createOrUpdateLineTool(type, points, options, id)`
Creates a new tool with a specific ID, or updates it if that ID already exists. Primarily used for state synchronization.

#### `applyLineToolOptions(toolData)`
Perform a partial update on an existing tool's options or points using its `id`.


## Retrieval & Selection

#### `getSelectedLineTools()`
Returns a JSON string of all tools currently selected by the user.

#### `getLineToolByID(id)`
Retrieves the data for a specific tool by its unique ID (returned as a JSON string).

#### `getLineToolsByIdRegex(regex)`
Retrieves a list of tools whose IDs match a specific Regular Expression.

## Removal & Cleanup

#### `removeLineToolsById(ids[])`
Removes one or more tools by their unique string IDs.

#### `removeLineToolsByIdRegex(regex)`
Removes all tools whose IDs match the provided Regular Expression.

#### `removeSelectedLineTools()`
Removes the currently selected line tool(s). "Delete" key is not supported, you can tie this method to a button press.

#### `removeAllLineTools()`
Clears every single line tool managed by the plugin from the chart, and wipes any trace of it.

## State Persistence

#### `exportLineTools()`
Serializes the state of all current tools into a JSON string. Perfect for saving chart layouts to a database.

#### `importLineTools(json)`
Imports a set of line tools from a JSON string. This is non-destructive; it updates existing IDs and creates new ones. You could export, save it, remove all, then recall the saved export and then import it.

### Event Subscriptions (V3.8 Compatibility)

#### `subscribeLineToolsAfterEdit(handler)`
Fires when a line tool is modified, moved, or finished being created. This is the recommended hook for triggering an "Auto-Save" to your backend.

#### `subscribeLineToolsDoubleClick(handler)`
Fires when a user double-clicks an existing tool. Often used to open a custom "Properties" or "Settings" modal.

## Manual Crosshair Control

#### `setCrossHairXY(x, y, visible)`
Programmatically positions the chart crosshair using screen pixel coordinates. The Core handles the conversion to logical time and price using its internal interpolation engine. You could potentially have multiple charts and sync the crosshair.

#### `clearCrossHair()`
Clears the chart's crosshair, making it invisible.

## 🏗 Architectural Deep Dive

### Coordinate Interpolation (The "Blank Space" Logic)
The Core uses linear interpolation to map screen pixels to logical time and price even in the "blank space"—the future area to the right of the data where no bars exist. You can draw a line tool anywhere.

### Culling Engine (AABB & Sub-Segments)
The Core implements an advanced culling engine. It uses Axis-Aligned Bounding Box (AABB) tests for simple shapes and robust line-segment intersection tests for infinite lines (Rays, Extended Lines), ensuring only visible primitives are rendered on screen.

### Price Axis Label Stacking
The `PriceAxisLabelStackingManager` monitors all active price labels. When labels from multiple tools collide on the Y-axis, it calculates a vertical shift to stack them cleanly, preventing unreadable overlaps while maintaining visual alignment with their source prices.

### Interaction Manager
A centralized event-bus that manages global DOM listeners. It handles selection logic, drag-thresholds (preventing accidental moves), and the enforcement of Shift-key geometric constraints (like axis-locking).