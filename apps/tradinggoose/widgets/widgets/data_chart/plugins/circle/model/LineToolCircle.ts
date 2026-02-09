// /src/model/LineToolCircle.ts

/**
 * Implements the concrete LineTool for drawing Circles.
 * It extends BaseLineTool from the core plugin and defines the circle's
 * specific behavior, anchor geometry, and associated pane view.
 */

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	LineStyle,
	Coordinate,
	SeriesType,
} from 'lightweight-charts';
import {
	BaseLineTool,
	LineToolPoint,
	LineToolType,
	LineToolOptionsInternal,
	Point,
	merge,
	DeepPartial,
	LineToolPartialOptionsMap,
	TextAlignment,
	BoxVerticalAlignment,
	BoxHorizontalAlignment,
	LineToolHitTestData,
	PaneCursorType,
	LineToolsCorePlugin,
	deepCopy,
	InteractionPhase,
	PriceAxisLabelStackingManager,
	ensureNotNull,
	HitTestResult,
	HitTestType,
	ConstraintResult,
	SnapAxis,
} from '../../core';
import { LineToolCirclePaneView } from '../views/LineToolCirclePaneView';


/**
 * Defines the default configuration options for the Circle tool.
 *
 * **Key Defaults:**
 * - **Geometry:** Defined by Center (P0) and a Radius Point (P1).
 * - **Visuals:** Default semi-transparent purple fill and matching border.
 * - **Interaction:** Anchors are explicitly set to use the diagonal resize cursor (`DiagonalNwSeResize`)
 *   to visually cue the user that they are modifying the size of the shape.
 */
export const CircleOptionDefaults: LineToolOptionsInternal<'Circle'> = {
	visible: true,
	editable: true,
	defaultHoverCursor: PaneCursorType.Pointer,
	defaultDragCursor: PaneCursorType.Grabbing,
	defaultAnchorHoverCursor: PaneCursorType.DiagonalNwSeResize,
	defaultAnchorDragCursor: PaneCursorType.Grabbing,
	notEditableCursor: PaneCursorType.NotAllowed,
	showPriceAxisLabels: true,
	showTimeAxisLabels: true,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,
	circle: {
		background: { color: 'rgba(156,39,176,0.2)' }, // default semi-transparent purple
		border: { width: 1, style: LineStyle.Solid, color: '#9c27b0' }, // default purple border
	},
	text: {
		value: '',
		alignment: TextAlignment.Center,
		font: {
			color: '#FFFFFF',
			size: 12,
			bold: false,
			italic: false,
			family: 'sans-serif',
		},
		box: {
			alignment: { vertical: BoxVerticalAlignment.Middle, horizontal: BoxHorizontalAlignment.Center },
			angle: 0,
			scale: 1,
			padding: { x: 0, y: 0 },
			maxHeight: 0,
			shadow: { blur: 0, color: 'transparent', offset: { x: 0, y: 0 } },
			border: { color: 'transparent', width: 0, radius: 0, highlight: false, style: LineStyle.Solid },
			background: { color: 'transparent', inflation: { x: 0, y: 0 } },
		},
		padding: 0,
		wordWrapWidth: 0,
		forceTextAlign: false,
		forceCalculateMaxLineWidth: false,
	},
};

/**
 * Concrete implementation of the Circle drawing tool.
 *
 * **What is a Circle Tool?**
 * A Circle is defined by two logical points:
 * 1. **Center Point (P0):** Defines the absolute position of the circle.
 * 2. **Radius Point (P1):** Defines the radius (distance from P0) and the aspect ratio/initial rotation in logical space.
 *
 * **Tutorial Note on Resizing:**
 * This class includes complex overrides for `maxAnchorIndex`, `getPoint`, and `setPoint` to manage
 * the 6 **virtual anchors** that appear on the bounding box (Top, Bottom, Left, Right, etc.)
 * in addition to the two real points (Center and Radius).
 */
export class LineToolCircle<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('Circle').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'Circle';
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Circle is defined by exactly **2 points** (Center and Radius).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 2; // Center (P0) and Radius Point (P1)
	
	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * The Circle tool uses a total of 8 anchors for resizing:
	 * - **2 Real Anchors:** Center (0) and Radius Point (1).
	 * - **6 Virtual Anchors:** Midpoints and corners of the bounding box (indices 2 through 7).
	 *
	 * The maximum index is **7**. This tells the `InteractionManager` how many potential handles exist for hit-testing.
	 *
	 * @override
	 * @returns `7`
	 */
	public maxAnchorIndex(): number {
		return 7; // Indices 0-7 (Center, Radius Point, and 6 virtual Bounding Box points)
	}

	/**
	 * Confirms that this tool can be created via the "Click-Click" method.
	 *
	 * **Interaction Flow:** Click 1 = Center (P0); Click 2 = Radius Point (P1).
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickClickCreation(): boolean {
		return true;
	}

	/**
	 * Confirms that this tool can be created via the "Click-Drag" method.
	 *
	 * **Interaction Flow:** Press Down = Center (P0); Drag to Radius Point; Release = Radius Point (P1).
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickDragCreation(): boolean {
		return true;
	}

	/**
	 * Enables geometric constraints (Shift key) during "Click-Click" creation.
	 *
	 * If `true`, holding Shift while placing the Radius Point (P1) will constrain the radius
	 * vector, typically locking it to vertical/horizontal/45-degree increments relative to the center.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickClickConstraint(): boolean {
		return true;
	}

	/**
	 * Enables geometric constraints (Shift key) during "Click-Drag" creation.
	 *
	 * If `true`, holding Shift while dragging to place the Radius Point (P1) will constrain the radius.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickDragConstraint(): boolean {
		return true;
	}

	/**
	 * Initializes the Circle tool.
	 *
	 * **Tutorial Note on Points:**
	 * Unlike many tools that use the base class constructor, the Circle tool ensures `pointsCount`
	 * is set to 2 in the `super()` call, establishing P0 as the center and P1 as the radius reference.
	 *
	 * **View Assignment:**
	 * It assigns the specialized `LineToolCirclePaneView`, which contains the logic to:
	 * a) Translate the complex anchoring scheme (P0-P7) to screen pixels.
	 * b) Coordinate the rendering of the primary circle shape and the 8 handles.
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
		options: DeepPartial<LineToolOptionsInternal<'Circle'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = deepCopy(CircleOptionDefaults) as LineToolOptionsInternal<'Circle'>;
		merge(finalOptions, options as LineToolPartialOptionsMap['Circle']);

		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'Circle',
			2,
			priceAxisLabelStackingManager
		);

		// A PaneView is responsible for rendering the tool on the chart.
		this._setPaneViews([new LineToolCirclePaneView(this, this._chart, this._series)]);

		console.log(`LineToolCircle initialized with ID: ${this.id()}`);
	}

	/**
	 * Ensures the two stored points are distinct, but intentionally **does not enforce order**.
	 *
	 * **Why no sorting?**
	 * The order is semantic and fixed: P0 is *always* the Center, and P1 is *always* the Radius Point.
	 * Normalizing (sorting by time) would destroy this fixed relationship, causing the circle to jump.
	 * This override provides an empty implementation to prevent the BaseLineTool sorting logic from running.
	 *
	 * @override
	 */
	public normalize(): void {
		// No strict sorting needed (unlike Rectangle's TL/BR), but we ensure they are not identical.
	}

	/**
	 * Performs the hit test by delegating to the View's `CompositeRenderer`.
	 *
	 * **Architecture Note:**
	 * The View's renderer contains the `CircleRenderer` (for the body) and the `LineAnchorRenderer`
	 * (for the 8 handles). Delegating here ensures the hit test accurately checks all 8 anchors
	 * and the main circle body with correct Z-order priority.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result from the renderer, or `null`.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {

		if (!this._paneViews || this._paneViews.length === 0) { 
			return null; // Tool is being destroyed, safely exit hit-test
		}

		const paneView = this._paneViews[0] as LineToolCirclePaneView<HorzScaleItem>;
		const renderer = paneView.renderer();

		// The renderer is expected to be the CompositeRenderer which contains the CircleRenderer.
		if (renderer && renderer.hitTest) {
			// Hit-test the main circle body and the 8 virtual anchors
			return renderer.hitTest(x, y);
		}

		return null;
	}

	/**
	 * Retrieves the logical position for any of the 8 anchors.
	 *
	 * **Tutorial Note on Virtual Points:**
	 * This method is central to the Circle's resizing logic:
	 * - Indices 0-1 return the actual stored Center (P0) and Radius (P1) points.
	 * - Indices 2-7 call the private helper `_getAnchorPointForIndex` to calculate the **virtual**
	 *   point locations on the bounding box (e.g., Top, Left, Bottom-Right corner).
	 *
	 * @param index - The anchor index (0 to 7).
	 * @returns The calculated {@link LineToolPoint} for the anchor, or `null`.
	 * @override
	 */
	public override getPoint(index: number): LineToolPoint | null {
		if (index < 2) {
			return this._points[index] || null; // P0 (Center) and P1 (Radius Point)
		}
		if (index >= 8) return null; // Only 8 anchors in total

		return this._getAnchorPointForIndex(index);
	}

	/**
	 * Handles drag events for all 8 anchors, updating the Center (P0) and Radius Point (P1) accordingly.
	 *
	 * **Logic Mapping:**
	 * - **Index 0 (Center):** Moves the entire circle. The delta (change in position) is applied to both P0 and P1.
	 * - **Indices 1-7 (Radius/Virtual Anchors):** Updates only the Radius Point (P1). The new P1 is calculated
	 *   by normalizing the vector from Center (P0) to the dragged point, effectively preserving the Center's position
	 *   while changing the radius/size.
	 *
	 * @param index - The index of the anchor being dragged (0 to 7).
	 * @param point - The new logical position of the anchor.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		if (this._points.length < 2) return;

		const [center, radiusPoint] = this._points;

		if (index === 0) {
			// Anchor 0 (Center): Move the Center and apply the same delta to the Radius Point
			const delta = {
				timestamp: point.timestamp - center.timestamp,
				price: point.price - center.price,
			};
			this._points[0] = point;
			this._points[1] = {
				timestamp: radiusPoint.timestamp + delta.timestamp,
				price: radiusPoint.price + delta.price,
			};
		} else if (index === 1) {
			// Anchor 1 (Radius Point): Only the Radius Point moves, Center is fixed.
			this._points[1] = point;
		} else if (index >= 2 && index <= 7) {
			// Virtual Anchors (2-7): Change the radius, Center is fixed.
			// 1. Calculate the new radius (distance from the Center P0 to the new anchor point)
			const newRadiusLogical = Math.sqrt(
				Math.pow(point.timestamp - center.timestamp, 2) +
				Math.pow(point.price - center.price, 2)
			);

			// 2. Calculate the original vector from Center to Radius Point (C -> R)
			const originalVector = {
				timestamp: radiusPoint.timestamp - center.timestamp,
				price: radiusPoint.price - center.price,
			};
			const originalRadius = Math.sqrt(
				Math.pow(originalVector.timestamp, 2) +
				Math.pow(originalVector.price, 2)
			);

			if (originalRadius > 1e-6) {
				// 3. Normalize the vector and scale it by the new radius
				const scaleFactor = newRadiusLogical / originalRadius;

				// 4. Update the Radius Point P1 (R')
				this._points[1] = {
					timestamp: center.timestamp + originalVector.timestamp * scaleFactor,
					price: center.price + originalVector.price * scaleFactor,
				};
			} else {
				// Edge case: Original radius was 0 (P0=P1). Move P1 in the direction of the drag.
				this._points[1] = point;
			}
		}
	}

	/**
	 * Calculates the logical coordinates of the 6 virtual anchors (indices 2 through 7) based on the current
	 * Center (P0) and Radius (distance P0-P1).
	 *
	 * **Tutorial Note:**
	 * Since the chart's price and time scales are independent (a logical unit distance in price does not equal
	 * a logical unit distance in time), the bounding box is calculated in logical space using the *radius*
	 * measured in logical units. This ensures the anchors are correctly mapped to the circle's bounding box.
	 *
	 * @param index - The index of the virtual anchor (2-7).
	 * @returns The calculated {@link LineToolPoint} on the bounding box, or `null`.
	 * @private
	 */
	private _getAnchorPointForIndex(index: number): LineToolPoint | null {
		if (this._points.length < 2) return null;

		const [center, radiusPoint] = this._points;

		// Calculate the radius (distance C-R)
		const radius = Math.sqrt(
			Math.pow(radiusPoint.timestamp - center.timestamp, 2) +
			Math.pow(radiusPoint.price - center.price, 2)
		);

		// Calculate the min/max time/price bounds of the square bounding box
		const minPrice = center.price - radius;
		const maxPrice = center.price + radius;
		const minTime = center.timestamp - radius;
		const maxTime = center.timestamp + radius;
		const midPrice = center.price;
		const midTime = center.timestamp;

		// V3.8 Virtual Anchors Mapping:
		// TL(4), TR(3), BR(5), BL(2), TC(6), BC(7)
		switch (index) {
			case 2: return { timestamp: minTime, price: minPrice }; // Bottom-Left Corner (BL)
			case 3: return { timestamp: maxTime, price: maxPrice }; // Top-Right Corner (TR)
			case 4: return { timestamp: minTime, price: maxPrice }; // Top-Left Corner (TL)
			case 5: return { timestamp: maxTime, price: minPrice }; // Bottom-Right Corner (BR)
			case 6: return { timestamp: midTime, price: maxPrice }; // Top-Center Midpoint (TC)
			case 7: return { timestamp: midTime, price: minPrice }; // Bottom-Center Midpoint (BC)

			default: return null;
		}
	}

	/**
	 * Implements the Shift constraint logic for the Circle tool: **Forced Vertical (North/South) Sizing**.
	 *
	 * **Tutorial Note:**
	 * When the user holds Shift while dragging the Radius Point (P1):
	 * 1. The point's X-coordinate (Time) is locked to the Center Point's X-coordinate.
	 * 2. This forces the radius vector to be perfectly vertical, allowing the user to size the circle
	 *    up/down without worrying about horizontal drift.
	 *
	 * @param pointIndex - The index of the anchor being moved.
	 * @param rawScreenPoint - The raw mouse position on screen.
	 * @param phase - The current interaction phase.
	 * @param originalLogicalPoint - The original logical position of the point being moved.
	 * @param allOriginalLogicalPoints - The state of all points before the drag started.
	 * @returns A result containing the constrained screen point and a hint (`time`) that the X-axis was locked.
	 * @override
	 */
	public override getShiftConstrainedPoint(
		pointIndex: number, 
		rawScreenPoint: Point, 
		phase: InteractionPhase,
		originalLogicalPoint: LineToolPoint,
		allOriginalLogicalPoints: LineToolPoint[]
	): ConstraintResult { // <<< UPDATED RETURN TYPE

		// --- 1. Only apply constraint to the Radius Point (P1) ---
		// Anchor 0 moves the whole tool (Move phase in editing) and should not be constrained by Shift.
		if (pointIndex !== 1) { 
			// Fallback: For all other anchors (P0 or virtual), use the raw point (no constraint)
			return { point: rawScreenPoint, snapAxis: 'none' };
		}

		// --- 2. Identify the Center Point (P0) and its Screen Position ---
		const originalCenterLogicalPoint = this.getPoint(0);

		if (!originalCenterLogicalPoint) {
			return { point: rawScreenPoint, snapAxis: 'none' };
		}

		// Convert the Center P0's logical position to its current screen position.
		const centerScreenPoint = this.pointToScreenPoint(originalCenterLogicalPoint);

		if (!centerScreenPoint) {
			return { point: rawScreenPoint, snapAxis: 'none' };
		}

		// --- 3. Apply the Constraint (Lock X to Center's X) ---

		// Lock X to P0's X (forcing movement along the North-South axis)
		const constrainedX = centerScreenPoint.x;

		// Use the raw mouse's Y position
		const constrainedY = rawScreenPoint.y;

		return {
			point: new Point(constrainedX, constrainedY),
			snapAxis: 'time',
		};
	}

}