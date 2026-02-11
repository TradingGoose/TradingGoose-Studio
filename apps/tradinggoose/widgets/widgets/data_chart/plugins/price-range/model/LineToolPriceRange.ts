// lightweight-charts-line-tools-price-range/src/model/LineToolPriceRange.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	SeriesType,
	LineStyle,
	Coordinate,
	Time,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPoint,
	LineToolType,
	LineToolOptionsInternal,
	Point,
	buildToolOptions,
	DeepPartial,
	LineToolsCorePlugin,
	PriceAxisLabelStackingManager,
	LineEnd,
	TextAlignment,
	BoxVerticalAlignment,
	BoxHorizontalAlignment,
	TextOptions,
	PaneCursorType,
	InteractionPhase,
	ConstraintResult,
	HitTestResult,
	CompositeRenderer,
	interpolateLogicalIndexFromTime,
	interpolateTimeFromLogicalIndex,
} from '../../core';

import { LineToolPriceRangePaneView } from '../views/LineToolPriceRangePaneView';

/**
 * Defines the default configuration options for the Price Range tool.
 *
 * **Tutorial Note:**
 * This tool is visually complex, composed of multiple parts:
 * 1. **Rectangle:** The main body (`priceRange.rectangle`), usually semi-transparent.
 * 2. **Center Lines:** Optional Horizontal/Vertical lines (`priceRange.horizontalLine`, `verticalLine`) to mark the midpoint.
 * 3. **Labels:** A dynamic price difference label calculated in the view, plus an optional user text box.
 *
 * The defaults configure the specific styling (colors, dashed lines) for all these sub-components.
 */
export const PriceRangeOptionDefaults: LineToolOptionsInternal<'PriceRange'> = {
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

	// --- 1. Top-level 'text' property (common to Rectangle/TrendLine pattern) ---
	text: {
		value: '', // Default value
		padding: 0,
		wordWrapWidth: 0,
		forceTextAlign: false,
		forceCalculateMaxLineWidth: false,
		alignment: TextAlignment.Center,

		font: {
			color: 'rgba(255, 255, 255, 1)',
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
			maxHeight: 0, // Placeholder
			shadow: { blur: 0, color: 'transparent', offset: { x: 0, y: 0 } },
			border: { color: 'transparent', width: 0, radius: 0, highlight: false, style: LineStyle.Solid },
			background: { color: 'transparent', inflation: { x: 0, y: 0 } },
		},
	} as TextOptions, // Casting is fine here

	// --- 2. Required NESTING: Top-level 'priceRange' property holding the structural options ---
	priceRange: { // <--- THIS IS THE MISSING PROPERTY
		rectangle: {
			extend: { left: false, right: false },
			background: { color: 'rgba(156,39,176,0.2)' },
			border: { width: 1, style: LineStyle.Solid, color: '#9c27b0', radius: 0 },
		},

		verticalLine: {
			width: 1,
			color: '#9c27b0',
			style: LineStyle.Solid,
			end: { left: LineEnd.Normal, right: LineEnd.Normal },
			extend: { left: false, right: false },
		},

		horizontalLine: {
			width: 1,
			color: '#9c27b0',
			style: LineStyle.Dashed,
			end: { left: LineEnd.Normal, right: LineEnd.Normal },
			extend: { left: false, right: false },
		},

		showCenterHorizontalLine: true,
		showCenterVerticalLine: true,
		showTopPrice: true,
		showBottomPrice: true,
	}
};


/**
 * Concrete implementation of the Price Range drawing tool.
 *
 * **What is a Price Range Tool?**
 * It is defined by **2 points** (P0, P1) forming a rectangle.
 * Unlike a simple Rectangle tool, this tool is specialized to calculate and display
 * the vertical price difference (absolute and/or percentage) between the two points.
 *
 * **Complex Interaction:**
 * This class implements advanced resizing logic using **8 Anchors** (2 real, 6 virtual).
 * This allows the user to resize specific edges (e.g., "Top Edge only") or corners,
 * providing a standard drawing software experience.
 */
export class LineToolPriceRange<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('PriceRange').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'PriceRange';

	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Price Range is defined by exactly **2 points** (Start Corner and End Corner).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 2;

	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * The Price Range tool supports 8 distinct handles:
	 * - **0-1:** The actual corners (P0, P1).
	 * - **2-3:** The virtual corners (Top-Right / Bottom-Left).
	 * - **4-7:** The edge midpoints (Top, Bottom, Left, Right).
	 *
	 * Returning `7` ensures the Interaction Manager tracks drag events for all of them.
	 *
	 * @override
	 * @returns `7`
	 */
	public override maxAnchorIndex(): number {
		return 7; // 8 anchors total (corners and midpoints)
	}

	/**
	 * Initializes the Price Range tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** Uses `PriceRangeOptionDefaults` which includes the nested `priceRange` config.
	 * 2. **User Options:** Merges user provided settings.
	 * 3. **View:** Assigns `LineToolPriceRangePaneView`, which handles the rendering of the multi-part visual
	 *    (rectangle, crosshairs, dynamic labels).
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
		options: DeepPartial<LineToolOptionsInternal<'PriceRange'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = buildToolOptions(PriceRangeOptionDefaults, options);

		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'PriceRange',
			2,
			priceAxisLabelStackingManager
		);

		this._setPaneViews([new LineToolPriceRangePaneView(this, this._chart, this._series)]);
	}


	/**
	 * Confirms that this tool can be created via the "Click-Click" method.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickClickCreation(): boolean {
		return true; // Rectangle supports click-click creation
	}

	/**
	 * Confirms that this tool can be created via the "Click-Drag" method.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickDragCreation(): boolean {
		return true; // Rectangle supports click-drag creation
	}

	/**
	 * Enables geometric constraints (Shift key) during "Click-Click" creation.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickClickConstraint(): boolean {
		return true; // Rectangle supports Shift constraint during click-click creation
	}

	/**
	 * Enables geometric constraints (Shift key) during "Click-Drag" creation.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickDragConstraint(): boolean {
		return true; // Rectangle supports Shift constraint during click-drag creation
	}


	/**
	 * Handles complex resize logic for the 8 specific anchor points.
	 *
	 * **Tutorial Note on Virtual Anchors:**
	 * When a user drags a virtual anchor (like the "Top Edge"), we don't just move a point.
	 * We act as if the user is resizing the bounding box in a specific direction.
	 *
	 * - **Indices 0-1:** Standard update of P0/P1.
	 * - **Indices 2-3 (Virtual Corners):** We update a mix of P0 and P1 coordinates (e.g., drag TR updates P0.y and P1.x).
	 * - **Indices 4-7 (Edges):** We constrain the update to a single axis (e.g., drag Top Edge only updates P0.y).
	 *
	 * @param index - The index of the anchor being dragged (0-7).
	 * @param point - The new logical position.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		// If primary points (0 or 1) are being set, use the base implementation.
		if (index < 2) {
			super.setPoint(index, point);
			return;
		}

		// Handle movement of the 6 virtual anchors (2-7).
		// We avoid complex geometric checks and allow the points to cross over,
		// relying on the normalize() function to resolve the geometric stability later.
		const P0 = this._points[0];
		const P1 = this._points[1];

		switch (index) {
			// --- Corner Anchors (Invert freely) ---

			case 2: // Bottom-Left (BL): P0 time/P1 price
				P0.timestamp = point.timestamp;
				P1.price = point.price;
				break;

			case 3: // Top-Right (TR): P0 price/P1 time
				P0.price = point.price;
				P1.timestamp = point.timestamp;
				break;

			// --- Side Anchors (Single-Axis Movement) ---

			case 4: // Middle-Left (ML): Only changes P0's time component (horizontal resize)
				P0.timestamp = point.timestamp;
				break;

			case 5: // Middle-Right (MR): Only changes P1's time component (horizontal resize)
				P1.timestamp = point.timestamp;
				break;

			case 6: // Top-Center (TC): Only changes P0's price component (vertical resize)
				P0.price = point.price;
				break;

			case 7: // Bottom-Center (BC): Only changes P1's price component (vertical resize)
				P1.price = point.price;
				break;
		}

		this._triggerChartUpdate();
	}

	/**
	 * Calculates the logical position for any of the 8 anchors.
	 *
	 * **Logic:**
	 * - **0-1:** Returns the stored points P0, P1.
	 * - **2-3:** Returns synthesized corners (e.g., { P0.x, P1.y }).
	 * - **4-7:** Returns synthesized edge midpoints (e.g., Average(P0.x, P1.x), P0.y).
	 *
	 * This allows the `LineAnchorRenderer` to draw handles at locations that don't technically exist
	 * in the `_points` array.
	 *
	 * @param index - The anchor index.
	 * @returns The calculated {@link LineToolPoint}, or `null`.
	 * @override
	 */
	public override getPoint(index: number): LineToolPoint | null {
		if (this._points.length < 2) {
			return super.getPoint(index);
		}

		const P0 = this._points[0]; // Start
		const P1 = this._points[1]; // End
		
		// Calculate purely mathematical midpoint
		const midPrice = (P0.price + P1.price) / 2;
		
		// ERROR FIX: Remove 'as Time'. Keep it as a number.
		// We use Math.round to ensure the timestamp remains an integer (if required by your specific scale configuration)
		// but raw division is usually accepted by the type definition.
		const midTime = (P0.timestamp + P1.timestamp) / 2;

		switch (index) {
			// Primary Anchors
			case 0: return P0; // Start
			case 1: return P1; // End

			// Corner Anchors (Topology: X from one, Y from the other)
			case 2: return { price: P1.price, timestamp: P0.timestamp }; // P0 Time, P1 Price
			case 3: return { price: P0.price, timestamp: P1.timestamp }; // P1 Time, P0 Price

			// Side Anchors (Topology: One fixed axis, one Midpoint)
			case 4: return { price: midPrice, timestamp: P0.timestamp }; // Left/Right (P0 Time)
			case 5: return { price: midPrice, timestamp: P1.timestamp }; // Left/Right (P1 Time)
			case 6: return { price: P0.price, timestamp: midTime };      // Top/Bottom (P0 Price)
			case 7: return { price: P1.price, timestamp: midTime };      // Top/Bottom (P1 Price)
			
			default: return null;
		}
	}	

	/**
	 * Intentionally empty override.
	 *
	 * **Why?**
	 * The Price Range tool relies on the specific relationship between P0 and P1 to determine direction (Up/Down).
	 * Normalizing (sorting by time/price) could flip P0 and P1, inverting the calculated "direction"
	 * (Positive/Negative price change) and confusing the anchor drag logic implemented in `setPoint`.
	 *
	 * @override
	 */
	public normalize(): void {

	}	

	/**
	 * Implements granular Shift constraint logic for the 8 different anchor types.
	 *
	 * **Tutorial Note:**
	 * The behavior of "Shift" depends on *what* you are dragging:
	 * 1. **Creation:** Standard lock (Force Horizontal/Vertical relative to start).
	 * 2. **Edge Anchors (4-7):** Already locked to one axis by definition, so Shift might force a specific coordinate alignment.
	 * 3. **Corner Anchors (0-3):** Compares the delta X vs delta Y from the *opposing* corner.
	 *    - If dragging more Horizontal, lock Price (Horizontal Line).
	 *    - If dragging more Vertical, lock Time (Vertical Line).
	 *
	 * @param pointIndex - The anchor index.
	 * @param rawScreenPoint - Mouse position.
	 * @param phase - Creation or Editing.
	 * @param originalLogicalPoint - Starting position of the drag.
	 * @param allOriginalLogicalPoints - Snapshot of all points.
	 * @returns The constrained result.
	 * @override
	 */
	public override getShiftConstrainedPoint(
		pointIndex: number,
		rawScreenPoint: Point,
		phase: InteractionPhase,
		originalLogicalPoint: LineToolPoint,
		allOriginalLogicalPoints: LineToolPoint[]
	): ConstraintResult {
		// 1. Get the screen coordinate of the anchor being dragged BEFORE it moved.
		const originalScreenPoint = this.pointToScreenPoint(originalLogicalPoint);

		if (!originalScreenPoint) {
			return { point: rawScreenPoint, snapAxis: 'none' };
		}

		// --- Creation Phase ---
		if (phase === InteractionPhase.Creation) {
			// Standard: Lock to produce a straight horizontal line
			const P0_logical = allOriginalLogicalPoints[0];
			const P0_screen = this.pointToScreenPoint(P0_logical)!;

			return {
				point: new Point(rawScreenPoint.x, P0_screen.y),
				snapAxis: 'price', 
			};
		}

		// --- Editing Phase ---
		
		// 1. Side Resizers (4, 5, 6, 7)
		// These should effectively ignore Shift (or always apply it), 
		// because a side anchor only has one degree of freedom anyway.
		if (pointIndex === 4 || pointIndex === 5) { // Vertical Lines (Move Horizontal)
			return {
				point: new Point(rawScreenPoint.x, originalScreenPoint.y),
				snapAxis: 'price', // Snap Price (Keep Y constant)
			};
		}
		if (pointIndex === 6 || pointIndex === 7) { // Horizontal Lines (Move Vertical)
			return {
				point: new Point(originalScreenPoint.x, rawScreenPoint.y),
				snapAxis: 'time', // Snap Time (Keep X constant)
			};
		}

		// 2. Corner Resizers (0, 1, 2, 3)
		// When holding Shift on a corner, usually we want to lock to EITHER vertical OR horizontal
		// relative to the opposing anchor.
		
		// Find the opposing anchor index to determine the pivot point
		// 0(Start) <-> 1(End)
		// 2(P0x,P1y) <-> 3(P1x,P0y)
		let opposingIndex = -1;
		if (pointIndex === 0) opposingIndex = 1;
		else if (pointIndex === 1) opposingIndex = 0;
		else if (pointIndex === 2) opposingIndex = 3;
		else if (pointIndex === 3) opposingIndex = 2;

		const opposingLogical = allOriginalLogicalPoints[opposingIndex];
		const opposingScreen = this.pointToScreenPoint(opposingLogical);

		if (opposingScreen) {
			// Calculate delta from the pivot (opposing corner)
			const dx = Math.abs(rawScreenPoint.x - opposingScreen.x);
			const dy = Math.abs(rawScreenPoint.y - opposingScreen.y);

			// If X delta is bigger, lock Y (Horizontal Move). If Y delta bigger, lock X (Vertical Move).
			if (dx > dy) {
				return {
					point: new Point(rawScreenPoint.x, originalScreenPoint.y),
					snapAxis: 'price',
				};
			} else {
				return {
					point: new Point(originalScreenPoint.x, rawScreenPoint.y),
					snapAxis: 'time',
				};
			}
		}

		// Fallback: Just lock Y if we can't calculate opposing (matches previous logic)
		return {
			point: new Point(rawScreenPoint.x, originalScreenPoint.y),
			snapAxis: 'price',
		};
	}
	
	/**
	 * Performs the hit test for the Price Range tool.
	 *
	 * **Architecture Note:**
	 * Delegates to the `LineToolPriceRangePaneView`. The view uses a `CompositeRenderer` containing:
	 * 1. `RectangleRenderer` (Body/Borders).
	 * 2. `SegmentRenderer` (Center lines).
	 * 3. `TextRenderer` (Labels).
	 *
	 * Delegating ensures that hitting *any* of these visual components registers as selecting the tool.
	 *
	 * @param x - X coordinate.
	 * @param y - Y coordinate.
	 * @returns A hit result, or `null`.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		if (!this._paneViews || this._paneViews.length === 0) {
			return null;
		}

		const paneView = this._paneViews[0] as LineToolPriceRangePaneView<HorzScaleItem>;
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;

		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		// The Pane View's renderer is a CompositeRenderer, which delegates the hit-test
		return compositeRenderer.hitTest(x, y);
	}
}
