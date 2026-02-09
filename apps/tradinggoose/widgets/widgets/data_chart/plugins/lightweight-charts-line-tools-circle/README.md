# Lightweight Charts Circle Tool

 This and all the line tools are converted from the [3.8 build](https://github.com/difurious/lightweight-charts-line-tools) via **Vibe Coding** and painstakingly tested by me to ensure it's not AI slop.

This package provides a specialized **Circle** drawing tool for the [Lightweight Charts v5+](https://github.com/tradingview/lightweight-charts) plugin system. It is part of a modular, high-performance **drop-in replacement** suite for the legacy [v3.8 Line Tools Build](https://github.com/difurious/lightweight-charts-line-tools).

## 🎥 Video Demo
https://github.com/user-attachments/assets/900a6759-d0cd-42e5-a09c-7ed0d94bd42e


## ⚠️ Prerequisites

**<span style="color:red">IMPORTANT:</span>** This plugin **cannot** function on its own. It requires the **Core Orchestrator** to handle interactions, rendering logic, and state management.

*   **Required Core:** [lightweight-charts-line-tools-core](https://github.com/difurious/lightweight-charts-line-tools-core) . Have a look at the core repository to learn how to make your own line tools utilizing the core and contribute.

## 🛠 Installation & Building

This package is distributed as source code. To use it, you must clone the repository and build the distribution files locally.

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/difurious/lightweight-charts-line-tools-circle.git
    cd lightweight-charts-line-tools-circle
    ```

2.  **Install dependencies**:
    *(This will automatically download the Core orchestrator and other required libraries)*
    ```bash
    npm install
    ```

3.  **Build the plugin**:
    *(This generates the /dist folder and /docs)*
    ```bash
    npm run build
    ```

4.  **Output**:
    *   `/dist`: Contains the production ESM and UMD bundles.
    *   `/docs`: Technical API documentation. Open `docs/index.html` and navigate to the `LineToolCircle` class to view all available configuration options (fill colors, border styles, text labels) and methods.

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

## 🚀 Usage Example

Here is how to register and use the Circle tool in your chart.

```typescript
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { createLineToolsPlugin } from 'lightweight-charts-line-tools-core';
import { LineToolCircle } from 'lightweight-charts-line-tools-circle';

const chart = createChart(document.getElementById('chart-container'));
const series = chart.addSeries(CandlestickSeries, {
    // optional series options
});

// 1. Initialize the Core Orchestrator
const lineTools = createLineToolsPlugin(chart, series);

// 2. Register the Circle Tool
lineTools.registerLineTool('Circle', LineToolCircle);

// 3. Start interactive drawing mode (Click Center, then Drag/Click Radius)
lineTools.addLineTool('Circle');
```

# The Test App

### 🧪 Testing & Validation

For developers and contributors, I provide a dedicated **[React Test Application](https://github.com/difurious/lightweight-charts-line-tools-plugin-test-app)**. 

This app is used to verify the integrity of the Core and all 12 plugins (21 line tools). It features an **Automated Test Surface Generator** that produces massive grids of tools to validate every style property, culling edge-case, and coordinate interpolation variant in a single view. Turn on the subscriptions and double click any tool you see to get its properties - options to understand what options do what. This is also a visual way to confirm all aspects of the tool are working properly.