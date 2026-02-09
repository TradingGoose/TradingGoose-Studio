// /src/model/LineToolPath.ts

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
	LineCap,
	deepCopy,
	merge,
	DeepPartial,
	PaneCursorType,
	FinalizationMethod,
	PriceAxisLabelStackingManager,
	HitTestResult,
	LineToolHitTestData,
	CompositeRenderer,
} from '../../core';

import { LineToolPathPaneView } from '../views/LineToolPathPaneView';


/**
 * Defines the default configuration options for the Path tool.
 *
 * **Tutorial Note:**
 * A Path tool is a series of connected line segments.
 * These defaults set:
 * 1. **Interaction:** Standard pointer/grabbing cursors.
 * 2. **Visuals:** A solid blue line (`#2962ff`) with an arrow head at the *end* of the path.
 * 3. **Labels:** Axis labels are hidden by default, as paths are often used for general directionality or waves.
 */
export const PathOptionDefaults: LineToolOptionsInternal<'Path'> = {
	// Common Base Options for all Line Tools
	visible: true,
	editable: true,
	defaultHoverCursor: PaneCursorType.Pointer,
	defaultDragCursor: PaneCursorType.Grabbing,
	defaultAnchorHoverCursor: PaneCursorType.Pointer,
	defaultAnchorDragCursor: PaneCursorType.Grabbing,
	notEditableCursor: PaneCursorType.NotAllowed,
	showPriceAxisLabels: false,
	showTimeAxisLabels: false,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,

	// Specific Options for Line Options (Polygonal Renderer)
	line: {
		width: 1,
		color: '#2962ff', // Default blue color
		style: LineStyle.Solid,
		end: { left: LineEnd.Normal, right: LineEnd.Arrow }, // Arrowhead on the final segment's end
	},
};


/**
 * Concrete implementation of the Path drawing tool.
 *
 * **What is a Path Tool?**
 * It is an **unbounded** polyline defined by a sequence of discrete clicks.
 *
 * **Interaction Flow:**
 * 1. Click to start (P0).
 * 2. Click to add subsequent points (P1, P2, ...).
 * 3. **Double-Click** to finalize the shape.
 *
 * **Inheritance:**
 * It extends {@link BaseLineTool} directly. Unlike the Trend Line (fixed 2 points),
 * the Path tool must manage a dynamic array of points and a specific double-click finalization logic.
 */
export class LineToolPath<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('Path').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'Path';
	
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Path tool is **unbounded** (can have any number of points), so this is set to `-1`.
	 *
	 * @override
	 */
	public override readonly pointsCount: number = -1;

	/**
	 * Calculates the highest valid index for an interactive anchor point.
	 *
	 * **Dynamic Logic:**
	 * Since the number of points in a path varies, this method returns the index of the
	 * **last** point currently in the array (`length - 1`). This ensures the Interaction Manager
	 * knows it can hit-test and drag any of the existing vertices.
	 *
	 * @override
	 * @returns The index of the last point, or `0` if empty.
	 */
	public override maxAnchorIndex(): number {
		// This will be dynamically determined by the number of points drawn.
		// For consistency, we can allow the anchor index to be the count of permanent points.
		return this.getPermanentPointsCount() > 0 ? this.getPermanentPointsCount() - 1 : 0;
	}

	/**
	 * Confirms that this tool is created via the "Click-Click" method.
	 *
	 * **Interaction Flow:** Click -> Move -> Click -> Move -> Double-Click.
	 * This is the standard behavior for polyline tools.
	 *
	 * @override
	 * @returns `true`
	 */
	public override supportsClickClickCreation(): boolean {
		return true;
	}

	/**
	 * Indicates if the tool supports "Click-Drag" creation.
	 *
	 * **Tutorial Note:**
	 * For a discrete polyline, "Click-Drag" (drawing freehand) is not the intended interaction.
	 * We return `false` to enforce the point-by-point creation style.
	 *
	 * @override
	 * @returns `false`
	 */
	public override supportsClickDragCreation(): boolean {
		return false;
	}

	/**
	 * Indicates if holding Shift should apply geometric constraints during creation/editing.
	 *
	 * **Tutorial Note:**
	 * While some polyline tools support locking segments to 45 degrees, this implementation
	 * currently returns `false` to allow free-form placement of points.
	 *
	 * @override
	 * @returns `false`
	 */
	public override supportsShiftClickClickConstraint(): boolean {
		return false;
	}

	/**
	 * Initializes the Path tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** Uses `PathOptionDefaults` (Arrow at end, Blue line).
	 * 2. **User Options:** Merges user provided settings.
	 * 3. **Points Count:** Explicitly sets `-1` for unbounded points.
	 * 4. **View:** Assigns `LineToolPathPaneView`, which uses the `PolygonRenderer`
	 *    to draw the open polyline.
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
		options: DeepPartial<LineToolOptionsInternal<'Path'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// Merge user options with defaults
		const finalOptions = deepCopy(PathOptionDefaults) as LineToolOptionsInternal<'Path'>;
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'Path'>>);

		// Call the BaseLineTool constructor
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'Path',
			-1, // Unbounded points
			priceAxisLabelStackingManager
		);

		// Assign the rendering view for this tool
		this._setPaneViews([new LineToolPathPaneView(this, this._chart, this._series)]);
	}

	/**
	 * Specifies how the tool creation should end.
	 *
	 * We return `FinalizationMethod.DoubleClick`. This tells the Interaction Manager:
	 * "Keep accepting new points indefinitely until the user **Double Clicks**."
	 *
	 * @override
	 * @returns `FinalizationMethod.DoubleClick`
	 */
	public override getFinalizationMethod(): FinalizationMethod {
		return FinalizationMethod.DoubleClick;
	}

	/**
	 * Performs the hit test for the Path tool.
	 *
	 * **Architecture Note:**
	 * Delegates to the `LineToolPathPaneView`. The view uses a `CompositeRenderer` (containing
	 * a `PolygonRenderer` and `AnchorRenderer`) to perform the Z-order sensitive check.
	 * This ensures accurate detection of hits on the thin line segments or the specific vertices.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result, or `null`.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		// Guard against a view that might not be ready or available (e.g., during destruction)
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		// The view is a CompositeRenderer which will perform Z-order sensitive hit testing
		const compositeRenderer = this._paneViews[0].renderer() as CompositeRenderer<HorzScaleItem>;

		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		// Delegate hit testing to the CompositeRenderer
		const hitResult = compositeRenderer.hitTest(x, y);

		// Add logging for important hit test events
		if (hitResult) {
			//console.log(`\tPath Tool ${this.id()} Hit: Type ${hitResult.type()}, Index ${hitResult.data()?.pointIndex}`);
		}

		return hitResult;
	}
}