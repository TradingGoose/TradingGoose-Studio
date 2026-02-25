// /lightweight-charts-line-tools-fib-retracement/src/model/LineToolFibRetracement.ts

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
	FibRetracementLevel,
	FibRetracementTradeStrategy,
	HitTestResult,
	Point,
	InteractionPhase,
	ConstraintResult,
	SnapAxis,
} from '../../core';

import { LineToolFibRetracementPaneView } from '../views/LineToolFibRetracementPaneView';

/**
 * Defines the default configuration for the Fibonacci Retracement tool.
 *
 * **Tutorial Note:**
 * This tool is structurally complex because it generates many visual elements from just two points.
 * These defaults include:
 * 1. **Levels:** An array of coefficients (0, 0.236, 0.382, etc.) with their associated colors and opacities.
 * 2. **Extension:** Configuration to extend all level lines infinitely to the left or right.
 * 3. **Trade Strategy:** A placeholder structure for advanced trading setups (Entry/Stop/Target) linked to Fib levels.
 *
 * Reusing these defaults ensures that any new Fib tool starts with the standard industry levels.
 */
export const FibRetracementOptionDefaults: LineToolOptionsInternal<'FibRetracement'> = {
	visible: true,
	editable: true,
	showPriceAxisLabels: true,
	showTimeAxisLabels: true,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,

	line: {
		width: 1,
		style: LineStyle.Solid,
	},
	// Global Extension - sets extension for all lines
	extend: { left: false, right: false },

	levels: [
		{ color: "#787b86", coeff: 0, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#f23645", coeff: 0.236, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#81c784", coeff: 0.382, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#4caf50", coeff: 0.5, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#089981", coeff: 0.618, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#64b5f6", coeff: 0.786, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#787b86", coeff: 1, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#ffbb00", coeff: 1.618, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#f23645", coeff: 2.618, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#9c27b0", coeff: 3.618, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
		{ color: "#e91e63", coeff: 4.236, opacity: 0, distanceFromCoeffEnabled: false, distanceFromCoeff: 0 },
	],
	tradeStrategy: {
		enabled: false,
		longOrShort: "",
		fibBracketOrders: [
			{
				uniqueId: null, conditionLevelCoeff: null, conditionLevelPrice: 0, entryLevelCoeff: null, entryLevelPrice: 0,
				stopMethod: "fib", stopLevelCoeff: null, stopPriceInput: null, stopPointsInput: null, finalStopPrice: 0,
				ptMethod: "fib", ptLevelCoeff: null, ptPriceInput: null, ptPointsInput: null, finalPtPrice: 0,
				isMoveStopToEnabled: false, moveStopToMethod: "fib", moveStopToLevelCoeff: null, moveStopToPriceInput: null,
				moveStopToPointsInput: null, finalMoveStopToPrice: 0, triggerBracketUniqueId: null
			}
		]
	} as FibRetracementTradeStrategy,
};

/**
 * Concrete implementation of the Fibonacci Retracement drawing tool.
 *
 * **What is a Fibonacci Retracement?**
 * It is a tool used to identify potential support and resistance levels. It is defined by
 * a "Trend Line" connecting two extreme points (usually a high and a low).
 *
 * **Logic Overview:**
 * The tool calculates the vertical distance between P0 and P1 and then draws horizontal
 * lines at specific percentages (coefficients) of that distance.
 *
 * **Inheritance:**
 * It extends `BaseLineTool` directly. While it shares the 2-point requirement of a Trend Line,
 * its rendering and culling logic are entirely unique, necessitating a distinct model and view.
 */
export class LineToolFibRetracement<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('FibRetracement').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'FibRetracement';

	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Fib Retracement requires exactly **2 points** to define the range.
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 2;

	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * Since the tool is defined by 2 points, the valid handles are at index 0 and 1.
	 *
	 * @override
	 * @returns `1`
	 */
	public maxAnchorIndex(): number {
		return 1; // Only 2 anchors: P0 and P1
	}

	/**
	 * Confirms that this tool can be created via discrete mouse clicks.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickClickCreation(): boolean { return true; }

	/**
	 * Confirms that this tool can be created via a click-and-drag gesture.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickDragCreation(): boolean { return true; }

	/**
	 * Enables geometric constraints (Shift key) during click-based creation.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickClickConstraint(): boolean { return true; }

	/**
	 * Enables geometric constraints (Shift key) during drag-based creation or editing.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickDragConstraint(): boolean { return true; }

	/**
	 * Initializes the Fibonacci Retracement tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Deep Copy:** It performs a `deepCopy` of the `FibRetracementOptionDefaults` to ensure
	 *    this tool instance has its own unique levels array that won't affect other instances.
	 * 2. **Merge:** It merges the user's `options` to allow custom level colors or visibility.
	 * 3. **View:** It assigns the `LineToolFibRetracementPaneView`, which handles the heavy lifting
	 *    of iterating through levels and drawing lines and fills.
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
		options: DeepPartial<LineToolOptionsInternal<'FibRetracement'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = buildToolOptions(FibRetracementOptionDefaults, options);

		// 3. Call the BaseLineTool constructor.
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'FibRetracement',
			2,
			priceAxisLabelStackingManager
		);

		// 4. Set the PaneView.
		this._setPaneViews([new LineToolFibRetracementPaneView(this, this._chart, this._series)]);
	}

	/**
	 * Calculates the exact logical coordinates (Time and Price) for every configured Fibonacci level.
	 *
	 * **Tutorial Note on the Math:**
	 * 1. It calculates the vertical range (Price Difference) between the two defining points (P0 and P1).
	 * 2. For each coefficient (e.g., 0.618), it calculates the resulting price: `Price = P1 - (Range * Coefficient)`.
	 * 3. It generates two logical points per level, spanning horizontally between the min/max time of the anchors.
	 *
	 * This method serves as the "Calculated Data Source" for both the rendering logic and the culling engine.
	 *
	 * @returns An array of level data, including the start/end logical points, the raw price, and the coefficient.
	 */
	public getLineSegmentPoints(): { start: LineToolPoint, end: LineToolPoint, price: number, coeff: number }[] {
		const points = this.points();
		if (points.length < 2) return [];

		const [p0, p1] = points;
		const options = this.options();

		const priceDiff = p1.price - p0.price;

		const tMin = Math.min(p0.timestamp, p1.timestamp);
		const tMax = Math.max(p0.timestamp, p1.timestamp);

		const segmentPoints: { start: LineToolPoint, end: LineToolPoint, price: number, coeff: number }[] = [];

		for (const level of options.levels) {
			// Calculate high-precision price
			const rawPrice = p1.price - (priceDiff * level.coeff);

			// FIX: Use rawPrice directly. 
			// 1. It handles negative numbers correctly.
			// 2. The PaneView will handle rounding for the text label display.
			// 3. The Chart handles floats for coordinate positioning perfectly.
			const price = rawPrice;

			const startPoint: LineToolPoint = { timestamp: tMin, price: price };
			const endPoint: LineToolPoint = { timestamp: tMax, price: price };

			segmentPoints.push({
				start: startPoint,
				end: endPoint,
				price: price,
				coeff: level.coeff,
			});
		}

		return segmentPoints;
	}

	/**
	 * Flattens all calculated Fibonacci levels into a single array of logical points for the culling engine.
	 *
	 * **Why is this needed?**
	 * The culling engine requires a flat list of points to perform its geometric intersection tests. 
	 * Since a Fib Retracement isn't just one line but a collection of many, this helper ensures 
	 * every level is accounted for when determining if the tool should be rendered.
	 *
	 * @returns A flat array of `LineToolPoint` objects representing every level.
	 */
	public getAllLogicalPointsForCulling(): LineToolPoint[] {
		const segments = this.getLineSegmentPoints();
		const allLogicalPoints: LineToolPoint[] = [];

		// The culler needs a single array of points to index into.
		for (const segment of segments) {
			allLogicalPoints.push(segment.start);
			allLogicalPoints.push(segment.end);
		}

		return allLogicalPoints;
	}


	/**
	 * Intentionally empty override to prevent automatic point sorting.
	 *
	 * **Tutorial Note:**
	 * In many tools, sorting points by time (Left-to-Right) is helpful. However, in a Fibonacci 
	 * Retracement, the **direction** of the draw (High-to-Low vs. Low-to-High) defines whether 
	 * the tool measures a "Retracement" or an "Extension". 
	 * 
	 * By disabling normalization, we preserve the user's intended directionality.
	 *
	 * @override
	 */
	public normalize(): void {
		// Do not normalize. Direction is important for user intent.
	}

	/**
	 * Implements a horizontal lock (Price Lock) constraint when the Shift key is held during editing.
	 *
	 * **Logic Details:**
	 * When dragging an anchor point while holding Shift, the tool locks the movement to the 
	 * anchor's **original Price level**. This allows the user to slide the Fibonacci tool 
	 * left or right across the timeline to align with different bars without accidentally 
	 * shifting the vertical price range.
	 *
	 * @param pointIndex - The index of the anchor being dragged.
	 * @param rawScreenPoint - The current mouse position.
	 * @param phase - The interaction phase (Creation or Editing).
	 * @param originalLogicalPoint - The snapshot of the point's logical state before the drag began.
	 * @param allOriginalLogicalPoints - The full state of all points before the drag began.
	 * @returns The constrained result locking the Y-axis to the original price.
	 * @override
	 */
	public override getShiftConstrainedPoint(
		pointIndex: number,
		rawScreenPoint: Point,
		phase: InteractionPhase,
		originalLogicalPoint: LineToolPoint,
		allOriginalLogicalPoints: LineToolPoint[]
	): ConstraintResult {
		// We need to determine which Logical Point determines the Y-level.
		let referenceLogicalPoint: LineToolPoint | null = null;

		if (phase === InteractionPhase.Creation) {
			// CREATION Behavior:
			// if creating do not constrain to anything
		} else {
			// EDITING Behavior (User Request):
			// When editing P0 or P1, holding shift should lock it to its ORIGINAL price.
			// This allows sliding the point left/right without changing the price level.
			// 'originalLogicalPoint' IS the snapshot of the point being dragged.
			referenceLogicalPoint = originalLogicalPoint;
		}

		if (!referenceLogicalPoint) {
			return { point: rawScreenPoint, snapAxis: 'none' };
		}

		// Convert the reference logical price to a screen Y coordinate
		const referenceScreenPoint = this.pointToScreenPoint(referenceLogicalPoint);

		if (!referenceScreenPoint) {
			return { point: rawScreenPoint, snapAxis: 'none' };
		}

		// Lock Y to the reference, keep X from the mouse
		return {
			point: new Point(rawScreenPoint.x, referenceScreenPoint.y),
			snapAxis: 'price',
		};
	}

	/**
	 * Performs a hit test for the Fibonacci tool by delegating to its associated Pane View.
	 *
	 * **Architecture Note:**
	 * Because this tool renders many independent segments (lines) and areas (fills), 
	 * the logic for "What did the user click?" is most accurately handled by the View's 
	 * `CompositeRenderer`. 
	 * 
	 * Calling `renderer()` on the view ensures the visual state is up-to-date before the 
	 * hit-test is performed.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over any line, fill, or handle, otherwise `null`.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		const paneView = this._paneViews[0] as LineToolFibRetracementPaneView<HorzScaleItem>;
		paneView.renderer(); // Ensure the view is updated

		const compositeRenderer = paneView.renderer() as any;

		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		return compositeRenderer.hitTest(x, y);
	}
}
