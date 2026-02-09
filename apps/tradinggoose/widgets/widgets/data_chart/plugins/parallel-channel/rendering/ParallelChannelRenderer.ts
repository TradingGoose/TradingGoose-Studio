// src/rendering/ParallelChannelRenderer.ts

import {
	IPaneRenderer,
	CanvasRenderingTarget2D,
	MediaCoordinatesRenderingScope,
	LineToolHitTestData,
	HitTestResult,
	HitTestType,
	PaneCursorType,
	// Core Imports
	Point,
	Box,
	lineThroughPoints,
	distanceToSegment,
	pointInPolygon,
	Line,
	extendAndClipLineSegment,
	// Core Canvas Helpers
	setLineStyle,
	drawLine,
	AnchorPoint,
	LineOptions,
	ExtendOptions,
	ensureNotNull,
	ensureDefined,
	clipPolygonToViewport,
} from '../../core';

import { Coordinate, LineStyle } from 'lightweight-charts';



// Common tolerance for line hit-testing
const HIT_TEST_TOLERANCE = 4;

/**
 * Data structure required by the {@link ParallelChannelRenderer}.
 *
 * It contains the 3 defining screen points (P0, P1, P2) and the full styling configuration
 * for the channel borders, middle line, and background fill.
 */
export interface ParallelChannelRendererData {
	points: [Point, Point, Point]; // P0, P1, P2 (screen coordinates)
	channelLine: { width: number; color: string; style: LineStyle };
	middleLine: { width: number; color: string; style: LineStyle };
	showMiddleLine: boolean;
	extend: ExtendOptions;
	background?: { color: string };
	hitTestBackground?: boolean;
	toolDefaultHoverCursor?: PaneCursorType;
	toolDefaultDragCursor?: PaneCursorType;
}

/**
 * Custom Renderer for the Parallel Channel tool.
 *
 * **Tutorial Note on Rendering:**
 * This renderer is responsible for:
 * 1. **Geometry Derivation:** Calculating the 4th corner (P3) based on the parallel relationship.
 * 2. **Infinite Fill:** Calculating a massive "Placeholder Polygon" that extends off-screen if `extend` is enabled,
 *    and then clipping it to the viewport to creating the effect of an infinite fill.
 * 3. **Line Drawing:** Drawing the Top, Bottom, and Middle lines with their specific styles (Solid/Dashed).
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class ParallelChannelRenderer<HorzScaleItem> implements IPaneRenderer {
	private _data: ParallelChannelRendererData | null = null;
	private _mediaSize: { width: number; height: number; } = { width: 0, height: 0 };
	private _hitTestLine: HitTestResult<LineToolHitTestData>;
	private _hitTestBackground: HitTestResult<LineToolHitTestData>;

	/**
	 * Initializes the Parallel Channel Renderer.
	 *
	 * Sets up reusable `HitTestResult` templates for Line hits (Pointer cursor) and Background hits (Grabbing cursor).
	 */
	public constructor() {
		this._hitTestLine = new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor: PaneCursorType.Pointer });
		this._hitTestBackground = new HitTestResult(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor: PaneCursorType.Grabbing });
	}

	/**
	 * Sets the data payload required to draw.
	 *
	 * @param data - The {@link ParallelChannelRendererData} containing points and styles.
	 * @returns void
	 */
	public setData(data: ParallelChannelRendererData): void {
		this._data = data;
	}

	/**
	 * Draws the complete Parallel Channel.
	 *
	 * **Algorithm:**
	 * 1. Calculate P3.
	 * 2. Construct a "Mega Polygon" that extends well beyond the screen boundaries if the channel is extended.
	 * 3. Clip that polygon to the viewport using `clipPolygonToViewport` to generate the fill shape.
	 * 4. Draw the fill.
	 * 5. Draw the 3 line segments (Top, Bottom, Middle), handling their individual extensions via `extendAndClipLineSegment`.
	 *
	 * @param target - The canvas target.
	 * @returns void
	 */
	public draw(target: CanvasRenderingTarget2D): void {
		if (!this._data || !this._data.points || this._data.points.length < 3) {
			return;
		}

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			this._mediaSize = mediaSize;
			const [p0, p1, p2] = this._data!.points;
			const { width: W, height: H } = mediaSize;
			const { extend, channelLine, middleLine, showMiddleLine } = this._data!;

			/**
			 * 1. GEOMETRY DERIVATION (P3)
			 *
			 * A Parallel Channel is a parallelogram. P3 is derived such that the vector P2->P3
			 * is identical to P0->P1.
			 */
			const p1MinusP0 = p1.subtract(p0);
			const p3 = p2.add(p1MinusP0);
            
            // 2. --- Calculate Dynamic Margin for Placeholder Polygon ---
            
            /**
             * 2. INFINITE FILL STRATEGY (DYNAMIC MARGIN)
             *
             * To render an "infinite" fill, we cannot just draw to infinity.
             * We calculate a "Far Off" distance based on the viewport's diagonal length.
             * This ensures that no matter the angle, the edges of our placeholder polygon
             * are well outside the visible area.
             */
            const SAFETY_BUFFER = 100;
            
            // Calculate the length of the viewport diagonal (Guaranteed max length for any on-screen line)
            const diagonalLength = Math.sqrt(W * W + H * H);
            
            // The Margin must be at least the diagonal + a buffer
            const MARGIN = diagonalLength + SAFETY_BUFFER;

            // Define the far-off coordinates based on the margin
            const X_FAR_LEFT = 0 - MARGIN;
            const X_FAR_RIGHT = W + MARGIN;
            
            // 3. Define Line Equations (y = mx + b)
            /**
             * 3. LINE EQUATIONS
             *
             * We calculate the slope (`m`) and y-intercept (`b`) for the Top and Bottom lines.
             * These are used to project the corner points to the "Far Off" X-coordinates calculated above.
             */
            const lineTop = lineThroughPoints(p0, p1);
            const lineBottom = lineThroughPoints(p2, p3);

            // Guard against degenerate lines (p0=p1 or p2=p3)
            if (lineTop === null || lineBottom === null) {
                return; // Cannot draw or fill a channel with a zero-length segment
            }

            // Note: Error handling for vertical lines (line.b === 0) is omitted for brevity...
            const m_top = -lineTop.a / lineTop.b; // slope
            const b_top = -lineTop.c / lineTop.b; // y-intercept
            
            const m_bottom = -lineBottom.a / lineBottom.b;
            const b_bottom = -lineBottom.c / lineBottom.b;

            // 4. --- Calculate the 4 Vertices of the Initial Placeholder Polygon ---
            
            // Start with the four core points
			/**
             * 4. POLYGON CONSTRUCTION
             *
             * We construct the 4 vertices of the fill polygon.
             * - If extended, we replace the actual corners (P0, P1, etc.) with the projected points
             *   at `X_FAR_LEFT` and `X_FAR_RIGHT`.
             * - If not extended, we use the actual screen points.
             */
            let p_start_top = p0;
            let p_end_top = p1;
            let p_start_bottom = p2;
            let p_end_bottom = p3;
            
            // Apply extension only if the slope is defined (i.e., not a perfectly vertical line)
            // AND only if the line is NOT perfectly vertical (to avoid Infinity from line.b === 0)
            if (lineTop.b !== 0) { 
                if (extend.left) {
                    p_start_top = new Point(X_FAR_LEFT as Coordinate, (m_top * X_FAR_LEFT + b_top) as Coordinate);
                    p_start_bottom = new Point(X_FAR_LEFT as Coordinate, (m_bottom * X_FAR_LEFT + b_bottom) as Coordinate);
                }

                if (extend.right) {
                    p_end_top = new Point(X_FAR_RIGHT as Coordinate, (m_top * X_FAR_RIGHT + b_top) as Coordinate);
                    p_end_bottom = new Point(X_FAR_RIGHT as Coordinate, (m_bottom * X_FAR_RIGHT + b_bottom) as Coordinate);
                }
            }
            
            const initialPolygon = [ p_start_top, p_end_top, p_end_bottom, p_start_bottom ];
            
            // 5. Clip this large polygon to the actual screen boundaries (The Final Crop)
			/**
             * 5. POLYGON CLIPPING (THE CROP)
             *
             * Drawing the massive polygon directly can cause rendering artifacts or performance issues.
             * We use `clipPolygonToViewport` (Sutherland-Hodgman algorithm) to slice the polygon
             * exactly at the screen edges. This results in a clean, drawable shape.
             */
            const clippedFillPolygon = clipPolygonToViewport(initialPolygon, W, H);
            
            
			// --- Draw Background Fill ---
			if (this._data!.background?.color && clippedFillPolygon && clippedFillPolygon.length >= 3) {
				
                ctx.save();
                ctx.fillStyle = this._data!.background.color;

                // Draw the clipped polygon (which should now fill the gap correctly)
                ctx.beginPath();
                ctx.moveTo(clippedFillPolygon[0].x, clippedFillPolygon[0].y);
                for(let i = 1; i < clippedFillPolygon.length; i++) {
                    ctx.lineTo(clippedFillPolygon[i].x, clippedFillPolygon[i].y);
                }
                ctx.closePath();
                ctx.fill();
                ctx.restore();
			}


			// --- Draw Lines (Uses existing segment clipping logic) ---

            // A. Base Line (P0 to P1)
			/**
             * DRAW BASE LINE (P0-P1)
             *
             * We calculate and draw the top segment (Base Line).
             * We use `extendAndClipLineSegment` to handle infinite extensions if configured.
             */
            const topSegment = extendAndClipLineSegment(p0, p1, W, H, extend.left, extend.right);
            if (topSegment && !(topSegment instanceof Point)) {
                const [topLeft, topRight] = topSegment;
                ctx.save();
                ctx.lineWidth = channelLine.width;
                ctx.strokeStyle = channelLine.color;
                setLineStyle(ctx, channelLine.style);
                drawLine(ctx, topLeft.x, topLeft.y, topRight.x, topRight.y, channelLine.style);
                ctx.restore();
            }

            // B. Parallel Line (P2 to P3)
			/**
             * DRAW PARALLEL LINE (P2-P3)
             *
             * We calculate and draw the bottom segment.
             * This line is mathematically parallel to the base line and passes through P2.
             */
            const bottomSegment = extendAndClipLineSegment(p2, p3, W, H, extend.left, extend.right);
            if (bottomSegment && !(bottomSegment instanceof Point)) {
                const [bottomLeft, bottomRight] = bottomSegment;
                ctx.save();
                ctx.lineWidth = channelLine.width;
                ctx.strokeStyle = channelLine.color;
                setLineStyle(ctx, channelLine.style);
                drawLine(ctx, bottomLeft.x, bottomLeft.y, bottomRight.x, bottomRight.y, channelLine.style);
                ctx.restore();
            }

            // C. Middle Line (Midpoint P0P2 to Midpoint P1P3)
			/**
             * DRAW MIDDLE LINE
             *
             * If enabled, we calculate the geometric center line.
             * Logic: Midpoint(P0, P2) to Midpoint(P1, P3).
             */
            if (showMiddleLine) {
                const mid0 = p0.add(p2).scaled(0.5);
                const mid1 = p1.add(p3).scaled(0.5);
                
                // The middle line must also be clipped/extended
                const midSegment = extendAndClipLineSegment(mid0, mid1, W, H, extend.left, extend.right);

                if (midSegment && !(midSegment instanceof Point)) {
                    const [midStart, midEnd] = midSegment;
                    ctx.save();
                    ctx.lineWidth = middleLine.width;
                    ctx.strokeStyle = middleLine.color;
                    setLineStyle(ctx, middleLine.style);
                    drawLine(ctx, midStart.x, midStart.y, midEnd.x, midEnd.y, middleLine.style);
                    ctx.restore();
                }
            }
		});
	}

	/**
	 * Performs a hit test on the channel.
	 *
	 * **Priority Order:**
	 * 1. **Lines:** Checks if the mouse is close to the Base, Parallel, or Middle lines. (Cursor: Pointer).
	 * 2. **Background:** Checks if the mouse is inside the filled area. (Cursor: Grabbing).
	 *
	 * This logic mirrors the `draw` method's geometry calculations to ensure the hit area
	 * matches the visual area exactly.
	 *
	 * @param x - X coordinate.
	 * @param y - Y coordinate.
	 * @returns A hit result, or `null`.
	 */
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		if (!this._data || this._data.points.length < 3) {
			return null;
		}
 
		const [p0, p1, p2] = this._data.points;
		const { extend, channelLine, middleLine, showMiddleLine } = this._data!;

		// 1. Calculate the Derived 4th Point (P3)
		const p1MinusP0 = p1.subtract(p0);
		const p3 = p2.add(p1MinusP0);
		const point = new Point(x, y);

		const { width: W, height: H } = this._mediaSize;
        
        // Safety check: ensure mediaSize has been set by a prior draw() call
        if (W === 0 || H === 0) return null;


        // Helper to check line hit (for Base, Parallel, and Middle lines)
		/**
         * HIT TEST HELPER
         *
         * A utility function to check if the mouse is within `HIT_TEST_TOLERANCE` of a line segment.
         * It handles the complex logic of extending and clipping the line to the viewport
         * before measuring distance, ensuring accurate hits even on parts of the line
         * that are far from the defining points.
         */
        const checkLine = (pA: Point, pB: Point, cursor: PaneCursorType): HitTestResult<LineToolHitTestData> | null => {
            
            // Clip the segment exactly as in draw()
            const segmentOrPoint = extendAndClipLineSegment(pA, pB, W, H, extend.left, extend.right);
            
            if (segmentOrPoint === null || segmentOrPoint instanceof Point) return null;

            const [start, end] = segmentOrPoint;
 
            if (distanceToSegment(start, end, point).distance <= HIT_TEST_TOLERANCE) {
                const suggestedCursor = this._data!.toolDefaultHoverCursor || cursor;
                return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor });
            }
            return null;
        };


		// --- A. Line Hit Tests (Priority over Background) ---

		// 1. Check Base Line (P0-P1)
		let hit = checkLine(p0, p1, PaneCursorType.Pointer);
		if (hit) return hit;

		// 2. Check Parallel Line (P2-P3)
		hit = checkLine(p2, p3, PaneCursorType.Pointer);
		if (hit) return hit;
 
		// 3. Check Middle Line (Midpoints)
		if (showMiddleLine) {
			const mid0 = p0.add(p2).scaled(0.5);
			const mid1 = p1.add(p3).scaled(0.5);
			hit = checkLine(mid0, mid1, PaneCursorType.Pointer);
			if (hit) return hit;
		}

		// --- B. Background Hit Test (Must mirror draw logic) ---
		/**
		 * BACKGROUND HIT TEST
		 *
		 * We reconstruct the exact same clipped polygon used in `draw()` and use `pointInPolygon`
		 * to check if the mouse is inside.
		 */
		if (this._data!.hitTestBackground && this._data!.background?.color) {

            // 1. --- Calculate Dynamic Margin for Placeholder Polygon (Mirroring draw) ---
            const SAFETY_BUFFER = 100;
            const MARGIN = Math.sqrt(W * W + H * H) + SAFETY_BUFFER;

            const X_FAR_LEFT = 0 - MARGIN;
            const X_FAR_RIGHT = W + MARGIN;
            
			// 2. Define Line Equations (Mirroring draw)
			const lineTop = lineThroughPoints(p0, p1);
			const lineBottom = lineThroughPoints(p2, p3);

			// --- FIX: Guard against degenerate lines ---
			if (lineTop === null || lineBottom === null) {
				return null; // Cannot perform hit test on a zero-length line
			}

			const m_top = -lineTop.a / lineTop.b; 
			const b_top = -lineTop.c / lineTop.b; 
			
			const m_bottom = -lineBottom.a / lineBottom.b;
			const b_bottom = -lineBottom.c / lineBottom.b;

			// 3. --- Calculate the 4 Vertices of the Initial Placeholder Polygon ---
			let p_start_top = p0;
			let p_end_top = p1;
			let p_start_bottom = p2;
			let p_end_bottom = p3;
			
			if (lineTop.b !== 0) { // Check if the line is not perfectly vertical
				if (extend.left) {
					p_start_top = new Point(X_FAR_LEFT as Coordinate, (m_top * X_FAR_LEFT + b_top) as Coordinate);
					p_start_bottom = new Point(X_FAR_LEFT as Coordinate, (m_bottom * X_FAR_LEFT + b_bottom) as Coordinate);
				}

				if (extend.right) {
					p_end_top = new Point(X_FAR_RIGHT as Coordinate, (m_top * X_FAR_RIGHT + b_top) as Coordinate);
					p_end_bottom = new Point(X_FAR_RIGHT as Coordinate, (m_bottom * X_FAR_RIGHT + b_bottom) as Coordinate);
				}
			}
            
            const initialPolygon = [ p_start_top, p_end_top, p_end_bottom, p_start_bottom ];
            
            // 4. Clip this large polygon to the actual screen boundaries
			/**
             * POLYGON CLIPPING (HIT TEST)
             *
             * To check if the mouse is "inside" the infinite channel, we must recreate the exact
             * clipped polygon used in the `draw` method. We clip the infinite coordinates to the
             * viewport dimensions so `pointInPolygon` has a finite shape to test against.
             */
            const clippedFillPolygon = clipPolygonToViewport(initialPolygon, W, H);
            
            // 5. Perform the hit test on the final clipped polygon
			if (clippedFillPolygon && pointInPolygon(point, clippedFillPolygon)) {
				const suggestedCursor = this._data!.toolDefaultDragCursor || PaneCursorType.Grabbing;
				return new HitTestResult(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor });
			}
		}

		return null;
	}

	/**
	 * Helper to draw a single line segment with extension logic.
	 *
	 * Wraps `extendAndClipLineSegment` and the canvas drawing calls into one utility
	 * to avoid code duplication for the Top, Bottom, and Middle lines.
	 *
	 * @private
	 */
	private _drawLine(
		ctx: CanvasRenderingContext2D,
		pA: Point,
		pB: Point,
		options: { width: number; color: string; style: LineStyle },
		extend: { left: boolean; right: boolean },
		W: number,
		H: number
	): void {
		const segmentOrPoint = extendAndClipLineSegment(pA, pB, W, H, extend.left, extend.right);
		
		if (segmentOrPoint instanceof Point) return;
		if (segmentOrPoint === null) return;

		const [start, end] = segmentOrPoint;

		ctx.save();
		ctx.lineWidth = options.width;
		ctx.strokeStyle = options.color;
		setLineStyle(ctx, options.style);

		drawLine(ctx, start.x, start.y, end.x, end.y, options.style);

		ctx.restore();
	}
}