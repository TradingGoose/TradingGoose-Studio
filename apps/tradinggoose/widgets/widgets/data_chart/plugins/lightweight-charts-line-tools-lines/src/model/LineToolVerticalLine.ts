// /src/model/LineToolVerticalLine.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	SeriesType,
	LineStyle,
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
	LineEnd,
	HitTestResult,
	CompositeRenderer
} from '../../../lightweight-charts-line-tools-core/src';
import { TrendLineOptionDefaults } from './LineToolTrendLine';

import { LineToolVerticalLinePaneView } from '../views/LineToolVerticalLinePaneView';


/**
 * Defines the specific configuration overrides that create the behavior of a Vertical Line.
 *
 * **Tutorial Note:**
 * A Vertical Line is the inverse of a Horizontal Line.
 * 1. **Extensions:** It conceptually extends infinitely up and down (`extend: { left: true, right: true }` applied to the vertical axis logic).
 * 2. **Axis Labels:**
 *    - **Price Label:** Irrelevant (it covers all prices), so we hide it (`showPriceAxisLabels: false`).
 *    - **Time Label:** Critical (it marks a specific time), so we ensure it is visible (`showTimeAxisLabels: true`).
 */
const VerticalLineSpecificOverrides = {
	// Line options fixed to draw a full-height vertical line segment
	line: {
		extend: { left: true, right: true }, // No extension on this segment (full height is handled by view)
	},
	// Price Axis Label is irrelevant and should be hidden
	showPriceAxisLabels: false,
	priceAxisLabelAlwaysVisible: false,
	// Time Axis Label is the primary identification for this tool
	showTimeAxisLabels: true,
	timeAxisLabelAlwaysVisible: true,
};


/**
 * Concrete implementation of the Vertical Line drawing tool.
 *
 * **What is a Vertical Line?**
 * It is a line defined by a single anchor point (P0). The line is fixed at this point's
 * Time (X-axis) and spans the entire height of the chart pane.
 *
 * **Inheritance:**
 * Like the Horizontal Line, this tool inherits directly from {@link BaseLineTool} because it
 * represents a fundamental 1-point geometric primitive that doesn't share the 2-point logic
 * of the Trend Line family.
 */
export class LineToolVerticalLine<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('VerticalLine').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'VerticalLine';

	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Vertical Line is defined by exactly **1 point** (the position on the time scale).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 1; // Defining feature: 1 point

	/**
	 * Initializes the Vertical Line tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** We use `TrendLineOptionDefaults` to establish common styling (color, width).
	 * 2. **Overrides:** We apply `VerticalLineSpecificOverrides` to configure the axis labels correctly.
	 * 3. **View:** We assign `LineToolVerticalLinePaneView`. This view is responsible for taking the
	 *    single point and manufacturing a vertical segment that spans from Y=0 to Y=PaneHeight.
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
		options: DeepPartial<LineToolOptionsInternal<'VerticalLine'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// 1. Start with a deep copy of the base TrendLine defaults (for common options structure)
		const finalOptions = deepCopy(TrendLineOptionDefaults) as LineToolOptionsInternal<'VerticalLine'>;
 
		// 2. Merge the VerticalLineSpecificOverrides over the base defaults.
		merge(finalOptions, deepCopy(VerticalLineSpecificOverrides));

		// 3. Merge the user's provided options last (User wins).
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'VerticalLine'>>);

		// 4. Call the parent (BaseLineTool) constructor.
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'VerticalLine',
			1, // 1-point tool
			priceAxisLabelStackingManager
		);

		// 5. Set the specific PaneView for this tool.
		this._setPaneViews([new LineToolVerticalLinePaneView(this, this._chart, this._series)]);

		console.log(`VerticalLine Tool created with ID: ${this.id()}`);
	}

	/**
	 * Performs the hit test for the Vertical Line.
	 *
	 * **Architecture Note:**
	 * Because the line extends infinitely vertically, a simple point-to-point distance check on the
	 * Model's anchor point is insufficient (the user might click at the very top of the screen while
	 * the anchor is in the middle).
	 *
	 * We delegate this to the `LineToolVerticalLinePaneView`, which knows the exact pixel height
	 * of the pane and draws the full vertical segment used for hit detection.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over the vertical line or the anchor.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		// Guard: Ensure pane view exists (prevents post-destroy calls)
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		// 1. Get the primary Pane View
		const paneView = this._paneViews[0] as LineToolVerticalLinePaneView<HorzScaleItem>;

		// 2. Get the Composite Renderer (calling renderer() also ensures it's updated)
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;

		// 3. Delegate the hit test
		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		return compositeRenderer.hitTest(x, y);
	}

	/**
	 * Updates the coordinates of the single anchor point.
	 *
	 * **Tutorial Note on Constraints:**
	 * A Vertical Line is strictly bound to the **Time Axis**.
	 * When the user drags the tool, we update the `timestamp` (X).
	 *
	 * While the `price` (Y) component technically doesn't affect the *line's* position,
	 * we still update it so the anchor handle follows the user's mouse vertically,
	 * providing better visual feedback during the drag.
	 *
	 * @param index - The index of the point (always 0).
	 * @param point - The new logical coordinates.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		if (index === 0) {
			// VerticalLine is fixed on the Time (X) axis.
			// Only update the timestamp component; ignore the price component (Y).
			this._points[0].timestamp = point.timestamp;
			
			// Optional: Allow P0's price to be updated for anchor hit-testing/visualization, but it has no impact on the line itself.
			this._points[0].price = point.price; 
			
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
		return 0;
	}
}