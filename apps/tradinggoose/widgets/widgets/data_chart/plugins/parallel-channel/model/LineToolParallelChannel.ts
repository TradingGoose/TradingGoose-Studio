// src/model/LineToolParallelChannel.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	SeriesType,
	LineStyle,
	Coordinate,
	Time
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPoint,
	LineToolOptionsInternal,
	LineToolType,
	DeepPartial,
	LineToolsCorePlugin,
	merge,
	deepCopy,
	PriceAxisLabelStackingManager,
	LineEnd,
	Point,
	LineToolHitTestData,
	CompositeRenderer,
	HitTestResult,
	RectangleOptions,
	LineOptions,
	ExtendOptions,
	BackgroundOptions,
	LineJoin,
	ConstraintResult,
	InteractionPhase,
	PaneCursorType,
	intersectLines,
	lineThroughPoints,
	interpolateLogicalIndexFromTime,
	interpolateTimeFromLogicalIndex,
} from '../../core';

import { LineToolParallelChannelPaneView } from '../views/LineToolParallelChannelPaneView';


/**
 * Defines the default configuration options for the Parallel Channel tool.
 *
 * **Tutorial Note:**
 * A Parallel Channel consists of three visual components:
 * 1. **Channel Line:** The solid borders (Top P0-P1 and Bottom P2-P3).
 * 2. **Middle Line:** The dashed center line running between the borders.
 * 3. **Background:** A semi-transparent fill between the borders.
 *
 * The defaults configure these components with a standard blue theme and dashed middle line.
 * Axis labels are disabled by default as this is primarily a trend analysis tool.
 */
export const ParallelChannelOptionDefaults: LineToolOptionsInternal<'ParallelChannel'> = {
	visible: true,
	editable: true,
	defaultHoverCursor: PaneCursorType.Pointer,
	defaultDragCursor: PaneCursorType.Grabbing,
	defaultAnchorHoverCursor: PaneCursorType.Pointer,
	defaultAnchorDragCursor: PaneCursorType.Grabbing,
	notEditableCursor: PaneCursorType.NotAllowed,
	showPriceAxisLabels: false, // Default to false for complex tools
	showTimeAxisLabels: false,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,

	channelLine: {
		width: 1,
		color: '#2962ff',
		style: LineStyle.Solid,
	},
	middleLine: {
		width: 1,
		color: '#2962ff',
		style: LineStyle.Dashed,
	},
	showMiddleLine: true,
	extend: { left: false, right: false },
	background: { color: 'rgba(41, 98, 255, 0.2)' },
};


/**
 * Concrete implementation of the Parallel Channel drawing tool.
 *
 * **What is a Parallel Channel?**
 * It is defined by **3 points**:
 * - **P0 & P1:** Define the "Base Line" (typically the top trend line).
 * - **P2:** Defines the "Parallel Line" offset. The slope of the parallel line is identical to P0-P1.
 *
 * **Complex Interaction:**
 * This tool manages **6 Interactive Anchors** (3 real, 3 virtual) to allow resizing the channel's
 * slope, width (height), or position from various grab points.
 */
export class LineToolParallelChannel<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('ParallelChannel').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'ParallelChannel';

	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Parallel Channel is defined by exactly **3 points** (Start, End, and Width/Offset).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 3;

	/**
	 * Initializes the Parallel Channel tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** Uses `ParallelChannelOptionDefaults` (Blue theme).
	 * 2. **User Options:** Merges user provided settings.
	 * 3. **View:** Assigns `LineToolParallelChannelPaneView`, which handles the complex task of
	 *    calculating the 4th corner (P3) and rendering the filled parallelogram.
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
		options: DeepPartial<LineToolOptionsInternal<'ParallelChannel'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// 1. Create final options object
		const finalOptions = deepCopy(ParallelChannelOptionDefaults) as LineToolOptionsInternal<'ParallelChannel'>;
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'ParallelChannel'>>);

		// 2. Call the BaseLineTool constructor
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'ParallelChannel',
			3, // 3-point tool
			priceAxisLabelStackingManager
		);

		// 3. Set the specific PaneView for this tool.
		this._setPaneViews([new LineToolParallelChannelPaneView(this, this._chart, this._series)]);

		console.log(`ParallelChannel Tool created with ID: ${this.id()}`);
	}

	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * The Parallel Channel uses 6 anchors in total:
	 * - **0, 1, 2:** The primary defining points.
	 * - **3:** The derived 4th corner (P3).
	 * - **4:** The bottom-edge midpoint (resizes height).
	 * - **5:** The top-edge midpoint (translates the base line).
	 *
	 * @override
	 * @returns `5`
	 */
	public override maxAnchorIndex(): number {
		return 5;
	}

	/**
	 * Enables geometric constraints (Shift key) during "Click-Click" creation.
	 *
	 * If `true`, holding Shift while placing the second point (P1) will lock the base line
	 * to horizontal or vertical axes.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickClickConstraint(): boolean {
		return true; // We want Y-lock for the second click
	}

	/**
	 * Enables geometric constraints (Shift key) during "Click-Drag" creation or editing.
	 *
	 * If `true`, holding Shift while dragging P1 will lock the base line's angle.
	 *
	 * @override
	 * @returns `true`
	 */
	public supportsShiftClickDragConstraint(): boolean {
		return true; // We want Y-lock if the user drags the second point
	}	

	/**
	 * Helper function to stabilize the X-coordinate (Time) of a calculated midpoint.
	 *
	 * **Why is this needed?**
	 * When calculating a midpoint (e.g., between P0 and P1), the result might fall between two bars
	 * (a fractional logical index). Converting this fraction to a screen coordinate can cause jitter.
	 * This method snaps the timestamp to the center of the nearest discrete bar (integer logical index)
	 * to ensure stable rendering of midpoint anchors.
	 *
	 * @param timeA - The first timestamp.
	 * @param timeB - The second timestamp.
	 * @returns An object containing the stable timestamp and the raw midpoint.
	 * @private
	 */
	private _snapMidpointTimestamp(timeA: number, timeB: number): { stableTime: number; rawMidTime: number } {
		const rawMidpointTime = (timeA + timeB) / 2;

		// 1. Convert raw midpoint time to a fractional logical index
		const fractionalLogicalIndex = interpolateLogicalIndexFromTime(
			this._chart,
			this.getSeries(),
			rawMidpointTime as unknown as Time
		);

		if (fractionalLogicalIndex === null) {
			return { stableTime: rawMidpointTime, rawMidTime: rawMidpointTime }; // Fallback
		}

		// 2. Round the fractional logical index to the nearest integer for stability
		const snappedLogicalIndex = Math.round(fractionalLogicalIndex);

		// 3. Convert the stable integer logical index back to a stable timestamp
		const stableTime = interpolateTimeFromLogicalIndex(
			this._chart,
			this.getSeries(),
			snappedLogicalIndex
		);

		const finalStableTime = stableTime !== null ? Number(stableTime) : rawMidpointTime;

		return { stableTime: finalStableTime, rawMidTime: rawMidpointTime };
	}

	/**
	 * Helper function to calculate the precise Y-coordinate (Price) on a line segment at a specific Time.
	 *
	 * **Usage:**
	 * After snapping the X-coordinate of a midpoint (via `_snapMidpointTimestamp`), the Y-coordinate
	 * must be adjusted to stay exactly on the line segment at that new X position. This performs a linear
	 * interpolation (Point-Slope form) to find that price.
	 *
	 * @param pA - Start point of the segment.
	 * @param pB - End point of the segment.
	 * @param timeX - The X-coordinate (Time) at which to find the interpolated price.
	 * @returns The interpolated price value.
	 * @private
	 */
	private _interpolatePriceAtTime(pA: LineToolPoint, pB: LineToolPoint, timeX: number): number {
		// If the segment is a vertical line (times are equal), return the midpoint price (or P_A's price)
		if (pA.timestamp === pB.timestamp) {
			return (pA.price + pB.price) / 2; // Return simple Y midpoint
		}

		// Linear interpolation (Point-Slope Form):
		// P_y = P_Ay + (P_By - P_Ay) / (P_Bx - P_Ax) * (P_x - P_Ax)
		const priceChange = pB.price - pA.price;
		const timeChange = pB.timestamp - pA.timestamp;
		const slope = priceChange / timeChange;

		return pA.price + slope * (timeX - pA.timestamp);
	}

	/**
	 * Calculates the logical position for any of the 6 anchors (real or virtual).
	 *
	 * **Tutorial Note on Virtual Anchors:**
	 * - **0-2:** Returns the stored points P0, P1, P2.
	 * - **3 (Derived Corner):** Calculates the 4th corner (Bottom-Right) to complete the parallelogram.
	 *   Logic: P3.x = P1.x, P3.y = P2.y + (P1.y - P0.y).
	 * - **4-5 (Midpoints):** Calculates the "Height" handles.
	 *   - Index 4: Bottom Edge Midpoint.
	 *   - Index 5: Top Edge Midpoint.
	 *   *Note:* These midpoints use `_snapMidpointTimestamp` to ensure the handle sits on a valid bar, preventing visual jitter.
	 *
	 * @param index - The anchor index (0-5).
	 * @returns The calculated {@link LineToolPoint}, or `null` if points are missing.
	 * @override
	 */
	public override getPoint(index: number): LineToolPoint | null {
		// Use the full set of points (permanent + last/ghost point)
		const currentPoints = this.points();

		// P0, P1, P2 are the primary stored/ghosted points.
		if (index < 3) {
			return currentPoints[index] || null;
		}

		// Cannot calculate P3, P4, P5 if P0, P1, P2 aren't all present
		if (currentPoints.length < 3) return null; 

		const [p0, p1, p2] = currentPoints;

		// 1. Anchor 3 (Derived 4th Corner) - P3
		// (Rigid Vertical Side) formula:
		// P3 = P1's X, P2's Y + (P1's Y - P0's Y) - (This is the height)
		if (index === 3) {
			// **FIX: Use lowercase p0 and p1 (the defined variables)**
			const channelHeight = p1.price - p0.price; // Vertical distance of top line segment
			
			const p3: LineToolPoint = {
				timestamp: p1.timestamp, // P3's X is P1's X
				price: p2.price + channelHeight, // P3's Y is P2's Y + vertical height
			};
			return p3;
		}

		// --- Snapped Midpoint Logic (Indices 4 & 5) ---
		let midPointA: LineToolPoint;
		let midPointB: LineToolPoint;
		
		if (index === 4) { // Height Midpoint (Midpoint of P2-P3)
			const p3 = this.getPoint(3); // Recursive call to get the virtual P3
			if (!p3) return null;
			midPointA = p2;
			midPointB = p3;
		} else if (index === 5) { // Translation Midpoint (Midpoint of P0-P1)
			midPointA = p0;
			midPointB = p1;
		} else {
			return null;
		}

		// 2. Snap the X-axis (Time)
		const { stableTime } = this._snapMidpointTimestamp(midPointA.timestamp, midPointB.timestamp);

		// 3. Calculate the Price (Y) at the Stable Time
		const stablePrice = this._interpolatePriceAtTime(midPointA, midPointB, stableTime);

		// 4. Return the new stable LineToolPoint
		return {
			timestamp: stableTime,
			price: stablePrice,
		};
	}	

	/**
	 * Helper to snap a raw price value to the nearest price scale tick.
	 *
	 * **Why is this needed?**
	 * When dragging channel edges, small floating-point variations can cause the channel height to
	 * drift slightly or visually "bobble". Snapping to the price scale ensures clean, deterministic
	 * vertical movements.
	 *
	 * @param rawPrice - The raw floating-point price from the mouse.
	 * @returns The price snapped to the series' price scale.
	 * @private
	 */
	private _constrainNewPrice(rawPrice: number): number {
		const series = this.getSeries();
		if (!series) return rawPrice;

		// 1. Convert the raw price to a Y-coordinate (pixel)
		const rawCoord = series.priceToCoordinate(rawPrice);

		if (rawCoord === null) return rawPrice;

		// 2. Round the Y-coordinate to the nearest integer pixel
		const snappedCoord = Math.round(rawCoord);

		// 3. Convert the snapped Y-coordinate (pixel) back to a price value
		const snappedPrice = series.coordinateToPrice(snappedCoord as Coordinate);

		return snappedPrice !== null ? snappedPrice : rawPrice;
	}

	/**
	 * Handles the complex resizing logic for all 6 anchors.
	 *
	 * **Interaction Logic:**
	 * - **Corners (0, 2):** Moves the **Left Side**. Dragging P0 moves P2 in unison to maintain height.
	 * - **Corners (1, 3):** Moves the **Right Side**. Dragging P1 moves P3 (and thus P1) in unison.
	 * - **Bottom Edge (4):** Adjusts the channel height from the bottom. Moves the Parallel Line (P2-P3) vertically.
	 * - **Top Edge (5):** Adjusts the channel height from the top. Moves the Base Line (P0-P1) vertically.
	 *
	 * This "Rigid Side" logic ensures the channel always remains a parallelogram with vertical sides parallel to the Y-axis.
	 *
	 * @param index - The index of the anchor being dragged.
	 * @param newPoint - The new logical position.
	 * @override
	 */
	public override setPoint(index: number, newPoint: LineToolPoint): void {
		const originalPoints = this._points;
		const P0 = originalPoints[0]; // Top-Left
		const P1 = originalPoints[1]; // Top-Right
		const P2 = originalPoints[2]; // Bottom-Left (defines channel's vertical offset)

		// Derived P3 (Bottom-Right)
		const P3 = this.getPoint(3); 
		if (P3 === null) return; 

		let priceDelta: number;
		let newP0: LineToolPoint;
		let newP1: LineToolPoint;
		let newP2: LineToolPoint;

		// Constrain the dragged price to the nearest stable price pixel for ALL corner/side drags (0, 1, 2, 3)
		const constrainedPrice = this._constrainNewPrice(newPoint.price);
		const constrainedPoint: LineToolPoint = { ...newPoint, price: constrainedPrice };


		switch (index) {
			// --- RIGID LEFT SIDE MOVEMENT (Anchors 0 and 2) ---

			case 0: // Top Left (P0) is dragged.
			case 2: { // Bottom Left (P2) is dragged.
				
				// 1. Calculate the Y-distance (Price)
				const channelHeightDelta = P2.price - P0.price; 
				
				// 2. The dragged point (constrainedPoint) sets the new position for the entire side.
                // X-movement is now allowed (uses newPoint.timestamp)

				if (index === 0) {
					// Dragging P0: P0 moves to newPoint, P2 follows, maintaining height.
					newP0 = constrainedPoint; // Uses new X and constrained Y
					newP2 = { 
                        timestamp: constrainedPoint.timestamp, 
                        price: constrainedPoint.price + channelHeightDelta 
                    };
				} else { // index === 2
					// Dragging P2: P2 moves to newPoint, P0 follows, maintaining height.
					newP2 = constrainedPoint; // Uses new X and constrained Y
					newP0 = { 
                        timestamp: constrainedPoint.timestamp, 
                        price: constrainedPoint.price - channelHeightDelta 
                    };
				}
				
				// Apply updates atomically
				this._points[0] = newP0; 
				this._points[2] = newP2; 
				break;
			}

			// --- RIGID RIGHT SIDE MOVEMENT (Anchors 1 and 3) ---

			case 1: // Top Right (P1) is dragged.
			case 3: { // Bottom Right (P3 derived) is dragged.
 
				// The base P1 position before the move
				const oldP1 = this._points[1];
 
				if (index === 1) {
					// Dragging P1: P1 is simply set to the new, constrained position.
					newP1 = constrainedPoint; // Uses new X and constrained Y
				} else { // index === 3 (Dragging P3)
					
					// 1. Calculate the vertical delta of the P3 move relative to its original position.
					// P3 is defined by this.getPoint(3), which we fetched at the start of setPoint.
					const dragDeltaPrice = constrainedPoint.price - P3.price;
 
					// 2. The P3 drag means P1 must move by the same vertical delta.
					newP1 = {
						timestamp: constrainedPoint.timestamp, // New X is from mouse
						price: oldP1.price + dragDeltaPrice // New Y is P1's old Y + the delta
					};
				}
 
				// Apply updates atomically
				this._points[1] = newP1;
				// P0 and P2 are left unchanged. This ensures only the right side moves.
				break;
			}

			// --- VERTICAL HEIGHT ADJUSTMENT FROM BOTTOM (Anchor 4 - Bottom Middle) ---

			case 4: {
				// Anchor 4 (Bottom Middle) moves the parallel line (P2-P3) vertically.
				// This movement must be Y-only (X-locked).
				const originalAnchor4 = this.getPoint(4);
				if (!originalAnchor4) return;
				
				// Use the constrained newPoint for the delta calculation
				// X is locked, so we use the original P2 X
				priceDelta = constrainedPoint.price - originalAnchor4.price;
				
				// Update P2: Y-position moves by the delta. X-position remains fixed.
				newP2 = {
					timestamp: P2.timestamp,
					price: P2.price + priceDelta, 
				};
				
				// Apply update
				this._points[2] = newP2;
				break;
			}


			// --- VERTICAL HEIGHT ADJUSTMENT FROM TOP (Anchor 5 - Top Middle) ---

			case 5: {
				// Anchor 5 (Top Middle) moves the base line (P0-P1) vertically, leaving P2 fixed.
				// This movement must be Y-only (X-locked).
				const originalAnchor5 = this.getPoint(5);
				if (!originalAnchor5) return;
				
				// Use the constrained newPoint for the delta calculation
				priceDelta = constrainedPoint.price - originalAnchor5.price;
				
				// Translate P0 and P1. P2 remains fixed.
				newP0 = {
					timestamp: P0.timestamp,
					price: P0.price + priceDelta,
				};
				newP1 = {
					timestamp: P1.timestamp,
					price: P1.price + priceDelta,
				};
				
				// Apply updates atomically
				this._points[0] = newP0;
				this._points[1] = newP1;
				break;
			}
			
			// --- FALLBACK (For primary points 0, 1, 2 if dragged directly) ---
			default:
				// Fall back to the original BaseLineTool implementation for single-point edits.
				super.setPoint(index, newPoint);
				break;
		}

		// *** EFFICIENCY FIX: Only call update once, after all point manipulations are complete. ***
		this._triggerChartUpdate();
	}	

	/**
	 * Overrides the ghost point logic to constrain the 3rd point (P2) during creation.
	 *
	 * **Tutorial Note:**
	 * When placing the 3rd point (which defines the channel width/height), we force its
	 * X-coordinate (Time) to match P0. This ensures that the user is defining the *vertical offset*
	 * of the parallel line, creating a mathematically perfect parallel channel structure from the start.
	 *
	 * @param point - The raw mouse position.
	 * @override
	 */
	public override setLastPoint(point: LineToolPoint | null): void {
		if (point === null) {
			super.setLastPoint(null);
			return;
		}

		// Check if we are ghosting the 3rd point (P2)
		// This happens when 2 permanent points (P0, P1) already exist.
		if (this._points.length === 2) {
			const p0 = this._points[0]; // P0 is permanent
			const p1 = this._points[1]; // P1 is permanent

			// 1. Get the X-coordinate that P2 must be locked to.
			// Since we want a channel with rigid vertical sides, P2's X must lock to P0's X.
			const fixedTime = p0.timestamp;

			// 2. The Y-coordinate (price) is taken directly from the mouse (newPoint).
			const newPrice = point.price;

			// 3. Create the constrained point.
			const constrainedPoint: LineToolPoint = {
				timestamp: fixedTime,
				price: newPrice,
			};
 
			// 4. Set the constrained point as the last point.
			super.setLastPoint(constrainedPoint);
			return;
		}
 
		// For all other cases (ghosting P1), use the default unconstrained behavior
		// This means P1 is free to move in X and Y during its creation step.
		super.setLastPoint(point);
	}	

	/**
	 * Re-orders the internal points so P0 is always to the left of P1 in time.
	 *
	 * **Logic:**
	 * If the user draws the base line right-to-left (P0 > P1), this method swaps them.
	 * Crucially, it also recalculates P2 so that the *shape* of the channel remains consistent
	 * after the swap (preventing the channel from flipping inside out).
	 *
	 * @override
	 */
	public normalize(): void {
		if (this._points.length < 3) {
			return;
		}

		let p0 = this._points[0];
		let p1 = this._points[1];

		// Only normalize if the top line is drawn right-to-left
		if (p0.timestamp > p1.timestamp) {
			
			// 1. Get the position of the derived P3 (Bottom Right) BEFORE the swap.
			const P3_old_position = this.getPoint(3);
			if (P3_old_position === null) return;

			// 2. SWAP: P0 <-> P1
			[this._points[0], this._points[1]] = [p1, p0];

			// 3. SWAP: P2 (old Bottom Left) must become the new Bottom Right's counterpart.
			// The new P2 must be the old P3 (Bottom Right) position to maintain the shape.
			this._points[2] = P3_old_position;
		}
	}

	/**
	 * Performs the hit test for the Parallel Channel.
	 *
	 * **Architecture Note:**
	 * Delegates to the `LineToolParallelChannelPaneView`. The view uses a `ParallelChannelRenderer`
	 * which performs ray-casting to check if the mouse is inside the parallelogram or hovering
	 * over any of the three lines (Base, Middle, Parallel).
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result, or `null`.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}
		const paneView = this._paneViews[0] as LineToolParallelChannelPaneView<HorzScaleItem>;
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;

		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		return compositeRenderer.hitTest(x, y);
	}

	
	/**
	 * Implements granular Shift constraint logic.
	 *
	 * **Behavior:**
	 * - **Creation (P1):** Locks P1's Y-coordinate to P0 (Forces a horizontal base line).
	 * - **Editing (Corners):** Locks the drag to either Horizontal or Vertical relative to the
	 *   *opposing* corner.
	 * - **Editing (Edges):** No shift constraint is applied (or rather, the axis is already locked by `setPoint`).
	 *
	 * @param pointIndex - The anchor index.
	 * @param rawScreenPoint - Mouse position.
	 * @param phase - Creation or Editing.
	 * @param originalLogicalPoint - Starting position.
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
		
		// 1. Determine the Constraint Source Point (Logical Coordinates)
		let constraintSourceLogical: LineToolPoint | null = null;
		
		// --- SCENARIO A: CREATION PHASE (P1 Y-Lock to P0 Y) ---
		if (phase === InteractionPhase.Creation) {
			
			// During creation, we are placing the 2nd point (P1). The constraint source is P0 (index 0).
			// The InteractionManager passes allOriginalLogicalPoints[0] as P0.
			// We ensure the constraint only applies when placing P1 (pointIndex should be 1).
			
			if (pointIndex === 1 && allOriginalLogicalPoints.length >= 1) {
				// P0 (index 0) is the source point.
				constraintSourceLogical = allOriginalLogicalPoints[0];
			}
			
		}
		
		// --- SCENARIO B: EDITING PHASE (Anchor Y-Lock to Opposite Anchor Y) ---
		else if (phase === InteractionPhase.Editing) {
			
			// This is the logic for dragging one of the four corners (Indices 0, 1, 2, 3) 
			// while holding Shift to force a horizontal drag (Y-lock).
			
			// This is the logic you originally provided for the Edit phase (Constraining Corners)
			if (pointIndex === 0) { // Dragging P0 is constrained by P1
				constraintSourceLogical = this.getPoint(1); 
			} else if (pointIndex === 1) { // Dragging P1 is constrained by P0
				constraintSourceLogical = this.getPoint(0);
			} else if (pointIndex === 2) { // Dragging P2 is constrained by P3
				constraintSourceLogical = this.getPoint(3);
			} else if (pointIndex === 3) { // Dragging P3 is constrained by P2
				constraintSourceLogical = this.getPoint(2);
			} else {
				// No Y-lock constraint for middle anchors (4, 5) during editing.
				return { point: rawScreenPoint, snapAxis: 'none' };
			}
		}
		
		// --- Fallback if no constraint is applicable or source is missing ---
		if (!constraintSourceLogical) {
			return { point: rawScreenPoint, snapAxis: 'none' }; 
		}

		// 2. Apply the Constraint (Same for both Creation and Editing Scenarios A & B)
		
		// Convert the constraint source's logical position to its current screen coordinates.
		// NOTE: If using 'this.getPoint(index)' for Editing, this is already the constrained logical point.
		const constraintSourceScreenPoint = this.pointToScreenPoint(constraintSourceLogical)!;

		// 3. The constraint is to set the new Y-coordinate to the other point's Y-coordinate.
		const constrainedY = constraintSourceScreenPoint.y;

		// The X coordinate is free to move (rawScreenPoint.x).
		const constrainedPoint = new Point(rawScreenPoint.x, constrainedY);

		// The resulting segment is forced horizontal, meaning we are constraining the PRICE (Y) axis.
		return { point: constrainedPoint, snapAxis: 'price' };
	}	

	/**
	 * Overrides the base `addPoint` to enforce the X-axis lock when committing the 3rd point.
	 *
	 * While `setLastPoint` handles the *visual* constraint during the ghost phase, this method ensures
	 * the *permanent* point stored in the model also adheres to the rule: P2.time must equal P0.time.
	 *
	 * @param point - The raw point from the mouse release event.
	 * @override
	 */
	public override addPoint(point: LineToolPoint): void {
		
		// If it's the 1st or 2nd point, allow it as-is.
		if (this._points.length < 2) {
			super.addPoint(point);
			return;
		}

		// --- Constraint Logic for the 3rd Point (P2) ---

		if (this._points.length === 2) {
			
			// We are adding the 3rd point (P2). P0 already exists at index 0.
			const P0 = this._points[0];
			
			// 1. Lock the X-coordinate (timestamp) to P0's X (Time).
			const fixedTime = P0.timestamp;
			
			// 2. Use the raw Y-coordinate (price) from the mouse up position.
			const finalPointP2: LineToolPoint = {
				timestamp: fixedTime,
				price: point.price,
			};
			
			// Commit the constrained point.
			super.addPoint(finalPointP2);
			return;
		}

		// Default fallback for any unexpected case (e.g., if a multi-point tool allows more than 3)
		super.addPoint(point);
	}
}