// /src/model/LineToolCrossLine.ts

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
	buildToolOptions,
	PriceAxisLabelStackingManager,
	LineEnd,
	PaneCursorType,
	CompositeRenderer,
	HitTestResult
} from '../../core';

import { LineToolCrossLinePaneView } from '../views/LineToolCrossLinePaneView';


/**
 * Defines the default configuration for the Cross Line tool.
 *
 * **Tutorial Note:**
 * A Cross Line is visually distinct because it spans the entire chart in both directions.
 * These defaults set the baseline visibility and styling (e.g., solid blue lines).
 * While the `extend` property is set to true here, the actual infinite rendering logic
 * is heavily handled by the `LineToolCrossLinePaneView`, which manufactures two distinct
 * infinite segments intersecting at the anchor point.
 */
const CrossLineDefaultOptions: LineToolOptionsInternal<'CrossLine'> = {
	visible: true,
	editable: true,
	defaultHoverCursor: PaneCursorType.Crosshair,
	defaultDragCursor: PaneCursorType.Crosshair,
	defaultAnchorHoverCursor: PaneCursorType.Crosshair,
	defaultAnchorDragCursor: PaneCursorType.Crosshair,
	notEditableCursor: PaneCursorType.Crosshair,
	showPriceAxisLabels: true,
	showTimeAxisLabels: true,
	priceAxisLabelAlwaysVisible: true,
	timeAxisLabelAlwaysVisible: true,
	
	// Specific Line Options (Inherited from the simplified V3.8 CrossLine options)
	line: {
		width: 1,
		color: '#2962ff', // Default blue
		style: LineStyle.Solid,
		// We keep extend/end properties to give flexibility, but the view will handle the infinite span
		extend: { left: true, right: true }, // The view will interpret this as full infinite span
		end: { left: LineEnd.Normal, right: LineEnd.Normal },
	},
};


/**
 * Concrete implementation of the Cross Line drawing tool.
 *
 * **What is a Cross Line?**
 * Unlike a Trend Line (2 points) or a Ray (2 points), a Cross Line is defined by a
 * **single point** (P0). This point represents the intersection where a vertical line
 * and a horizontal line meet.
 *
 * **Inheritance Note:**
 * Because this is a 1-point tool, it extends the abstract {@link BaseLineTool} directly
 * rather than inheriting from `LineToolTrendLine`. It implements its own simple
 * logic for point updates and hit testing.
 */
export class LineToolCrossLine<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('CrossLine').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'CrossLine';
	
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Cross Line is defined by exactly **1 point** (the center of the cross).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 1; // Defining feature: 1 point

	/**
	 * Initializes the Cross Line tool.
	 *
	 * **Tutorial Note:**
	 * 1. It merges `CrossLineDefaultOptions` with user options.
	 * 2. It sets `pointsCount` to 1 in the `super()` call.
	 * 3. It assigns the specialized `LineToolCrossLinePaneView`, which is responsible
	 *    for taking that single point and drawing the two intersecting infinite lines.
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
		options: DeepPartial<LineToolOptionsInternal<'CrossLine'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = buildToolOptions(CrossLineDefaultOptions, options);

		// 3. Call the parent (BaseLineTool) constructor.
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'CrossLine',
			1, // 1-point tool
			priceAxisLabelStackingManager
		);

		// 4. Set the specific PaneView for this tool.
		this._setPaneViews([new LineToolCrossLinePaneView(this, this._chart, this._series)]);

	}

	/**
	 * Performs the hit test for the Cross Line.
	 *
	 * **Architecture Note:**
	 * Even though the Model only holds one point, the View renders lines spanning the whole screen.
	 * Therefore, we cannot do simple math here. We **must** delegate to the View's `CompositeRenderer`.
	 * The View knows exactly where those infinite lines are drawn on the pixel canvas, ensuring
	 * that clicking anywhere on the crosshair lines registers as a hit.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over the horizontal or vertical line, or the center anchor.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		// Guard: Ensure pane view exists
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		// 1. Get the primary Pane View
		const paneView = this._paneViews[0] as LineToolCrossLinePaneView<HorzScaleItem>;
		paneView.renderer();

		// 2. Get the Composite Renderer 
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;

		// 3. Delegate the hit test
		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		return compositeRenderer.hitTest(x, y);
	}
	
	/**
	 * Updates the coordinates of the single anchor point (Intersection).
	 *
	 * **Tutorial Note on Constraints:**
	 * Unlike a `VerticalLine` (which locks Time) or `HorizontalLine` (which locks Price),
	 * a Cross Line moves freely in both dimensions. Therefore, this method updates
	 * both the `timestamp` (X) and `price` (Y) of point 0 whenever the user drags it.
	 *
	 * @param index - The index of the point (always 0).
	 * @param point - The new logical coordinates.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		if (index === 0) {
			// Update both Price and Time freely.
			this._points[0].timestamp = point.timestamp;
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
