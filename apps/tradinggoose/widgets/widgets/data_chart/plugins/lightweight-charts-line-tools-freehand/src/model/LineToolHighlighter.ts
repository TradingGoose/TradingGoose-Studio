// lightweight-charts-line-tools-freehand/src/model/LineToolHighlighter.ts

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
	LineCap,
} from '../../../lightweight-charts-line-tools-core/src';

import { LineToolHighlighterPaneView } from '../views/LineToolHighlighterPaneView';


/**
 * Defines the default configuration options for the Highlighter tool.
 *
 * **Tutorial Note:**
 * The Highlighter is functionally identical to the Brush but differs in its visual defaults:
 * - **Width:** Much thicker (20px) to cover text or bars.
 * - **Color:** Translucent yellow (`rgba(255, 255, 0, 0.4)`) to simulate a real highlighter marker.
 * - **End Caps:** Round caps for smooth strokes.
 */
export const HighlighterOptionDefaults: LineToolOptionsInternal<'Highlighter'> = {
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

	// Specific Options for HighlighterToolOptions
	line: {
		width: 20,
		color: 'rgba(255, 255, 0, 0.4)',
		style: LineStyle.Solid,
		join: LineJoin.Round,
		cap: LineCap.Round,
	},
	background: {
		color: 'rgba(0, 0, 0, 0)', 
	},
};

// Threshold for point filtering in screen space (pixels) - Must be the same as Brush
const DISTANCE_THRESHOLD_PX = 2;


/**
 * Concrete implementation of the Highlighter drawing tool.
 *
 * **What is a Highlighter?**
 * It is a freehand drawing tool designed to overlay chart data with a thick, translucent stroke.
 *
 * **Inheritance:**
 * It extends {@link BaseLineTool} directly. While it shares almost all logic with {@link LineToolBrush}
 * (unbounded points, mouse-up finalization, point filtering), it is implemented as a separate class
 * to allow for distinct type identification (`toolType: 'Highlighter'`) and specific default styling.
 */
export class LineToolHighlighter<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('Highlighter').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'Highlighter';
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * Like the Brush, the Highlighter is **unbounded** (`-1`), allowing an unlimited number of points
	 * to define the freehand path.
	 *
	 * @override
	 */
	public override readonly pointsCount: number = -1; // Unbounded points

	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * We only use a single center anchor (index 0) to allow dragging the entire highlight shape.
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
	 * Highlighter drawing is a continuous drag operation. Discrete clicks are not supported.
	 *
	 * @override
	 * @returns `false`
	 */
	public supportsClickClickCreation(): boolean {
		return false; // Does NOT support click-click
	}

	/**
	 * Confirms that this tool is created via the "Click-Drag" method.
	 *
	 * **Interaction Flow:** Press Down -> Highlight Area -> Release.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickDragCreation(): boolean {
		return true; // Supports click-drag
	}

	/**
	 * Indicates if holding Shift should apply geometric constraints.
	 *
	 * Disabled (`false`) for freehand tools to allow natural movement.
	 *
	 * @override
	 * @returns `false`
	 */
	public supportsShiftClickDragConstraint(): boolean {
		return false; // Does not constrain movement
	}

	/**
	 * Initializes the Highlighter tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** Uses `HighlighterOptionDefaults` (thick yellow line).
	 * 2. **User Options:** Merges user settings.
	 * 3. **Points Count:** Sets `-1` for unbounded drawing.
	 * 4. **View:** Assigns `LineToolHighlighterPaneView`, which handles the rendering of the thick, smoothed path.
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
		options: DeepPartial<LineToolOptionsInternal<'Highlighter'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = deepCopy(HighlighterOptionDefaults) as LineToolOptionsInternal<'Highlighter'>;
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'Highlighter'>>);

		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'Highlighter', // Unique tool type identifier
			-1, // Unbounded
			priceAxisLabelStackingManager
		);

		// A PaneView is responsible for rendering the tool on the chart.
		this._setPaneViews([new LineToolHighlighterPaneView(this, this._chart, this._series)]);
	}

	/**
	 * Overrides the base `addPoint` method to implement **distance-based point filtering**.
	 *
	 * **Tutorial Note on Optimization:**
	 * Just like the Brush tool, the Highlighter filters out points that are too close (within `DISTANCE_THRESHOLD_PX`)
	 * to the previous point. This keeps the data array smaller and the rendering performance higher
	 * without sacrificing visual quality.
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
	 * Highlighting ends immediately when the user releases the mouse button.
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
	 * This allows the user to reposition the entire highlight mark by dragging its single handle.
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
	 * Performs the hit test for the Highlighter tool.
	 *
	 * **Architecture Note:**
	 * Delegates to the `LineToolHighlighterPaneView`. The view's `PolygonRenderer` handles the complex
	 * geometry check to see if the mouse is hovering over the thick stroke of the highlighter.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over the highlight.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {

		// This guards against hitTest being called after the tool has been destroyed and _paneViews cleared.
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		// The Highlighter tool only has one view, which is the HighlighterPaneView.
		const paneView = this._paneViews[0] as LineToolHighlighterPaneView<HorzScaleItem>;
		
		// Get the composite renderer from the view
		const compositeRenderer = paneView.renderer();
		
		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		// Delegate the hit-test to the CompositeRenderer, which will check the PolygonRenderer
		const hitResult = compositeRenderer.hitTest(x, y);

		return hitResult;
	}
}