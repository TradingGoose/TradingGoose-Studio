// /lightweight-charts-line-tools-long-short-position/src/model/LineToolLongShortPosition.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	LineStyle,
	SeriesType,
	Coordinate,
} from 'lightweight-charts';
import {
	BaseLineTool,
	LineToolPoint,
	LineToolType,
	LineToolOptionsInternal,
	TextOptions,
	merge,
	DeepPartial,
	LineToolPartialOptionsMap,
	TextAlignment,
	BoxVerticalAlignment,
	BoxHorizontalAlignment,
	PaneCursorType,
	LineToolsCorePlugin,
	deepCopy,
	PriceAxisLabelStackingManager,
	ensureNotNull,
	HitTestResult,
	CompositeRenderer,
	Point,
	InteractionPhase,
	ConstraintResult
} from '../../core';
import { LineToolLongShortPositionPaneView } from '../views/LineToolLongShortPositionPaneView';

/**
 * Defines the default configuration options for the Long/Short Position tool.
 *
 * **Tutorial Note:**
 * This tool is visually composed of two distinct zones:
 * 1. **Risk Zone (Stop Loss):** Red rectangle (`entryStopLossRectangle`) + Text.
 * 2. **Reward Zone (Profit Target):** Green rectangle (`entryPtRectangle`) + Text.
 *
 * The defaults configure these with standard trading colors (Red/Green) and enable
 * the "Auto Text" feature (`showAutoText: true`) which automatically calculates and displays
 * the Risk/Reward ratio and price levels.
 */
export const LongShortPositionOptionDefaults: LineToolOptionsInternal<'LongShortPosition'> = {
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

	showAutoText: true,
	entryStopLossRectangle: {
		background: { color: 'rgba(255, 0, 0, 0.2)' },
		border: { width: 1, style: LineStyle.Solid, color: 'red', radius: 0 },
		extend: { left: false, right: false },
	},
	entryPtRectangle: {
		background: { color: 'rgba(0, 128, 0, 0.2)' },
		border: { width: 1, style: LineStyle.Solid, color: 'green', radius: 0 },
		extend: { left: false, right: false },
	},
	entryStopLossText: {
		value: '',
		padding: 0,
		wordWrapWidth: 0,
		forceTextAlign: false,
		forceCalculateMaxLineWidth: false,
		alignment: TextAlignment.Left,
		font: {
			color: 'rgba(255, 255, 255, 1)',
			size: 12,
			bold: false,
			italic: false,
			family: 'sans-serif'
		},
		box: {
			alignment: { vertical: BoxVerticalAlignment.Middle, horizontal: BoxHorizontalAlignment.Center },
			angle: 0,
			scale: 1,
			offset: { x: 0, y: 0 },
			padding: { x: 0, y: 0 },
			maxHeight: 0,
			shadow: { blur: 0, color: 'rgba(0, 0, 0, 0)', offset: { x: 0, y: 0 } },
			border: { color: 'rgba(0, 0, 0, 0)', width: 0, radius: 0, highlight: false, style: LineStyle.Solid },
			background: { color: 'rgba(0, 0, 0, 0)', inflation: { x: 0, y: 0 } },
		},
	},
	entryPtText: {
		value: '',
		padding: 0,
		wordWrapWidth: 0,
		forceTextAlign: false,
		forceCalculateMaxLineWidth: false,
		alignment: TextAlignment.Left,
		font: {
			color: 'rgba(255, 255, 255, 1)',
			size: 12,
			bold: false,
			italic: false,
			family: 'sans-serif'
		},
		box: {
			alignment: { vertical: BoxVerticalAlignment.Middle, horizontal: BoxHorizontalAlignment.Center },
			angle: 0,
			scale: 1,
			offset: { x: 0, y: 0 },
			padding: { x: 0, y: 0 },
			maxHeight: 0,
			shadow: { blur: 0, color: 'rgba(0, 0, 0, 0)', offset: { x: 0, y: 0 } },
			border: { color: 'rgba(0, 0, 0, 0)', width: 0, radius: 0, highlight: false, style: LineStyle.Solid },
			background: { color: 'rgba(0, 0, 0, 0)', inflation: { x: 0, y: 0 } },
		},
	},
};

/**
 * Concrete implementation of the Long/Short Position drawing tool.
 *
 * **What is a Position Tool?**
 * It is a risk management tool defined by **3 logical points**:
 * 1. **Entry Price (P0):** The start of the trade.
 * 2. **Stop Loss (P1):** The invalidation point.
 * 3. **Profit Target (P2):** The target exit point.
 *
 * **Complex Logic:**
 * Unlike simple shapes, this tool has "Business Logic":
 * - It detects direction (Long if Stop < Entry, Short if Stop > Entry).
 * - It calculates Risk:Reward ratios.
 * - It handles "Flipping" (changing colors/direction when Entry crosses Stop).
 */
export class LineToolLongShortPosition<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('LongShortPosition').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'LongShortPosition';
	
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Position tool requires exactly **3 points** (Entry, Stop, Target). User defines 2 points on creation, the 3rd point
	 * which is the target is generated on creation and can be modified after creation
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 3; 

	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * We support 3 interactive handles:
	 * - **0:** Entry Price.
	 * - **1:** Stop Loss.
	 * - **2:** Profit Target.
	 *
	 * @override
	 * @returns `2`
	 */
	public override maxAnchorIndex(): number {
		return 2; 
	}

	private _clickCount: number = 0; 
	private _isLong: boolean | null = null; 
    private _flipModeActive: boolean = false;

	/**
	 * Confirms that this tool is created via the "Click-Click" method.
	 *
	 * **Interaction Flow:**
	 * 1. Click Entry.
	 * 2. Click Stop Loss.
	 * 3. (Auto) Profit Target is initially generated at 3R (3x Risk) automatically.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsClickClickCreation(): boolean { return true; }

	/**
	 * Indicates if the tool supports "Click-Drag" creation.
	 *
	 * We disable this (`false`) to enforce precision. Placing Entry and Stop Loss
	 * usually requires exact clicking rather than a sweeping drag motion.
	 *
	 * @override
	 * @returns `false`
	 */
	public supportsClickDragCreation(): boolean { return false; }

	/**
	 * Enables geometric constraints (Shift key) during creation.
	 *
	 * If `true`, holding Shift while placing points will apply the logic defined in
	 * {@link getShiftConstrainedPoint} (typically locking the price level to prevent drift).
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickClickConstraint(): boolean { return true; }

	/**
	 * Indicates if holding Shift should apply geometric constraints during drag creation.
	 *
	 * Not applicable as `supportsClickDragCreation` is false.
	 *
	 * @override
	 * @returns `false`
	 */
	public supportsShiftClickDragConstraint(): boolean { return false; }

	/**
	 * Initializes the Long/Short Position tool.
	 *
	 * **Tutorial Note on Logic:**
	 * 1. **Defaults:** Merges defaults with user options.
	 * 2. **Legacy Handling:** Checks if `points` contains only 2 points (Entry/Stop). If so,
	 *    it auto-calculates and pushes a 3rd point (Profit Target) to ensure the tool is valid.
	 * 3. **Direction Inference:** Determines if the tool is "Long" or "Short" based on P0 vs P1.
	 * 4. **View:** Assigns `LineToolLongShortPositionPaneView` for complex multi-rect rendering.
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
		options: DeepPartial<LineToolOptionsInternal<'LongShortPosition'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = deepCopy(LongShortPositionOptionDefaults) as LineToolOptionsInternal<'LongShortPosition'>;
		merge(finalOptions, options as LineToolPartialOptionsMap['LongShortPosition']);

		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'LongShortPosition',
			3, // FIX: Pass 3 to super
			priceAxisLabelStackingManager
		);

		// Properly initialize state flags when loading existing/saved tools.
		if (this._points.length >= 2) {
			this._clickCount = 2;

			// legacy/partial data (missing PT)
			// If we have Entry & Stop but no PT, generate the default 3R PT immediately.
			if (this._points.length < 3) {
				const p0 = this._points[0];
				const p1 = this._points[1];
				// We can safely call this because p0 and p1 exist
				const p2 = this.calculateProfitTarget(p0, p1, p1.timestamp);
				this._points.push(p2);
			}

			const entryPrice = this._points[0].price;
			const stopPrice = this._points[1].price;

			if (entryPrice === stopPrice) {
				// Edge Case: Zero Risk (collapsed tool).
				// Attempt to infer direction from Profit Target (P2) if it exists.
				if (this._points.length >= 3) {
					const ptPrice = this._points[2].price;
					// If PT is below Entry, it implies a Short position. Otherwise, default to Long.
					this._isLong = ptPrice < entryPrice ? false : true;
				} else {
					// Fallback: Default to Long if no PT context is available
					this._isLong = true;
				}
			} else {
				// Standard Case: Direction derived strictly from Entry vs Stop
				this._isLong = entryPrice > stopPrice;
			}
		}

		this._setPaneViews([new LineToolLongShortPositionPaneView(this, this._chart, this._series)]);
	}

	/**
	 * Determines the current direction of the trade based on the geometry.
	 *
	 * @returns `true` if Entry Price > Stop Price (Long), `false` otherwise (Short).
	 */
	public isCurrentLong(): boolean {
		// Use this.points() to ensure we check against ghost points during creation
		const allPoints = this.points();
		if (allPoints.length < 2) return false;
		return allPoints[0].price > allPoints[1].price;
	}

	/**
	 * Helper to retrieve the base text styling options for the auto-generated labels.
	 *
	 * Used internally or by views to ensure consistency when rendering the dynamic text stats.
	 *
	 * @returns A deep copy of the `entryStopLossText` options.
	 */
	public getAutoTextBaseOptions(): TextOptions {
		const currentOptions = this.options();
		return deepCopy(currentOptions.entryStopLossText) as TextOptions;
	}

	/**
	 * Retrieves the internally cached direction state.
	 *
	 * This state helps track if a "Flip" has occurred during a drag operation.
	 *
	 * @returns `true` (Long), `false` (Short), or `null` (Uninitialized).
	 */
	public getStoredDirection(): boolean | null {
		return this._isLong;
	}

	/**
	 * Updates the internally cached direction state.
	 *
	 * @param isLong - The new direction (`true` for Long).
	 */
	public setStoredDirection(isLong: boolean): void {
		this._isLong = isLong;
	}

	/**
	 * Safely rounds a raw price value to the nearest tick mark (`minMove`).
	 *
	 * **Why is this needed?**
	 * Floating point math and mouse positions can result in prices like `100.0000001`.
	 * This helper ensures values align with the instrument's precision (e.g., 0.01) while
	 * guarding against division-by-zero errors if `minMove` is invalid.
	 *
	 * @param price - The raw price.
	 * @returns The rounded price.
	 * @private
	 */
	private _roundPrice(price: number): number {
		const series = this.getSeries();
		const minMove = series.options().priceFormat.minMove;
		
		// Guard against invalid minMove (0 or extremely close to 0)
		if (minMove <= 1e-14) {
			return price;
		}
		
		return Math.round(price / minMove) * minMove;
	}

	/**
	 * Calculates the Profit Target (P2) price based on the Entry (P0) and Stop Loss (P1).
	 *
	 * **Logic (3R Rule):**
	 * 1. Calculates the Risk distance: `|Entry - Stop|`.
	 * 2. Multiplies Risk by 3 to get the Reward distance.
	 * 3. Adds/Subtracts Reward from Entry based on direction (Long/Short).
	 * 4. Enforces a minimum distance (1 tick) to prevent the PT from overlapping the Entry.
	 *
	 * @param entryPoint - The entry point P0.
	 * @param stopPoint - The stop loss point P1.
	 * @param ptPointTimestamp - The X-coordinate for the new PT (usually synced to P1).
	 * @returns A new {@link LineToolPoint} for the Profit Target.
	 */
	public calculateProfitTarget(entryPoint: LineToolPoint, stopPoint: LineToolPoint, ptPointTimestamp: number): LineToolPoint {
		const series = this.getSeries();
		// Use minMove for mathematical rounding
		const minMove = series.options().priceFormat.minMove;

		// PERFORMANCE: Use math rounding instead of string parsing
		//const entryPrice = Math.round(entryPoint.price / minMove) * minMove;
		//const stopLossPrice = Math.round(stopPoint.price / minMove) * minMove;
		const entryPrice = this._roundPrice(entryPoint.price);
		const stopLossPrice = this._roundPrice(stopPoint.price);

		const riskDistance = Math.abs(entryPrice - stopLossPrice);
		const rewardDistance = riskDistance * 3; // 3x Reward

		const isLong = entryPrice > stopLossPrice;
		let targetPtPrice: number;

		if (isLong) {
			targetPtPrice = entryPrice + rewardDistance;
		} else {
			targetPtPrice = entryPrice - rewardDistance;
		}

		// Proximity Constraint
		if (isLong) {
			targetPtPrice = Math.max(targetPtPrice, entryPrice + minMove);
		} else {
			targetPtPrice = Math.min(targetPtPrice, entryPrice - minMove);
		}

		// PERFORMANCE: Final math rounding
		//const finalPtPrice = Math.round(targetPtPrice / minMove) * minMove;
		const finalPtPrice = this._roundPrice(targetPtPrice);

		return {
			price: finalPtPrice,
			timestamp: ptPointTimestamp,
		};
	}	

	/**
	 * Detects if the trade direction has flipped (Entry crossed Stop Loss).
	 *
	 * @param newEntryPrice - The new entry price.
	 * @param newStopPrice - The new stop price.
	 * @returns `true` if the direction changed (Long -> Short or vice versa), `false` otherwise.
	 * @private
	 */
	private _checkForFlip(newEntryPrice: number, newStopPrice: number): boolean {
		const newIsLong = newEntryPrice > newStopPrice;
		const flipOccurred = this._isLong !== null && this._isLong !== newIsLong;
		this._isLong = newIsLong;
		return flipOccurred;
	}

	/**
	 * The central state machine logic for the tool.
	 *
	 * **Tutorial Note:**
	 * This method handles the complex behavior when dragging points:
	 * 1. **Flip Detection:** If Entry crosses Stop, it flags `_flipModeActive`.
	 * 2. **Forced 3R:** If flipping or creating, it forces the PT to stay at exactly 3x Risk.
	 * 3. **Custom Mode:** If the user drags the PT explicitly, it respects that distance but ensures
	 *    it doesn't cross back over the Entry price (min 1 tick distance).
	 *
	 * This runs after every drag event to keep the 3 points geometrically valid.
	 *
	 * @private
	 */
	private _updateAndNormalizeToolState(): void {
		const series = this.getSeries();
		const minMove = series.options().priceFormat.minMove;

		const entryPoint = this._points[0];
		const stopPoint = this._points[1];
		
		if (this._points.length < 3) return; 

		// Check if RISK is collapsed (Entry vs Stop)
		const currentRiskDist = Math.abs(entryPoint.price - stopPoint.price);
		const isRiskCollapsed = currentRiskDist <= minMove * 1.5;

		// 1. Check for Flip (Scenarios 2 & 3)
		const flipOccurred = this._checkForFlip(entryPoint.price, stopPoint.price);
		const isLong = ensureNotNull(this._isLong);

		// 2. Manage "Flip Mode" State
		if (flipOccurred) {
			this._flipModeActive = true;
		}

		// 3. Logic Branch
		// Force 3R if: Creating OR Flip Active OR Risk is Collapsed (Crossover zone)
		if (this._clickCount < 2 || this._flipModeActive || isRiskCollapsed) {
			// --- SCENARIO 2 & 3: FORCED 3R MODE ---
			// Continuously recalculate 3R based on the *current* Entry/Stop positions
			
			const requiredPtPoint = this.calculateProfitTarget(entryPoint, stopPoint, stopPoint.timestamp);
			
			this._points[2].price = requiredPtPoint.price;
			this._points[2].timestamp = stopPoint.timestamp;

		} else {
			// --- SCENARIO 1 & 5: CUSTOM MODE ---
			// Maintain Custom R:R, but enforce proximity (Scenario 1)

			const currentPtPrice = this._points[2].price;
			let constrainedPtPrice = currentPtPrice;

			if (isLong) {
				// Long: PT must be above Entry + MinMove
				constrainedPtPrice = Math.max(currentPtPrice, entryPoint.price + minMove);
			} else {
				// Short: PT must be below Entry - MinMove
				constrainedPtPrice = Math.min(currentPtPrice, entryPoint.price - minMove);
			}

			this._points[2].price = constrainedPtPrice;
			// FIX: Always sync PT timestamp to Stop timestamp in Custom Mode too
			this._points[2].timestamp = stopPoint.timestamp;
		}
	}	

	/**
	 * Overrides the base method to inject a virtual Profit Target during creation.
	 *
	 * **Why override?**
	 * During creation, the user only clicks P0 (Entry) and P1 (Stop). The P2 (Target) hasn't
	 * been created yet. This override dynamically calculates where P2 *would* be (at 3R)
	 * and returns it as part of the array. This allows the View to render the full Green/Red
	 * shape while the user is still just dragging the Stop Loss ghost point.
	 *
	 * @returns The array of points, potentially including a virtual P2.
	 * @override
	 */
	public override points(): LineToolPoint[] {
		const corePoints = super.points(); // [Entry] or [Entry, GhostStop]

		if (corePoints.length === 2) {
			// Calculate virtual PT
			const virtualPT = this.calculateProfitTarget(
				corePoints[0], 
				corePoints[1], 
				corePoints[1].timestamp
			);
			return [...corePoints, virtualPT];
		}

		return corePoints;
	}

	/**
	 * Retrieves a point from the (potentially augmented) points array.
	 *
	 * Delegates to the overridden {@link points} method to ensure virtual points are returned correctly.
	 *
	 * @param index - The point index.
	 * @returns The point or `null`.
	 * @override
	 */
	public override getPoint(index: number): LineToolPoint | null {
		// Use the overridden points() logic
		const allPoints = this.points();
		return allPoints[index] || null;
	}


	/**
	 * Handles complex drag logic for Entry, Stop, and Target points.
	 *
	 * **Logic:**
	 * - **Index 2 (Target):** Constrains the drag so the Target cannot cross the Entry price.
	 *   It allows "Custom R:R" mode (user sets specific target).
	 * - **Index 0/1 (Entry/Stop):** Updates the point and then triggers `_updateAndNormalizeToolState`.
	 *   This might cause the Target to jump (if in 3R mode) to maintain the ratio.
	 *
	 * @param index - The anchor index.
	 * @param point - The new logical position.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		const series = this.getSeries();
		const minMove = series.options().priceFormat.minMove;

		// PERFORMANCE: Use math rounding for the incoming point
		//const newPrice = Math.round(point.price / minMove) * minMove;
		const newPrice = this._roundPrice(point.price);
		
		if (index === 2) {
			// --- SCENARIO 4: PT DRAG ---
			const entryPrice = this._points[0].price;
			const isLong = this.isCurrentLong();

			let constrainedPrice = newPrice;

			if (isLong) {
				// Long: PT cannot go below (Entry + 1 tick)
				constrainedPrice = Math.max(newPrice, entryPrice + minMove);
			} else {
				// Short: PT cannot go above (Entry - 1 tick)
				constrainedPrice = Math.min(newPrice, entryPrice - minMove);
			}

			// Apply
			this._points[2].price = constrainedPrice;
			this._points[2].timestamp = this._points[1].timestamp;

		} else if (index < 2) {
			// 3. Handle Entry (0) or Stop Loss (1) Drag
			super.setPoint(index, { price: newPrice, timestamp: point.timestamp });

			this._updateAndNormalizeToolState();
		}
	}	
	

	/**
	 * Orchestrates the creation flow (Click 1 -> Entry, Click 2 -> Stop + Auto PT).
	 *
	 * **Tutorial Note:**
	 * 1. **Click 1:** Adds Entry.
	 * 2. **Click 2:** Adds Stop. Crucially, it **also** creates and pushes the permanent Profit Target (P2)
	 *    calculated at 3R. It then immediately finalizes the tool (`tryFinish()`).
	 *
	 * @param point - The raw mouse point.
	 * @override
	 */
	public override addPoint(point: LineToolPoint): void {
		// PERFORMANCE: Use math rounding for the new point
		const series = this.getSeries();
		const minMove = series.options().priceFormat.minMove;
		//point.price = Math.round(point.price / minMove) * minMove;
		point.price = this._roundPrice(point.price);

		if (this.isFinished()) return;

		if (this._clickCount === 0) {
			// Click 1: Entry Point (P0)
			super.addPoint(point); 
			this._clickCount = 1;

		} else if (this._clickCount === 1) {
			// Click 2: Finalize Stop Loss (P1)
			super.addPoint(point); 
			this._clickCount = 2;

			// Create and Add Permanent PT (P2)
			const p0 = this._points[0];
			const p1 = this._points[1];
			const p2 = this.calculateProfitTarget(p0, p1, p1.timestamp);
			this._points.push(p2); 
			
			this._updateAndNormalizeToolState();
			this.tryFinish();
			this._coreApi.fireAfterEditEvent(this, 'lineToolFinished');
		}
	}	

	/**
	 * Legacy/No-op method.
	 *
	 * The core plugin handles ghosting via `setLastPoint`. This override exists to satisfy
	 * internal contracts or legacy patterns but performs no action.
	 */
	public updatePreviewPoints(point: LineToolPoint): void {
		// No-op: Core handles ghosting.
	}

	/**
	 * Performs the hit test for the Position tool.
	 *
	 * **Architecture Note:**
	 * Delegates to `LineToolLongShortPositionPaneView`. The view composites multiple renderers
	 * (Risk Rect, Reward Rect, Labels). Hitting any of them selects the tool.
	 *
	 * @param x - X coordinate.
	 * @param y - Y coordinate.
	 * @returns A hit result, or `null`.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {

		// This guards against hitTest being called after the tool has been destroyed and _paneViews cleared.
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		const paneView = this._paneViews[0] as LineToolLongShortPositionPaneView<HorzScaleItem>;
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;

		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}
		return compositeRenderer.hitTest(x, y);
	}

	/**
	 * Resets transient state flags at the end of an interaction (MouseUp).
	 *
	 * Specifically, it clears `_flipModeActive`, marking the end of a dynamic flip operation.
	 * The geometric order of points is **not** sorted here because P0/P1/P2 have fixed roles
	 * (Entry/Stop/Target) regardless of their price values.
	 *
	 * @override
	 */
    public normalize(): void {
        this._flipModeActive = false;
    }


	/**
	 * Implements Shift key constraints for editing.
	 *
	 * **Constraint Logic:**
	 * - **Entry/Stop (0, 1):** Locks the **Price** (Horizontal move only). This allows the user
	 *   to slide the trade setup forward/backward in time without accidentally changing the price levels.
	 * - **Target (2):** No extra constraint applied (handled by `setPoint` limits).
	 *
	 * @param pointIndex - Anchor index.
	 * @param rawScreenPoint - Mouse position.
	 * @param phase - Interaction phase.
	 * @param originalLogicalPoint - Start position.
	 * @param allOriginalLogicalPoints - Full state snapshot.
	 * @returns The constrained point result.
	 * @override
	 */
	public override getShiftConstrainedPoint(
		pointIndex: number,
		rawScreenPoint: Point,
		phase: InteractionPhase,
		originalLogicalPoint: LineToolPoint,
		allOriginalLogicalPoints: LineToolPoint[]
	): ConstraintResult {
		// Default behavior: No constraint
		const result: ConstraintResult = {
			point: rawScreenPoint,
			snapAxis: 'none'
		};

		// Only apply constraint during the Editing phase (dragging existing points),
		// not during Creation.
		if (phase !== InteractionPhase.Editing) {
			return result;
		}

		// Apply constraint only to Entry (0) and Stop (1).
		// PT (2) is skipped because it is already strictly constrained to the Y-axis by setPoint logic.
		if (pointIndex === 0 || pointIndex === 1) {
			// Constraint: Lock Price (Horizontal movement only).
			// We calculate the screen Y coordinate of the *original* price to keep it locked.
			const series = this.getSeries();
			const lockedScreenY = series.priceToCoordinate(originalLogicalPoint.price);

			if (lockedScreenY !== null) {
				return {
					// Use mouse X, but lock Y to the original position
					point: new Point(rawScreenPoint.x, lockedScreenY as Coordinate),
					snapAxis: 'price' // Hint to the manager to preserve the exact original logical price
				};
			}
		}

		return result;
	}
	
	
}