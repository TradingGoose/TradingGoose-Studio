// /src/model/LineToolHorizontalLine.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	SeriesType,
	LineStyle,
	Coordinate
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
	PaneCursorType,
	PriceAxisLabelStackingManager,
	LineEnd,
	HitTestResult,
	HitTestType,
	Point,
	LineToolHitTestData,
	CompositeRenderer,
} from '../../core';

import { LineToolHorizontalLinePaneView } from '../views/LineToolHorizontalLinePaneView';
import { TrendLineOptionDefaults } from './LineToolTrendLine'; // Reuse the TrendLine base options structure



/**
 * Defines the specific configuration overrides that create the behavior of a Horizontal Line.
 *
 * **Tutorial Note:**
 * A Horizontal Line differs from a Trend Line in two main ways:
 * 1. **Geometry:** It is defined by 1 point, not 2.
 * 2. **Extension:** It implicitly extends infinitely to the left and right.
 *
 * This override forces `extend: { left: true, right: true }` and ensures that the
 * Price Axis Label is always visible, as checking the exact price level is the primary use case.
 */
const HorizontalLineSpecificOverrides = {
	// The key difference: It is a full-span line by default
	line: {
		extend: { left: true, right: true },
	},
	// Set default price axis label visibility for horizontal lines
	showPriceAxisLabels: true,
	priceAxisLabelAlwaysVisible: true,
};


/**
 * Concrete implementation of the Horizontal Line drawing tool.
 *
 * **What is a Horizontal Line?**
 * It is a line defined by a single anchor point (P0). The line passes through this point's
 * Price level (Y-axis) and spans the entire width of the chart.
 *
 * **Architecture Note:**
 * Unlike 2-point tools (TrendLine, Ray) which share a common ancestor, this class inherits directly
 * from {@link BaseLineTool}. It represents a fundamental base for "1-Point Horizontal" tools,
 * which {@link LineToolHorizontalRay} then extends.
 */
export class LineToolHorizontalLine<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('HorizontalLine').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'HorizontalLine';
	
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Horizontal Line is defined by exactly **1 point**. The time component (X) of this point
	 * places the anchor handle, but the line itself is drawn across all time.
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 1; // Defining feature of this new base

	// Inherit most logic from BaseLineTool

	/**
	 * Initializes the Horizontal Line tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** We borrow `TrendLineOptionDefaults` to get standard styling (colors, widths, text settings).
	 * 2. **Overrides:** We apply `HorizontalLineSpecificOverrides` to force infinite left/right extension and enable price labels.
	 * 3. **View:** We assign `LineToolHorizontalLinePaneView`. This view is smart enough to take a single point
	 *    and draw a line spanning the full calculated width of the chart pane.
	 *
	 * @param coreApi - The Core Plugin API.
	 * @param chart - The Lightweight Charts Chart API.
	 * @param series - The Series API this tool is attached to.
	 * @param horzScaleBehavior - The horizontal scale behavior.
	 * @param options - Configuration overrides.
	 * @param points - Initial points.
	 * @param priceAxisLabelStackingManager - The manager for label collision.
	 */
	public constructor(
		coreApi: LineToolsCorePlugin<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
		horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
		options: DeepPartial<LineToolOptionsInternal<'HorizontalLine'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// 1. Start with a deep copy of the base TrendLine defaults (for common options like text, box, etc.)
		//    We must use the full TrendLine defaults to get all the text/font/color options.
		const finalOptions = deepCopy(TrendLineOptionDefaults) as LineToolOptionsInternal<'HorizontalLine'>;
 
		// 2. Merge the HorizontalLineSpecificOverrides over the base defaults.
		merge(finalOptions, deepCopy(HorizontalLineSpecificOverrides));

		// 3. Merge the user's provided options last (User wins).
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'HorizontalLine'>>);

		// 4. Call the parent (BaseLineTool) constructor.
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'HorizontalLine',
			1, // 1-point tool
			priceAxisLabelStackingManager
		);

		// 5. Set the specific PaneView for this tool.
		this._setPaneViews([new LineToolHorizontalLinePaneView(this, this._chart, this._series)]);

		console.log(`HorizontalLine Tool created with ID: ${this.id()}`);
	}

	/**
	 * Performs the hit test for the Horizontal Line.
	 *
	 * **Architecture Note:**
	 * Since the line extends infinitely, we cannot simply check if the mouse is near the anchor point.
	 * We must check if the mouse is near the *visible line segment* on screen.
	 *
	 * The `LineToolHorizontalLinePaneView` calculates the specific start (0) and end (paneWidth)
	 * pixel coordinates for the current viewport. By delegating to the View's renderer, we ensure
	 * accurate hit detection across the entire width of the chart.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over the line or the anchor.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		// Guard: Ensure pane view exists (prevents post-destroy calls)
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		// Get the pane view and force composite build (calls _updateImpl if invalidated)
		const paneView = this._paneViews[0] as LineToolHorizontalLinePaneView<HorzScaleItem>;
		paneView.renderer(); // Builds composite with line (bound-aware points), text (if present), and anchors

		// Delegate to composite hitTest (tests reverse-append order: anchors > text > line)
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;
		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		return compositeRenderer.hitTest(x, y);
	}

	/**
	 * Updates the coordinates of the single anchor point.
	 *
	 * **Tutorial Note on 1-Point Logic:**
	 * Even though a Horizontal Line is conceptually invariant in Time (it exists at all times),
	 * the *Anchor Point* (the handle the user drags) exists at a specific Time.
	 *
	 * Therefore, we update **both** the `timestamp` (X) and `price` (Y). This allows the user
	 * to drag the handle left and right along the line (visual preference) while moving the line
	 * up and down (functional change).
	 *
	 * @param index - The index of the point (always 0).
	 * @param point - The new logical coordinates.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		if (index === 0) {
			// For HorizontalLine, only Price (Y) is important. Time (X) is just for the anchor visualization.
			
			// We update both Price and Time, so the anchor visualizes the correct position.
			this._points[0] = point;
			this._triggerChartUpdate();
		}
	}
	
	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * Since `pointsCount` is 1, the only valid index is 0.
	 *
	 * @override
	 * @returns `0`
	 */
	public override maxAnchorIndex(): number {
		return 0; // Only one anchor point at index 0
	}
}