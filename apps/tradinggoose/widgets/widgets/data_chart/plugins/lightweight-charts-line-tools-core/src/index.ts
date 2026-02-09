// /src/index.ts

/**
 * This is the main entry point for the Lightweight Charts Line Tools Core plugin.
 * It provides the factory function to initialize the plugin and exports all necessary
 * public-facing types and interfaces for consumption by an application.
 */

import { IChartApiBase, ISeriesApi, SeriesType } from 'lightweight-charts';
import { LineToolsCorePlugin } from './core-plugin';
import { BaseLineTool } from './model/base-line-tool';
import { ILineToolsApi } from './api/public-api';
import { LineToolType, IChartWidgetBase } from './types';


/**
 * The main interface for the Line Tools Plugin instance.
 *
 * This interface combines the standard runtime API methods (defined in {@link ILineToolsApi})
 * with the setup methods required to register specific tool types. This is the object
 * returned by {@link createLineToolsPlugin}.
 */
export interface ILineToolsPlugin extends ILineToolsApi {
	/**
	 * Registers a custom line tool class constructor with the plugin.
	 *
	 * You must register a tool class before you can create instances of it using {@link addLineTool}
	 * or {@link importLineTools}. This mechanism allows the plugin to remain lightweight by only
	 * including the logic for the tools you actually use.
	 *
	 * @typeParam HorzScaleItem - The type of the horizontal scale (e.g., Time or number).
	 * @param type - The unique string identifier for the tool (e.g., 'Rectangle', 'TrendLine').
	 * @param toolClass - The class constructor for the tool, which must extend {@link BaseLineTool}.
	 * @returns void
	 *
	 * @example
	 * ```ts
	 * import { LineToolRectangle } from './tools/line-tool-rectangle';
	 *
	 * // Register the tool
	 * lineToolsPlugin.registerLineTool('Rectangle', LineToolRectangle);
	 *
	 * // Now you can use it
	 * lineToolsPlugin.addLineTool('Rectangle');
	 * ```
	 */
	registerLineTool<HorzScaleItem>(
		type: LineToolType,
		toolClass: new (...args: any[]) => BaseLineTool<HorzScaleItem>
	): void;
}

/**
 * The main factory function to create and initialize the Line Tools Core Plugin.
 *
 * This function validates the provided chart and series, initializes the core logic,
 * and returns the API interface needed to interact with the plugin.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale (e.g., `Time`, `UTCTimestamp`, or `number`).
 * @param chart - The Lightweight Charts chart instance (must be created via `createChart`).
 * @param series - The specific series instance to which the drawing tools will be attached.
 * @returns An {@link ILineToolsPlugin} instance providing the API for tool management.
 *
 * @remarks
 * If the chart or series is invalid, this function will log an error and return a "dummy"
 * no-op API to prevent your application from crashing.
 *
 * @example
 * ```ts
 * const chart = createChart(document.body, { ... });
 * const series = chart.addCandlestickSeries();
 *
 * const lineTools = createLineToolsPlugin(chart, series);
 * ```
 */
export function createLineToolsPlugin<HorzScaleItem>(
	chart: IChartApiBase<HorzScaleItem>,
	series: ISeriesApi<SeriesType, HorzScaleItem>
): ILineToolsPlugin {
	try {
		if (!chart || typeof chart.timeScale !== 'function') {
			throw new Error('A valid Lightweight Charts chart instance must be provided.');
		}
		if (!series || typeof series.priceScale !== 'function') {
			throw new Error('A valid Lightweight Charts series instance must be provided.');
		}

		console.log('Initializing Line Tools Core Plugin...');
		const horzScaleBehavior = chart.horzBehaviour();

		const plugin = new LineToolsCorePlugin<HorzScaleItem>(chart, series, horzScaleBehavior);
 
		// The plugin instance itself serves as the enhanced API object.
		return plugin as ILineToolsPlugin;
		
	} catch (error: any) {
		console.error('Failed to initialize Line Tools Core Plugin:', error.message);
		// Return a dummy object to prevent the consuming application from crashing if initialization fails.
		// The real solution would be for the user to fix their setup, but this provides a fallback.
		return createDummyPluginApi();
	}
}

/**
 * Creates a no-op (dummy) implementation of the plugin API.
 *
 * This is used internally as a fallback when the plugin fails to initialize (e.g., due to missing
 * chart or series arguments). It ensures that subsequent calls to the plugin API do not throw
 * "undefined" errors, but instead log a warning to the console.
 *
 * @private
 * @returns A safe, non-functional `ILineToolsPlugin` object.
 */
function createDummyPluginApi(): ILineToolsPlugin {
	const dummyFn = () => { console.error('Line Tools Plugin not initialized correctly.'); };
	const dummyFnString = () => { console.error('Line Tools Plugin not initialized correctly.'); return '[]'; };
	const dummyFnBoolean = () => { console.error('Line Tools Plugin not initialized correctly.'); return false; };

	return {
		registerLineTool: dummyFn,
		addLineTool: () => { console.error('Line Tools Plugin not initialized correctly.'); return ''; },
		createOrUpdateLineTool: dummyFn,
		removeLineToolsById: dummyFn,
		removeLineToolsByIdRegex: dummyFn,
		removeSelectedLineTools: dummyFn,
		removeAllLineTools: dummyFn,
		getSelectedLineTools: dummyFnString,
		getLineToolByID: dummyFnString,
		getLineToolsByIdRegex: dummyFnString,
		applyLineToolOptions: dummyFnBoolean,
		exportLineTools: dummyFnString,
		importLineTools: dummyFnBoolean,
		subscribeLineToolsDoubleClick: dummyFn,
		unsubscribeLineToolsDoubleClick: dummyFn,
		subscribeLineToolsAfterEdit: dummyFn,
		unsubscribeLineToolsAfterEdit: dummyFn,
		setCrossHairXY: dummyFn,
		clearCrossHair: dummyFn,
	};
}


// Re-export all public types and interfaces for easy consumption by the end-user.
// This allows for convenient imports like `import { LineToolPoint, ILineToolsPlugin } from 'lightweight-charts-line-tools-core';`
export * from './api/public-api';
export * from './types';
export * from './utils/helpers';
export * from './utils/geometry';
export * from './utils/canvas-helpers';
export * from './utils/text-helpers';
export * from './utils/culling-helpers';

// Re-export the base class for those who will be creating their own individual line tool plugins.
export { BaseLineTool } from './model/base-line-tool';

export { AnchorPoint, LineAnchorRenderer, LineAnchorRendererData  } from './rendering/line-anchor-renderer';

export {
    SegmentRenderer,
    SegmentRendererData,
    PolygonRenderer,
    PolygonRendererData,
    RectangleRenderer,
    RectangleRendererData,
    TextRenderer,
    CircleRenderer,
    CircleRendererData,
	BoxSize,
	LinesInfo,   
    FontInfo,
    InternalData,
} from './rendering/generic-renderers';

export { CompositeRenderer } from './rendering/composite-renderer';
export { LineToolPaneView } from './views/line-tool-pane-view';
export { DataSource } from './model/data-source';
export { PriceDataSource } from './model/price-data-source';
export { PriceAxisLabelStackingManager } from './model/price-axis-label-stacking-manager';
export { LineToolsCorePlugin } from './core-plugin';
export { InteractionManager } from './interaction/interaction-manager';
export { ToolRegistry } from './model/tool-registry';





