// lightweight-charts-line-tools-market-depth/src/model/LineToolMarketDepth.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	SeriesType,
	Coordinate,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPoint,
	LineToolOptionsInternal,
	LineToolType,
	DeepPartial,
	LineToolsCorePlugin,
	merge,
	deepCopy,
	PriceAxisLabelStackingManager,
	HitTestResult,
	TextAlignment,
	BoxVerticalAlignment,
	BoxHorizontalAlignment,
	PaneCursorType,
	HitTestType,
} from '../../../lightweight-charts-line-tools-core/src';

import { LineToolMarketDepthPaneView } from '../views/LineToolMarketDepthPaneView';


/**
 * Defines the default configuration options for the Market Depth tool.
 * 
 * **Tutorial Note:**
 * This tool is designed primarily as a **display-only** visualization. Unlike interactive 
 * drawing tools, the Market Depth tool is often populated via external data streams 
 * (like an Order Book).
 * 
 * Key Defaults:
 * - **Interactivity:** `editable` is set to `false` by default, and cursors are set to `Auto` 
 *   to indicate to the user that this visualization is part of the chart background 
 *   rather than an adjustable drawing.
 * - **Visuals:** Includes default theme colors for Bids (Teal) and Asks (Red) and 
 *   configures a 300px default line length for the depth bars.
 */
const MarketDepthToolDefaultOptions: LineToolOptionsInternal<'MarketDepth'> = {
	visible: true,
	editable: false, // PRIMARY BLOCK: Tool is for display only
	defaultHoverCursor: PaneCursorType.Auto, // Cursor should not indicate a tool that can be selected
	defaultDragCursor: PaneCursorType.Auto,
	notEditableCursor: PaneCursorType.Default, // Standard cursor over tool
	showPriceAxisLabels: false,
	showTimeAxisLabels: false,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,

	// Specific Options for MarketDepthTool
	text: {
		value: '', // Simple text for the single anchor point (P0)
		padding: 0,
		wordWrapWidth: 0,
		forceTextAlign: false,
		forceCalculateMaxLineWidth: false,
		alignment: TextAlignment.Center,
		font: {
			color: '#ffffff',
			size: 10,
			bold: false,
			italic: false,
			family: 'sans-serif',
		},
		box: {
			scale: 1,
			angle: 0,
			alignment: { vertical: BoxVerticalAlignment.Top, horizontal: BoxHorizontalAlignment.Left },
			offset: { x: 5, y: 5 }, // Offset the anchor label slightly
		},
	},

	marketDepth: {
		lineWidth: 1,
		lineStyle: 0, // LineStyle.Solid (0)
		lineOffset: 30,
		lineLength: 300,
		lineBidColor: 'rgba(42, 122, 129, 1)', // #2a7a81
		lineAskColor: 'rgba(210, 73, 73, 1)', // #d24949
		totalBidAskCalcMethod: 'combined',
		timestampStartOffset: 50,
		marketDepthData: {
			Bids: [],
			Asks: [],
		},
	},
};


/**
 * Concrete implementation of the Market Depth line tool.
 * 
 * **What is a Market Depth Tool?**
 * This tool visualizes the current supply and demand (Order Book) directly on the chart 
 * at specific price levels. It is defined by a **Single Point** (P0) which serves as 
 * the horizontal anchor (the "base line") from which the depth bars extend.
 * 
 * **Inheritance:**
 * It inherits from `BaseLineTool` and is configured as a non-interactive primitive. 
 * It uses the specialized `MarketDepthRenderer` to handle the high-performance drawing 
 * of potentially hundreds of individual price levels.
 */
export class LineToolMarketDepth<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('MarketDepth').
	 * 
	 * @override
	 */
	public override readonly toolType: LineToolType = 'MarketDepth';

	/**
	 * Defines the number of anchor points required to draw this tool.
	 * 
	 * A Market Depth tool uses **1 point** to determine its horizontal position 
	 * and starting reference for the depth visualization.
	 * 
	 * @override
	 */
	public override readonly pointsCount: number = 1; // Defining feature: 1 point

	/**
	 * Initializes the Market Depth tool.
	 * 
	 * **Tutorial Note on Construction:**
	 * 1. **Defaults:** Merges the specialized `MarketDepthToolDefaultOptions`.
	 * 2. **Super Call:** Passes `pointsCount: 1` and the 'MarketDepth' type to the core class.
	 * 3. **View Assignment:** Assigns `LineToolMarketDepthPaneView`, which coordinates 
	 *    the custom rendering of the Bid/Ask data.
	 * 
	 * @param coreApi - The Core Plugin API instance.
	 * @param chart - The Lightweight Charts Chart API.
	 * @param series - The Series API this tool is attached to.
	 * @param horzScaleBehavior - The horizontal scale behavior for time calculations.
	 * @param options - Partial configuration overrides.
	 * @param points - Initial points for the tool (usually the anchor location).
	 * @param priceAxisLabelStackingManager - The manager for label collision resolution.
	 */
	public constructor(
		coreApi: LineToolsCorePlugin<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
		horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
		options: DeepPartial<LineToolOptionsInternal<'MarketDepth'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// 1. Create final options object
		const finalOptions = deepCopy(MarketDepthToolDefaultOptions) as LineToolOptionsInternal<'MarketDepth'>;
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'MarketDepth'>>);

		// 2. Call the BaseLineTool constructor
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'MarketDepth',
			1, // 1-point tool
			priceAxisLabelStackingManager
		);

		// 3. Set the specific PaneView for this tool.
		this._setPaneViews([new LineToolMarketDepthPaneView(this, this._chart, this._series)]);

		console.log(`MarketDepth Tool created with ID: ${this.id()}`);
	}

	/**
	 * Implementation of the hit-testing logic for the tool.
	 * 
	 * **Architecture Note:**
	 * Because this tool is intended to be a read-only data visualization, this method 
	 * always returns `null`. This prevents the `InteractionManager` from selecting, 
	 * dragging, or otherwise interacting with the depth bars, ensuring they do not 
	 * interfere with actual drawing tools or the chart crosshair.
	 * 
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns Always returns `null` to disable interactivity.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		// As this is a non-editable, view-only tool, we must return null to block selection/drag.
		return null;
	}

	/**
	 * Updates the logical coordinates of the tool's single anchor point.
	 * 
	 * Although the tool is generally non-editable by the user, this method allows the 
	 * developer to programmatically shift the anchor or move the tool across the timeline.
	 * 
	 * @param index - The index of the point (always 0).
	 * @param point - The new logical time and price coordinates.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		if (index === 0) {
			this._points[0] = point;
			this._triggerChartUpdate();
		}
	}

	/**
	 * Determines if the tool has been fully created.
	 * 
	 * For a single-point visualization like Market Depth, the tool is considered 
	 * "finished" as soon as the anchor point is defined.
	 * 
	 * @returns `true` if the tool has at least one point.
	 * @override
	 */
	public override isFinished(): boolean {
		return this._points.length >= this.pointsCount;
	}
}