// /src/utils/culling-helpers.ts

import { Logical, IChartApiBase, ISeriesApi, SeriesType, IPriceScaleApi, Coordinate } from 'lightweight-charts';
import { LineToolPoint } from '../api/public-api';
import { ensureNotNull  } from './helpers';
import { interpolateTimeFromLogicalIndex, getExtendedVisiblePriceRange  } from './geometry';
import { BaseLineTool } from '../model/base-line-tool';
import { ExtendOptions, SinglePointOrientation, LineToolCullingInfo } from '../types';
import { Vec2, createLineEquation } from './culling-geometry-math';


// #region Types

/**
 * Enum defining the visibility state of a tool relative to the chart's current viewport.
 * 
 * These values are used by the rendering engine to determine if a tool should be drawn (`Visible`)
 * or skipped. If skipped, specific off-screen values (`OffScreenTop`, `OffScreenLeft`, etc.)
 * provide hints about *where* the tool is located, which can be used for directional indicators.
 */
export enum OffScreenState {
    Visible = 'visible',
    OffScreenTop = 'top',
    OffScreenBottom = 'bottom',
    OffScreenLeft = 'left',
    OffScreenRight = 'right',
    FullyOffScreen = 'fullyOffScreen', // Catch-all for tools completely disconnected from the viewport
}

/**
 * Represents an Axis-Aligned Bounding Box (AABB) in the chart's logical coordinate space.
 * 
 * This structure is used for broad-phase culling tests. Time values are stored as
 * numbers (timestamps) and prices as raw values.
 */
export interface ToolBoundingBox {
    minTime: number; 
    maxTime: number; 
    minPrice: number;
    maxPrice: number;
}

// #endregion Types

/**
 * Calculates the Axis-Aligned Bounding Box (AABB) for a set of tool points.
 * 
 * This iterates through all provided points to find the min/max timestamp and price.
 * It is used for fast exclusion checks before performing more expensive geometric clipping.
 *
 * @param points - An array of {@link LineToolPoint}s defining the tool.
 * @returns A {@link ToolBoundingBox} representing the extents, or `null` if the array is empty.
 */
export function getToolBoundingBox(points: LineToolPoint[]): ToolBoundingBox | null {
    if (points.length === 0) return null;

    let minTime = points[0].timestamp;
    let maxTime = points[0].timestamp;
    let minPrice = points[0].price;
    let maxPrice = points[0].price;

    for (const point of points) {
        minTime = Math.min(minTime, point.timestamp);
        maxTime = Math.max(maxTime, point.timestamp);
        minPrice = Math.min(minPrice, point.price);
        maxPrice = Math.max(maxPrice, point.price);
    }

    // NOTE: This now returns an AABB in Time/Price space.
    return { minTime, maxTime, minPrice, maxPrice };
}


/**
 * Calculates the bounding box of the currently visible chart area in logical units (Timestamp/Price).
 * 
 * This function handles the complex logic of mapping the viewport's pixel dimensions back to
 * time and price ranges. Crucially, it uses **interpolation** to determine the timestamp values for
 * the left and right edges of the screen, ensuring accurate bounds even when the user scrolls
 * into the "blank" future space where no data bars exist.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 * @param tool - The tool instance (used to access the chart, series, and scale APIs).
 * @returns A {@link ToolBoundingBox} representing the visible area, or `null` if the chart is not ready.
 */
export function getViewportBounds<HorzScaleItem>(
	tool: BaseLineTool<HorzScaleItem>
): ToolBoundingBox | null {

	const chart = tool.getChart();
	const series = tool.getSeries();
	const timeScale = chart.timeScale();

	// 1. Get Extended Price Range
	const priceRangeResult = getExtendedVisiblePriceRange(tool);

	if (!priceRangeResult || priceRangeResult.from === null || priceRangeResult.to === null) {
		return null;
	}

    //console.groupCollapsed('%c[VIEWPORT DEBUG] Start getViewportBounds (Forced Interpolation Fix)', 'color: #32CD32; font-weight: bold;');


	const logicalRange = timeScale.getVisibleLogicalRange();
	if (!logicalRange) {
        //console.log("Logical Range is null. Exiting.");
        //console.groupEnd();
		return null;
	}

    //console.log(`Initial Logical Range: [${logicalRange.from.toFixed(2)}, ${logicalRange.to.toFixed(2)}]`);


	// BUFFER: Widen by 1 logical unit each side for anti-edge-cull buffer
	const BUFFER = 1;

	const leftLogical = (logicalRange.from - BUFFER) as Logical;
	const rightLogical = (logicalRange.to + BUFFER) as Logical;

    //console.log(`Buffered Logical Range (Target Indices): [${leftLogical.toFixed(2)}, ${rightLogical.toFixed(2)}]`);


    // --- Time Bounds Calculation: FORCED INTERPOLATION FIX ---
    // Problem: coordinateToTime caps the MaxTime value in the blank space.
    // Fix: Rely on interpolateTimeFromLogicalIndex for continuity across the blank space.
    const rawMinTime = interpolateTimeFromLogicalIndex(chart, series, leftLogical);
    const rawMaxTime = interpolateTimeFromLogicalIndex(chart, series, rightLogical);

    //console.log(`%cInterpolation Raw Results: MinTime=${rawMinTime} | MaxTime=${rawMaxTime}`, 'color: #FF8C00; font-weight: bold;');


    if (rawMinTime === null || rawMaxTime === null) {
        //console.log("Interpolation returned null for one or both sides. Exiting.");
        //console.groupEnd();
        return null;
    }

    const minTimeNum = Number(rawMinTime);
    const maxTimeNum = Number(rawMaxTime);

    // Apply rounding for integer consistency (narrower viewport)
    let minTime = Math.ceil(minTimeNum);
    let maxTime = Math.floor(maxTimeNum);
    
    //console.log(`Initial Final Time (Rounded): [${minTime}, ${maxTime}]`);


    // Degeneracy Check (Ensure a valid time range of at least 1 unit)
    if (minTime >= maxTime) {
        //console.log(`%cDegeneracy Detected (minTime >= maxTime). Adjusting maxTime.`, 'color: #FF4500;');
        maxTime = minTime + 1;
    }


    // --- Price Bounds Calculation (Remains Unchanged) ---
	const minPriceRaw = Math.min(priceRangeResult.from, priceRangeResult.to);
	const maxPriceRaw = Math.max(priceRangeResult.from, priceRangeResult.to);

	const viewportBounds = {
		minTime: minTime as number, 
		maxTime: maxTime as number,
		minPrice: minPriceRaw as number,
		maxPrice: maxPriceRaw as number,
	};

    //console.log(`%cFINAL VIEWPORT BOUNDS: MinTime=${viewportBounds.minTime}, MaxTime=${viewportBounds.maxTime}`, 'color: #3CB371; font-weight: bold;');
    //console.groupEnd();
	return viewportBounds;
}

// #endregion Universal Bounding Box Calculators

// #region Main Culling State Helper (Instrumented)




/**
 * Internal geometric helper that computes the culling state for two-point tools with potential infinite extensions.
 * 
 * This function determines if a line segment (or Ray/Infinite Line defined by `extendOptions`) intersects
 * the visible viewport. It normalizes point order, performs parametric clipping against the viewport bounds,
 * and falls back to a full AABB check if the line misses the viewport entirely to provide a directional hint.
 *
 * @param points - An array of exactly two {@link LineToolPoint}s.
 * @param viewportBounds - The bounding box of the visible chart area.
 * @param extendOptions - Configuration defining if the line extends infinitely to the left or right.
 * @returns The {@link OffScreenState} indicating visibility or direction of the miss.
 */
export function getCullingStateWithExtensions(
	points: LineToolPoint[],
	viewportBounds: ToolBoundingBox,
	extendOptions: ExtendOptions
): OffScreenState {

    // NEW: Check for degenerate viewport time (minTime === maxTime — e.g., extreme zoom/single bar)
    const timeDegenerate = viewportBounds.minTime === viewportBounds.maxTime;

	// --- FIX #1: NORMALIZE POINT ORDER ---
	// Ensure p1 is always the point with the earlier timestamp.
	// This makes the parametric space 't' consistent with time's direction.
	let p1: LineToolPoint;
	let p2: LineToolPoint;

    const origP0 = points[0];
    const origP1 = points[1];

	if (points[0].timestamp > points[1].timestamp) {
		p1 = points[1];
		p2 = points[0];
	} else {
		p1 = points[0];
		p2 = points[1];
	}

	// 1. Find the visible parametric range [t_enter, t_exit] of the INFINITE line.
	// This function now receives points in a consistent order.
	const [t_enter, t_exit] = calculateInfiniteLineClip(p1, p2, viewportBounds);

	// 2. Geometric Miss: If t_enter > t_exit, the infinite line never enters the viewport.
	if (t_enter > t_exit) {
		const toolBounds = getToolBoundingBox(points)!;
		
		// --- FIX #2: FULL AABB CHECK ON MISS ---
		// Provide a complete and accurate directional hint.
		if (toolBounds.minPrice > viewportBounds.maxPrice) {
			return OffScreenState.OffScreenTop;
		}
		if (toolBounds.maxPrice < viewportBounds.minPrice) {
			return OffScreenState.OffScreenBottom;
		}
		if (toolBounds.maxTime < viewportBounds.minTime) {
			return OffScreenState.OffScreenLeft;
		}
		if (toolBounds.minTime > viewportBounds.maxTime) {
			return OffScreenState.OffScreenRight;
		}
		return OffScreenState.FullyOffScreen;
	} else {

    }

	// 3. Define the tool's actual path as a parametric range [t_start, t_end].
	// Because of normalization, 'left' (t<0) and 'right' (t>1) are now always correct.
	const t_start = extendOptions.left ? -Infinity : 0;
	const t_end = extendOptions.right ? Infinity : 1;
	
	// 4. Final Overlap Check: Does the tool's path overlap with the visible line segment?
	const overlap_start = Math.max(t_start, t_enter);
	const overlap_end = Math.min(t_end, t_exit);

	// If the overlap range is valid (start <= end), the tool is visible.
	if (overlap_start <= overlap_end) {
		return OffScreenState.Visible;
	} else {
     
    }

	// 5. No Overlap: The specific tool path (e.g., a ray) misses the visible area.
	// We can safely cull. Use the full AABB check for a directional hint.
	const toolBounds = getToolBoundingBox(points)!;


	// --- FIX #2 (Applied here as well for consistency) ---
	if (toolBounds.minPrice > viewportBounds.maxPrice) {
		return OffScreenState.OffScreenTop;
	}
	if (toolBounds.maxPrice < viewportBounds.minPrice) {
		return OffScreenState.OffScreenBottom;
	}
	if (toolBounds.maxTime < viewportBounds.minTime) {
		return OffScreenState.OffScreenLeft;
	}
	if (toolBounds.minTime > viewportBounds.maxTime) {
		return OffScreenState.OffScreenRight;
	}
	return OffScreenState.FullyOffScreen;
}

/**
 * Internal helper implementing a slab-clipping algorithm (similar to Cohen-Sutherland) to clip an infinite line against the viewport.
 * 
 * It calculates the parametric interval `[t_enter, t_exit]` where the infinite line defined by `p1` and `p2`
 * lies inside the `viewport`.
 * - Clips sequentially against vertical (time) and horizontal (price) slabs.
 * - Handles degenerate cases (vertical/horizontal lines) robustly.
 * - Returns `[Infinity, -Infinity]` if the line misses the viewport entirely.
 *
 * @param p1 - The starting point (t=0).
 * @param p2 - The ending point (t=1).
 * @param viewport - The bounding box of the viewport.
 * @returns A tuple `[t_enter, t_exit]` representing the visible segment in parametric space.
 */
function calculateInfiniteLineClip(
	p1: LineToolPoint,
	p2: LineToolPoint,
	viewport: ToolBoundingBox
): [number, number] {

    // NEW: Check for degenerate viewport time (minTime === maxTime — e.g., extreme zoom/single bar)
    const timeDegenerate = viewport.minTime === viewport.maxTime;

	const dx = p2.timestamp - p1.timestamp;
	const dy = p2.price - p1.price;
	
	let t_enter = -Infinity;
	let t_exit = Infinity;

	// --- 1. Clip against Vertical (Time) Slab ---
	// Handle vertical lines (parallel to price axis)
	if (dx === 0) {
		// If the vertical line is outside the viewport's horizontal bounds, it's a guaranteed miss.
		if (p1.timestamp < viewport.minTime || p1.timestamp > viewport.maxTime) {
			return [Infinity, -Infinity]; // RETURN MISS
		}
		// Otherwise, this line spans the entire viewport vertically. The time slab
		// imposes no constraint on 't', so we proceed to the price slab check.
	} else {
        // NEW: Handle degenerate time slab (minTime === maxTime — treat as point slab)
        if (timeDegenerate) {
            const t_single = (viewport.minTime - p1.timestamp) / dx;
            t_enter = Math.max(t_enter, t_single);
            t_exit = Math.min(t_exit, t_single);
        } else {
            let t1 = (viewport.minTime - p1.timestamp) / dx;
            let t2 = (viewport.maxTime - p1.timestamp) / dx;

            // Sort t1 and t2 so t1 is always the entry and t2 is the exit of the slab
            if (t1 > t2) {
                [t1, t2] = [t2, t1];
            }
            
            // Update the master interval
            t_enter = Math.max(t_enter, t1);
            t_exit = Math.min(t_exit, t2);
        }
	}

	// --- 2. Clip against Horizontal (Price) Slab ---
	// Handle horizontal lines (parallel to time axis)
	if (dy === 0) {
		// If the horizontal line is outside the viewport's vertical bounds, it's a guaranteed miss.
		if (p1.price < viewport.minPrice || p1.price > viewport.maxPrice) {
			return [Infinity, -Infinity]; // RETURN MISS
		}
		// Otherwise, we proceed. The price slab imposes no constraint on 't'.
	} else {
		let t1 = (viewport.minPrice - p1.price) / dy;
		let t2 = (viewport.maxPrice - p1.price) / dy;

		// Sort t1 and t2
		if (t1 > t2) {
			[t1, t2] = [t2, t1];
		}

		// Update the master interval
		t_enter = Math.max(t_enter, t1);
		t_exit = Math.min(t_exit, t2);
	}

	// --- 3. Final Check ---
	// If, after all clipping, the interval is invalid, it's a miss.
	if (t_enter > t_exit) {
		return [Infinity, -Infinity];
	}
	return [t_enter, t_exit];
}


/**
 * The primary culling engine entry point. Determines the precise off-screen state of any tool.
 * 
 * This function routes logic based on the tool's geometry:
 * 1. **Complex Shapes**: Uses `cullingInfo` to check specific sub-segments (e.g., for Polylines).
 * 2. **Single Points**: Performs point-in-AABB checks or specific horizontal/vertical line logic if extensions are active.
 * 3. **Two-Point Tools**: Uses robust geometric clipping (via {@link getCullingStateWithExtensions}) to handle segments, rays, and infinite lines.
 * 4. **General Fallback**: Uses a standard AABB overlap check for other cases.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 * @param points - The points defining the tool.
 * @param tool - The tool instance.
 * @param extendOptions - Optional configuration for infinite extensions (Left/Right).
 * @param singlePointOrientation - Optional orientation for single-point infinite lines (Horizontal/Vertical).
 * @param cullingInfo - Optional advanced culling rules (e.g., `subSegments` for multi-segment tools).
 * @returns The final {@link OffScreenState} (Visible, or a specific directional miss).
 */
export function getToolCullingState<HorzScaleItem>(
	points: LineToolPoint[],
	tool: BaseLineTool<HorzScaleItem>,
	extendOptions?: ExtendOptions,
	singlePointOrientation?: SinglePointOrientation,
	cullingInfo?: LineToolCullingInfo, // <<< NEW PARAMETER
): OffScreenState {
	
	// --- Fast Path: Triage ---
	if (points.length === 0) {
		return OffScreenState.FullyOffScreen;
	}

	const viewportBounds = getViewportBounds(tool);
	if (!viewportBounds) {
		return OffScreenState.Visible; // Fail safe if viewport isn't available
	}

	// Determine if general extensions are active
	const hasExtensions = extendOptions && (extendOptions.left || extendOptions.right); // Retained original logic

	// --- Local Helper for Two-Point Check (Returns OffScreenState) ---
	const callTwoPointCuller = (pA: LineToolPoint, pB: LineToolPoint, extend: ExtendOptions): OffScreenState => {
		// NOTE: getCullingStateWithExtensions is defined earlier in this file.
		return getCullingStateWithExtensions([pA, pB], viewportBounds, extend);
	};


	// --- NEW LOGIC: SUB-SEGMENT CULLING CHECK (Highest Priority for Complex Shapes with Culling Info) ---
	// This logic executes for multi-point shapes (length >= 3) where culling rules are provided.
	if (points.length >= 3 && cullingInfo?.subSegments && extendOptions) {
		let isAnySegmentVisible = false;

		for (const [indexA, indexB] of cullingInfo.subSegments) {
			// Ensure indices are valid and points exist
			if (points[indexA] && points[indexB]) {
				// If the culler returns Visible, the whole tool is visible.
				if (callTwoPointCuller(points[indexA], points[indexB], extendOptions) === OffScreenState.Visible) {
					isAnySegmentVisible = true;
					break; // Found a visible segment, no need to check others
				}
			}
		}

		// Final Culling Decision for Sub-Segments:
		if (isAnySegmentVisible) {
			return OffScreenState.Visible;
		} else {
			// If all specified sub-segments are invisible, the tool is fully off-screen/culled.
			return OffScreenState.FullyOffScreen;
		}
	}


	// --- Existing Logic Resumes: Handle 1-point and simple 2-point cases ---

	// Case 1: One point tool
	if (points.length === 1) {
		const p = points[0];
		const isLeftActive = extendOptions?.left ?? false;
		const isRightActive = extendOptions?.right ?? false;
		
		const orientation: SinglePointOrientation | undefined = singlePointOrientation;
		// Check if we need to perform the robust line checks, or just the simple point check.
		const isHorizontalLineActive = hasExtensions && (orientation?.horizontal ?? false);
		const isVerticalLineActive = hasExtensions && (orientation?.vertical ?? false);

		// --- Sub-Case: Single Point AABB Check (No active line components) ---
		// Condition: No extensions OR extensions are active but neither orientation is enabled.
		if (!isHorizontalLineActive && !isVerticalLineActive) {
			
			// Treat as a single point (AABB check only)
			
			// Is the point inside the viewport?
			if (p.timestamp >= viewportBounds.minTime && p.timestamp <= viewportBounds.maxTime &&
				p.price >= viewportBounds.minPrice && p.price <= viewportBounds.maxPrice) {
				return OffScreenState.Visible;
			}
			
			// Point is off-screen. Provide a directional hint based on AABB.
			if (p.price > viewportBounds.maxPrice) return OffScreenState.OffScreenTop;
			if (p.price < viewportBounds.minPrice) return OffScreenState.OffScreenBottom;
			if (p.timestamp < viewportBounds.minTime) return OffScreenState.OffScreenLeft;
			if (p.timestamp > viewportBounds.maxTime) return OffScreenState.OffScreenRight;
			
			return OffScreenState.FullyOffScreen;
		}

		// --- Sub-Case: Robust Line Check (Horizontal/Vertical Line Logic) ---
		
		let isToolVisible = false;

		// -----------------------------------------------------------
		// A. Horizontal Line Check (Price Level)
		// -----------------------------------------------------------
		if (isHorizontalLineActive) {
			// 1. Vertical Check (Strongest Miss Signal)
			const isAlignedVertically = (p.price >= viewportBounds.minPrice && p.price <= viewportBounds.maxPrice);

			if (isAlignedVertically) {
				// 2. Horizontal Check (Visibility by Intersection)
				// Left Ray (Visible if active AND point is not past the viewport's left edge)
				if (isLeftActive && p.timestamp >= viewportBounds.minTime) {
					isToolVisible = true;
				}
				// Right Ray (Visible if active AND point is not past the viewport's right edge)
				if (isRightActive && p.timestamp <= viewportBounds.maxTime) {
					isToolVisible = true;
				}
			}
		}

		// -----------------------------------------------------------
		// B. Vertical Line Check (Time Level)
		// -----------------------------------------------------------
		if (isVerticalLineActive) {
			// 1. Horizontal Check (Time Level)
			const isAlignedHorizontally = (p.timestamp >= viewportBounds.minTime && p.timestamp <= viewportBounds.maxTime);

			if (isAlignedHorizontally) {
				// If it's horizontally aligned, it is guaranteed to intersect the viewport
				isToolVisible = true;
			}
		}

		// Final Visibility Decision: If EITHER line is visible, the tool is visible.
		if (isToolVisible) {
			return OffScreenState.Visible;
		}


		// -----------------------------------------------------------
		// C. Directional Miss (Both active lines missed)
		// -----------------------------------------------------------

		// If we reached here, the tool is not visible. We must provide the most accurate directional hint.
		// We check the single point's AABB position.

		if (p.price > viewportBounds.maxPrice) return OffScreenState.OffScreenTop;
		if (p.price < viewportBounds.minPrice) return OffScreenState.OffScreenBottom;
		if (p.timestamp < viewportBounds.minTime) return OffScreenState.OffScreenLeft;
		if (p.timestamp > viewportBounds.maxTime) return OffScreenState.OffScreenRight;

		return OffScreenState.FullyOffScreen;
	}


	// Case 2: Two points.
	if (points.length === 2) {
		// No extensions: Use fast AABB check.
		if (!hasExtensions) {
			const toolBounds = getToolBoundingBox(points);
			if (!toolBounds) return OffScreenState.Visible; // Should not happen if points.length > 0

			// Standard AABB culling
			if (toolBounds.minPrice > viewportBounds.maxPrice) return OffScreenState.OffScreenTop;
			if (toolBounds.maxPrice < viewportBounds.minPrice) return OffScreenState.OffScreenBottom;
			if (toolBounds.maxTime < viewportBounds.minTime) return OffScreenState.OffScreenLeft;
			if (toolBounds.minTime > viewportBounds.maxTime) return OffScreenState.OffScreenRight;
			return OffScreenState.Visible;
		}

		// With extensions: This requires the robust geometric check.
		return callTwoPointCuller(points[0], points[1], extendOptions!); // <<< Use the local helper
	}


	// --- Fallback for Multi-Point Tools (Length >= 3, No Culling Info Provided) ---

	// This is the default AABB check for all tools that do not fit the above categories (e.g., 3+ points).
	const toolBounds = getToolBoundingBox(points);
	if (!toolBounds) return OffScreenState.Visible; 

	// Standard AABB culling
	if (toolBounds.minPrice > viewportBounds.maxPrice) return OffScreenState.OffScreenTop;
	if (toolBounds.maxPrice < viewportBounds.minPrice) return OffScreenState.OffScreenBottom;
	if (toolBounds.maxTime < viewportBounds.minTime) return OffScreenState.OffScreenLeft;
	if (toolBounds.minTime > viewportBounds.maxTime) return OffScreenState.OffScreenRight;
	return OffScreenState.Visible;
}


// #endregion Main Culling State Helper