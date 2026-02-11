// /src/model/LineToolTrendLine.ts

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
	LineToolPartialOptionsMap,
	LineToolTrendLineOptions,
	TextOptions,
	EndOptions,
	ExtendOptions,
	TextAlignment,
	BoxVerticalAlignment,
	BoxHorizontalAlignment,
	LineToolsCorePlugin,
	LineEnd,
	DeepPartial,
	PaneCursorType,
	HitTestResult,
	LineToolHitTestData,
	CompositeRenderer,
	Point,
	InteractionPhase,
	PriceAxisLabelStackingManager,
	ConstraintResult
} from '../../../core';

import { LineToolTrendLinePaneView } from '../views/LineToolTrendLinePaneView';
import { buildLineToolOptions } from './line-tool-options';

/**
 * Defines the default configuration options for the Trend Line tool.
 *
 * These defaults serve as the baseline for the Trend Line itself, but are also exported
 * and reused by derived tools (like Ray, Arrow, and Extended Line) to ensure visual consistency
 * across all 2-point line tools.
 *
 * Key defaults include:
 * - Color: Blue (`#2962ff`)
 * - Width: 1px
 * - Style: Solid
 * - Extensions: None (a finite segment)
 * - End Caps: Normal (no arrows)
 */
export const TrendLineOptionDefaults: LineToolOptionsInternal<'TrendLine'> = {
	visible: true,
	editable: true,
	defaultHoverCursor: PaneCursorType.Pointer,
	defaultDragCursor: PaneCursorType.Grabbing,
	defaultAnchorHoverCursor: PaneCursorType.Pointer,
	defaultAnchorDragCursor: PaneCursorType.Grabbing,
	notEditableCursor: PaneCursorType.NotAllowed,
	showPriceAxisLabels: true,
	showTimeAxisLabels: true,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,
	
	// Specific Options for TrendLineToolOptions
	line: {
		width: 1,
		color: '#2962ff', // default blue
		style: LineStyle.Solid,
		extend: { left: false, right: false },
		end: { left: LineEnd.Normal, right: LineEnd.Normal },
	},
	text: {
		value: '',
		padding: 0,
		wordWrapWidth: 0,
		forceTextAlign: false,
		forceCalculateMaxLineWidth: false,
		alignment: TextAlignment.Center,
		font: { family: 'sans-serif', color: '#2962ff', size: 12, bold: false, italic: false },
		box: { 
			scale: 1, 
			angle: 0, 
			alignment: { vertical: BoxVerticalAlignment.Middle, horizontal: BoxHorizontalAlignment.Center },
			// Default box and shadow options
		},
	} as TextOptions, // Ensure the structure of TextOptions is complete if TextToolOptions requires it
};


/**
 * Concrete implementation of the standard Trend Line drawing tool.
 *
 * A Trend Line is the fundamental 2-point geometry tool. It connects a start point (P1)
 * and an end point (P2) with a straight line.
 *
 * **Tutorial Note on Inheritance:**
 * This class is designed to be extended. Tools like `LineToolRay`, `LineToolArrow`, and
 * `LineToolExtendedLine` inherit from this class because they share the exact same
 * input logic (2 points) and interaction rules. They only differ in their visual
 * options (e.g., `extend.right = true` for a Ray).
 */
export class LineToolTrendLine<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('TrendLine').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'TrendLine';
	
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Trend Line always consists of exactly **2 points** (Start and End).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 2;
	
	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * Since `pointsCount` is 2, the valid indices are 0 and 1. Therefore, the maximum index is 1.
	 * The `InteractionManager` uses this to ensure it tracks drag gestures for both ends of the line.
	 *
	 * @override
	 * @returns `1`
	 */
	public maxAnchorIndex(): number {
		return 1; // Anchors are indexed from 0 to 1.
	}
	
	/**
	 * Confirms that this tool can be created via the "Click-Click" method.
	 *
	 * **Interaction Flow:**
	 * 1. User clicks once to set the Start Point (P1).
	 * 2. User moves the mouse (ghost line follows).
	 * 3. User clicks again to set the End Point (P2).
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickClickCreation(): boolean {
		return true; // TrendLine supports click-click creation
	}

	/**
	 * Confirms that this tool can be created via the "Click-Drag" method.
	 *
	 * **Interaction Flow:**
	 * 1. User presses mouse down to set the Start Point (P1).
	 * 2. User drags the mouse while holding the button.
	 * 3. User releases the mouse button to set the End Point (P2).
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickDragCreation(): boolean {
		return true; // TrendLine supports click-drag creation
	}

	/**
	 * Enables geometric constraints (Shift key) during "Click-Click" creation.
	 *
	 * If `true`, holding Shift while hovering to place the second point will lock the line
	 * to specific angles (e.g., horizontal, vertical, or 45-degree increments).
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickClickConstraint(): boolean {
		return true; // TrendLine supports Shift constraint during click-click creation
	}

	/**
	 * Enables geometric constraints (Shift key) during "Click-Drag" creation.
	 *
	 * If `true`, holding Shift while dragging to place the second point will lock the line
	 * to specific angles.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickDragConstraint(): boolean {
		return true; // TrendLine supports Shift constraint during click-drag creation
	}

	/**
	 * Initializes the Trend Line tool.
	 *
	 * **Tutorial Note on Logic:**
	 * 1. It starts with the `TrendLineOptionDefaults`.
	 * 2. It merges any user-provided `options` on top.
	 * 3. It instantiates the specific `LineToolTrendLinePaneView`, which handles the actual canvas rendering.
	 *
	 * @param coreApi - The Core Plugin API.
	 * @param chart - The Lightweight Charts Chart API.
	 * @param series - The Series API this tool is attached to.
	 * @param horzScaleBehavior - The horizontal scale behavior for time conversion.
	 * @param options - Configuration overrides.
	 * @param points - Initial points (if restoring state).
	 * @param priceAxisLabelStackingManager - The manager for label collision.
	 */
	public constructor(
		coreApi: LineToolsCorePlugin<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
		horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
		options: DeepPartial<LineToolOptionsInternal<'TrendLine'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = buildLineToolOptions<'TrendLine'>(TrendLineOptionDefaults, options);

		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'TrendLine',
			2,
			priceAxisLabelStackingManager
		);

		// A PaneView is responsible for rendering the tool on the chart.
		this._setPaneViews([new LineToolTrendLinePaneView(this, this._chart, this._series)]);
	}
	
	/**
	 * Implements the specific geometric constraint logic when the user holds the Shift key while drawing or editing.
	 *
	 * **Tutorial Note:**
	 * For a standard Trend Line, holding Shift triggers a **Price Lock** (Horizontal Lock).
	 * 1. It identifies the "Anchor Point" (the point *not* being moved).
	 * 2. It takes the Y-coordinate (Price) of that anchor.
	 * 3. It forces the point being moved to align with that Y-coordinate.
	 *
	 * This allows users to easily draw perfectly horizontal lines by holding Shift.
	 *
	 * @param pointIndex - The index of the point being moved (0 or 1).
	 * @param rawScreenPoint - The actual mouse position on screen.
	 * @param phase - Whether we are creating the tool or editing an existing one.
	 * @param originalLogicalPoint - The logical position of the point being moved before the drag started.
	 * @param allOriginalLogicalPoints - The state of all points before the drag started.
	 * @returns A result containing the constrained screen point and a hint ('price') that we snapped to a specific price level.
	 * @override
	 */
	public override getShiftConstrainedPoint(
		pointIndex: number, 
		rawScreenPoint: Point, 
		phase: InteractionPhase,
		originalLogicalPoint: LineToolPoint, // This is the *dragged* point's original logical state
		allOriginalLogicalPoints: LineToolPoint[] // This is the *entire array* of all points' original logical states
	): ConstraintResult {
		
		// The Y-constraint always comes from the "other" (non-moving) point.
		let constraintSourceLogicalPoint: LineToolPoint | null = null;

		if (phase === InteractionPhase.Creation) {
			// During Creation, P0 (index 0) is the fixed point, and P1 (index 1) is being dragged.
			// The constraint is always on P0's original Y-position.
			// In the InteractionManager, for creation, 'originalLogicalPoint' is P0's position.
			constraintSourceLogicalPoint = originalLogicalPoint; // P0's original position
		} else { // InteractionPhase.Editing
			// During Editing, the constraint is on the *other* anchor's original Y-position.
			// If pointIndex is 0, constraint is from P1 (index 1). If pointIndex is 1, constraint is from P0 (index 0).
			const otherPointIndex = pointIndex === 0 ? 1 : 0;
			constraintSourceLogicalPoint = allOriginalLogicalPoints[otherPointIndex];
		}
		
		if (!constraintSourceLogicalPoint) {
			// Safety fallback: if the constraint source point doesn't exist, return raw.
			return {point: rawScreenPoint, snapAxis: 'none'};
		}

		// Convert the constraint source's logical position to its current screen coordinates
		const constraintSourceScreenPoint = this.pointToScreenPoint(constraintSourceLogicalPoint);
		
		if (!constraintSourceScreenPoint) {
			// Safety fallback: if conversion fails, return the raw mouse point.
			return {point: rawScreenPoint, snapAxis: 'none'};
		}

		// Apply the Constraint: Force the new point's Y-coordinate to match the Y-coordinate of the constraint source.
		const constrainedY = constraintSourceScreenPoint.y;

		// Return the new screen point (X from raw mouse, Y from constraint source)
		return {
			point: new Point(rawScreenPoint.x, constrainedY),
			snapAxis: 'price',
		};
	}	

	/**
	 * Re-orders the internal points so that the start point (P0) is always chronologically earlier
	 * (to the left) than the end point (P1).
	 *
	 * **Why is this needed?**
	 * Many rendering calculations (especially for Rays or Extended Lines) assume directionality.
	 * By ensuring P0 is always the "left" point, we simplify the math for drawing extensions "to the right".
	 *
	 * @remarks
	 * If the points share the exact same time, the Price is used as a tie-breaker to ensure
	 * deterministic ordering.
	 */
	public normalize(): void {
		if (this._points.length < 2) {
			return;
		}

		// Use local variables to avoid accessing _points multiple times during conditional checks
		let [p0, p1] = this._points;

		// The primary check is Time. If P0 > P1 in time, they must be swapped.
		if (p0.timestamp > p1.timestamp) {
			this._points = [p1, p0]; // Swap the references in the array
			return;
		}

		// Tie-Breaker: If times are identical (vertical line segment)
		if (p0.timestamp === p1.timestamp) {
			// Use price as a stable tie-breaker to ensure a predictable order (e.g., P0 is always the lower price)
			if (p0.price > p1.price) {
				this._points = [p1, p0]; // Swap if P0 is higher price
				return;
			}
			// If prices are identical, no swap is necessary, and the tool is effectively a single point.
		}

		// If no swap was necessary, the array remains [p0, p1], and they are already in the correct order.
	}

	/**
	 * Updates the logical coordinates of a specific anchor point.
	 *
	 * While this implementation currently delegates directly to the base class, overriding it here
	 * allows the Trend Line to intercept point updates if custom validation logic were needed in the future.
	 *
	 * @param index - The index of the point to update (0 or 1).
	 * @param point - The new logical coordinates.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		// The InteractionManager should handle the actual constraint (Y = P1.Y) based on ShiftKey.
		// We can simply pass the constrained point to the base model.
		super.setPoint(index, point);
	}

	/**
	 * Performs the hit test to see if the mouse is hovering over this tool.
	 *
	 * **Architecture Note:**
	 * The **Model** (this class) knows *data* (time/price), but it doesn't know *pixels* (where lines are drawn).
	 * The **View** (`LineToolTrendLinePaneView`) knows pixels.
	 *
	 * Therefore, this method retrieves the active Pane View and asks its **Composite Renderer**
	 * to perform the hit test. This ensures that what the user *sees* is exactly what they *click*.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over the line or an anchor, otherwise `null`.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {

		// This guards against hitTest being called after the tool has been destroyed and _paneViews cleared.
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		
		// 1. Get the PaneView that contains the Composite Renderer
		const paneView = this._paneViews[0] as LineToolTrendLinePaneView<HorzScaleItem>;

		// 2. Get the Composite Renderer from the PaneView
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>; // Type assert to Composite

		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		// 3. Delegate the hit test to the Composite Renderer
		const hitResult = compositeRenderer.hitTest(x, y);

		// This Composite Renderer will automatically prioritize the Anchor hit (ChangePoint)
		// over the Segment hit (MovePointBackground) because Anchors are appended LAST
		// and the CompositeRenderer iterates backwards for hit testing priority.
		
		return hitResult;
	}
}
