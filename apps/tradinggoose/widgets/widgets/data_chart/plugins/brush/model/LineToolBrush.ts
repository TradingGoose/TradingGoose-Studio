// lightweight-charts-line-tools-freehand/src/model/LineToolBrush.ts

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
	LineToolsCorePlugin,
	LineEnd,
	LineJoin,
	deepCopy,
	merge,
	DeepPartial,
	PaneCursorType,
	FinalizationMethod,
	Point,
	PriceAxisLabelStackingManager,
	HitTestResult,
	LineToolHitTestData,
	ensureNotNull,
	CompositeRenderer,
	LineCap
} from '../../core';

import { LineToolBrushPaneView } from '../views/LineToolBrushPaneView';


/**
 * Defines the default configuration options for the Brush (Freehand) tool.
 *
 * **Key Defaults:**
 * - **Points:** `pointsCount: -1` indicates an unbounded tool (variable number of points).
 * - **Interaction:** `MouseUp` finalization for continuous drawing.
 * - **Line Style:** `Round` line caps and joins for a smooth, natural brush stroke.
 * - **Color:** Default cyan line, transparent background.
 * - **Labels:** Axis labels are hidden by default as this is an annotation tool.
 * - **Anchors:** Only the center anchor is active for dragging the whole tool.
 */
export const BrushOptionDefaults: LineToolOptionsInternal<'Brush'> = {
	visible: true,
	editable: true,
	defaultHoverCursor: PaneCursorType.Pointer,
	defaultDragCursor: PaneCursorType.Grabbing,
	defaultAnchorHoverCursor: PaneCursorType.DiagonalNwSeResize,
	defaultAnchorDragCursor: PaneCursorType.Grabbing,
	notEditableCursor: PaneCursorType.NotAllowed,
	showPriceAxisLabels: false,
	showTimeAxisLabels: false,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,

	// Specific Options for BrushToolOptions
	line: {
		width: 2,
		color: 'rgba(0, 188, 212, 1)', // Cyan
		style: LineStyle.Solid,
		join: LineJoin.Round,
		cap: LineCap.Round,
	},

	background: {
		color: 'rgba(0, 0, 0, 0)', // Transparent by default
	},
};

/**
 * Defines the minimum pixel distance a new mouse point must move from the last recorded point
 * before it is added to the Brush's internal data array.
 *
 * **Why is this needed?**
 * Freehand tools generate a high volume of mouse events. This threshold acts as a filter
 * to smooth out the input, preventing an excessive number of redundant points and
 * creating a cleaner, less "jittery" line. This value is based on the V3.8 implementation.
 */
const DISTANCE_THRESHOLD_PX = 2;


/**
 * Concrete implementation of the Brush (Freehand) drawing tool.
 *
 * **What is a Brush Tool?**
 * A Brush tool allows the user to draw continuous, freehand lines by clicking and dragging
 * the mouse. It captures a stream of points as the mouse moves.
 *
 * **Key Characteristics:**
 * - **Unbounded Points:** `pointsCount: -1` (it can have any number of points).
 * - **MouseUp Finalization:** Drawing ends when the mouse button is released.
 * - **Point Filtering:** Implements `addPoint` override to filter out redundant points
 *   (i.e., points too close to the last one).
 */
export class LineToolBrush<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('Brush').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'Brush';
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Brush tool is **unbounded** and can have any number of points, so `pointsCount` is `-1`.
	 *
	 * @override
	 */
	public override readonly pointsCount: number = -1; // Unbounded points

	// Max interactive anchor index should be 0, as we only allow moving the tool as a whole
	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * For a Brush tool, typically only one virtual "center" anchor is used to drag
	 * the entire shape. Therefore, the maximum index is **0**.
	 *
	 * @override
	 * @returns `0`
	 */
	public maxAnchorIndex(): number {
		return 0; // Only the center anchor is typically used for whole-tool drag
	}

	/**
	 * Indicates if the tool supports "Click-Click" creation.
	 *
	 * **Tutorial Note:**
	 * Freehand tools (`Brush`, `Highlighter`) are designed for continuous drawing via drag.
	 * "Click-Click" is not a natural interaction for them.
	 *
	 * @override
	 * @returns `false`
	 */
	public supportsClickClickCreation(): boolean {
		return false; // Brush does NOT support click-click
	}

	/**
	 * Confirms that this tool can be created via the "Click-Drag" method.
	 *
	 * **Interaction Flow:** Press Down -> Draw Continuously -> Release.
	 * This is the primary and only way to draw with the Brush tool.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickDragCreation(): boolean {
		return true; // Brush supports click-drag
	}

	/**
	 * Indicates if holding Shift should apply geometric constraints during creation/editing.
	 *
	 * **Tutorial Note:**
	 * For freehand drawing, applying constraints would hinder the natural flow.
	 * Therefore, this is disabled.
	 *
	 * @override
	 * @returns `false`
	 */
	public supportsShiftClickDragConstraint(): boolean {
		return false; // Brush does not constrain movement
	}

	/**
	 * Initializes the Brush tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** Uses `BrushOptionDefaults` (cyan line, transparent background).
	 * 2. **User Options:** Merges user provided settings.
	 * 3. **Points Count:** Explicitly sets `pointsCount` to `-1` for unbounded drawing.
	 * 4. **View:** Assigns `LineToolBrushPaneView`, which handles smoothing the raw mouse input
	 *    and rendering the continuous path.
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
		options: DeepPartial<LineToolOptionsInternal<'Brush'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = deepCopy(BrushOptionDefaults) as LineToolOptionsInternal<'Brush'>;
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'Brush'>>);

		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'Brush',
			-1, // Unbounded
			priceAxisLabelStackingManager
		);

		// A PaneView is responsible for rendering the tool on the chart.
		this._setPaneViews([new LineToolBrushPaneView(this, this._chart, this._series)]);
	}

	/**
	 * Overrides the base `addPoint` method to implement **distance-based point filtering**.
	 *
	 * **Tutorial Note on Smoothing Input:**
	 * Freehand drawing captures many points. To prevent jagged lines and reduce data load,
	 * this method checks the pixel distance between the new point and the last permanent point.
	 * - If the distance is below `DISTANCE_THRESHOLD_PX`, the new point is discarded.
	 * - Only significant movements are added, creating a smoother visual path.
	 *
	 * @param newLogicalPoint - The new point suggested by the `InteractionManager`.
	 * @override
	 */
	public override addPoint(newLogicalPoint: LineToolPoint): void {
		const permanentPointsCount = this.getPermanentPointsCount();

		if (permanentPointsCount > 0) {
			const lastLogicalPoint = ensureNotNull(this.getPoint(permanentPointsCount - 1));

			// 1. Convert the new point and the last permanent point to screen coordinates
			const lastScreenPoint = this.pointToScreenPoint(lastLogicalPoint);
			const newScreenPoint = this.pointToScreenPoint(newLogicalPoint);

			if (lastScreenPoint && newScreenPoint) {
				// 2. Check the screen distance (in pixels)
				const distance = newScreenPoint.subtract(lastScreenPoint).length();

				// 3. Filter the point: Only add if the movement is significant
				if (distance < DISTANCE_THRESHOLD_PX) {
					return; // Point is too close to the last one, filter it out
				}
			}
		}

		// If it's the first point, or the distance is sufficient, add the point
		super.addPoint(newLogicalPoint);
	}

	/**
	 * Specifies how the tool creation should end.
	 *
	 * For a freehand tool like Brush, drawing continues as long as the mouse button is down.
	 * Therefore, creation is finalized on `MouseUp`.
	 *
	 * @override
	 * @returns `FinalizationMethod.MouseUp`
	 */
	public override getFinalizationMethod(): FinalizationMethod {
		return FinalizationMethod.MouseUp;
	}
	
	/**
	 * Explicitly enables full tool translation when dragging the first anchor (index 0).
	 *
	 * **Tutorial Note:**
	 * For unbounded tools like Brush, there isn't really a "point 0" in the traditional sense
	 * that you'd resize from. The single anchor that appears for a Brush is intended to
	 * let the user **drag the entire shape** around the chart. This override enables that behavior.
	 *
	 * @override
	 * @returns `true`
	 */
	public override anchor0TriggersTranslation(): boolean {
		// Override to explicitly enable the translation behavior for Anchor 0,
		// as this tool is designed to move as a whole via its single anchor.
		return true;
	}
		
	/**
	 * Performs the hit test for the Brush tool by delegating to its associated Pane View.
	 *
	 * **Architecture Note:**
	 * The `LineToolBrushPaneView` uses a `PolygonRenderer` to draw the smoothed, filled path.
	 * The `PolygonRenderer` is responsible for the complex `pointInPolygon` hit-testing.
	 * This method simply acts as the bridge to that logic.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over the brush stroke or its bounding box.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {

		// This guards against hitTest being called after the tool has been destroyed and _paneViews cleared.
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		// The Brush tool only has one view, which is the BrushPaneView.
		const paneView = this._paneViews[0] as LineToolBrushPaneView<HorzScaleItem>;
		
		// Get the composite renderer from the view
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;
		
		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		// Delegate the hit-test to the CompositeRenderer, which will check the PolygonRenderer
		const hitResult = compositeRenderer.hitTest(x, y);

		return hitResult;
	}
}