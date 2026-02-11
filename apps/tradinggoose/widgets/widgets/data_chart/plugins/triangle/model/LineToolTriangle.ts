// /src/model/LineToolTriangle.ts

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
	buildToolOptions,
	DeepPartial,
	PaneCursorType,
	FinalizationMethod,
	PriceAxisLabelStackingManager,
	HitTestResult,
	LineToolHitTestData,
	CompositeRenderer,
} from '../../core';

import { LineToolTrianglePaneView } from '../views/LineToolTrianglePaneView';


/**
 * Defines the default configuration options for the Triangle tool.
 *
 * **Tutorial Note:**
 * A Triangle is a "Polygon" type tool defined by 3 points.
 * These defaults set:
 * 1. **Interaction:** Standard pointer/grabbing cursors.
 * 2. **Visuals:** A semi-transparent orange fill (`background`) and a solid orange outline (`border`).
 * 3. **Labels:** Axis labels are enabled, but the specific label values will depend on the last moved point.
 */
export const TriangleOptionDefaults: LineToolOptionsInternal<'Triangle'> = {
	// Common Base Options for all Line Tools
	visible: true,
	editable: true,
	defaultHoverCursor: PaneCursorType.Pointer,
	defaultDragCursor: PaneCursorType.Grabbing,
	defaultAnchorHoverCursor: PaneCursorType.DiagonalNwSeResize,
	defaultAnchorDragCursor: PaneCursorType.DiagonalNwSeResize,
	notEditableCursor: PaneCursorType.NotAllowed,
	showPriceAxisLabels: true,
	showTimeAxisLabels: true,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,

	// Specific Options for TriangleToolOptions (Based on V3.8 structure)
	triangle: {
		background: { color: 'rgba(245, 123, 0, 0.2)' }, // Translucent Orange Fill
		border: { 
			color: '#f57c00', // Orange Border
			width: 1, 
			style: LineStyle.Solid,
		},
	},
};


/**
 * Concrete implementation of the Triangle drawing tool.
 *
 * **What is a Triangle Tool?**
 * It is a closed geometric shape defined by exactly **3 points** (P0, P1, P2).
 * Unlike a Trend Line (2 points) or a Brush (unlimited points), the Triangle has a strict
 * 3-step creation process.
 *
 * **Inheritance:**
 * It extends {@link BaseLineTool} directly. It uses the `LineToolTrianglePaneView` to render
 * a filled polygon connecting the three points.
 */
export class LineToolTriangle<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('Triangle').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'Triangle';
	
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Triangle requires exactly **3 points** to close the shape.
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 3;

	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * Since `pointsCount` is 3, the valid indices are 0, 1, and 2.
	 * The `InteractionManager` uses this to track the drag state for all three vertices.
	 *
	 * @override
	 * @returns `2`
	 */
	public override maxAnchorIndex(): number {
		return 2;
	}

	/**
	 * Confirms that this tool can be created via the "Click-Click" method.
	 *
	 * **Interaction Flow:**
	 * 1. Click P0.
	 * 2. Click P1.
	 * 3. Click P2 (Finalize).
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
	 * For a 3-point tool, "Click-Drag" (Press P0 -> Release P1) is insufficient because
	 * we still need a third point. Therefore, this returns `false`, forcing the Interaction Manager
	 * to rely on discrete clicks to place all vertices.
	 *
	 * @override
	 * @returns `false`
	 */
	public override supportsClickDragCreation(): boolean {
		return false;
	}

	/**
	 * Indicates if holding Shift should apply geometric constraints during creation.
	 *
	 * **Tutorial Note:**
	 * For arbitrary triangles, "constraints" are ambiguous (equilateral? right angle relative to what?).
	 * We currently return `false` to disable constraints, allowing free-form placement of all three points.
	 *
	 * @override
	 * @returns `false`
	 */
	public override supportsShiftClickClickConstraint(): boolean {
		return false;
	}

	/**
	 * Initializes the Triangle tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** Uses `TriangleOptionDefaults` (Orange theme).
	 * 2. **User Options:** Merges user settings.
	 * 3. **View:** Assigns `LineToolTrianglePaneView`, which uses the `PolygonRenderer`
	 *    to draw the connected shape.
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
		options: DeepPartial<LineToolOptionsInternal<'Triangle'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = buildToolOptions(TriangleOptionDefaults, options);

		// Call the BaseLineTool constructor
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'Triangle',
			3, // Fixed 3 points
			priceAxisLabelStackingManager
		);

		// Assign the rendering view for this tool
		this._setPaneViews([new LineToolTrianglePaneView(this, this._chart, this._series)]);
	}

	/**
	 * Specifies how the tool creation should end.
	 *
	 * We return `FinalizationMethod.PointCount`. This tells the Interaction Manager:
	 * "As soon as the user places the 3rd point, stop creating and select the tool."
	 *
	 * @override
	 * @returns `FinalizationMethod.PointCount`
	 */
	public override getFinalizationMethod(): FinalizationMethod {
		return FinalizationMethod.PointCount;
	}

	/**
	 * Performs the hit test for the Triangle.
	 *
	 * **Architecture Note:**
	 * Hit testing a filled polygon is mathematically complex. Instead of duplicating that logic here,
	 * we delegate to the `LineToolTrianglePaneView`. Its renderer (the `PolygonRenderer`) already
	 * contains the ray-casting logic (`pointInPolygon`) to detect if the mouse is inside the shape
	 * or near its edges.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over the triangle body or edges.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		// Guard against a view that might not be ready or available
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

		// Console log for debugging hit test (optional)

		return hitResult;
	}
}
