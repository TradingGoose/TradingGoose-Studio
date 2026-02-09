// /src/utils/canvas-helpers.ts

/**
 * This file contains lower-level canvas drawing utilities adapted from the
 * Lightweight Charts V3.8 build's 'renderers' and 'helpers/canvas-helpers'
 * to be reusable components within our plugin.
 */

// Point,  and Segment are now our locally defined types from utils/geometry.ts.
import { LineStyle } from 'lightweight-charts';
import { Point, Segment } from './geometry'; 

// #region Basic Canvas Operations (adapted from V3.8 helpers/canvas-helpers.ts)

/**
 * Clears a specific rectangular area on the canvas and fills it immediately with a solid color.
 * 
 * This function uses the `copy` global composite operation to replace existing pixels
 * entirely, which is often more performant or predictable than using `clearRect` followed by `fillRect`
 * in layering scenarios.
 *
 * @param ctx - The canvas rendering context to draw on.
 * @param x - The x-coordinate of the top-left corner of the rectangle.
 * @param y - The y-coordinate of the top-left corner of the rectangle.
 * @param w - The width of the rectangle in pixels.
 * @param h - The height of the rectangle in pixels.
 * @param clearColor - The CSS color string to fill the cleared area with (e.g., '#FFFFFF' or 'rgba(0,0,0,0)').
 */
export function clearRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, clearColor: string): void {
	ctx.save();
	ctx.globalCompositeOperation = 'copy';
	ctx.fillStyle = clearColor;
	ctx.fillRect(x, y, w, h);
	ctx.restore();
}

/**
 * Clears a specific rectangular area on the canvas and fills it with a vertical linear gradient.
 * 
 * Similar to {@link clearRect}, this uses the `copy` composite operation. It creates a gradient
 * spanning from the top (`y`) to the bottom (`y + h`) of the specified area.
 *
 * @param ctx - The canvas rendering context to draw on.
 * @param x - The x-coordinate of the top-left corner of the rectangle.
 * @param y - The y-coordinate of the top-left corner of the rectangle.
 * @param w - The width of the rectangle in pixels.
 * @param h - The height of the rectangle in pixels.
 * @param topColor - The CSS color string for the start (top) of the gradient.
 * @param bottomColor - The CSS color string for the end (bottom) of the gradient.
 */
export function clearRectWithGradient(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, topColor: string, bottomColor: string): void {
	ctx.save();
	ctx.globalCompositeOperation = 'copy';
	const gradient = ctx.createLinearGradient(0, 0, 0, h);
	gradient.addColorStop(0, topColor);
	gradient.addColorStop(1, bottomColor);
	ctx.fillStyle = gradient;
	ctx.fillRect(x, y, w, h);
	ctx.restore();
}

// #endregion

// #region Line Styles and Drawing (adapted from V3.8 renderers/draw-line.ts)

/**
 * Calculates the specific line dash array pattern for a given `LineStyle`.
 * 
 * This helper maps abstract style enums (like `LineStyle.Dashed` or `LineStyle.SparseDotted`)
 * into the concrete numerical arrays required by the HTML5 Canvas API's `setLineDash`.
 * The pattern is scaled relative to the current line width of the context to ensure visual consistency.
 *
 * @param ctx - The canvas rendering context (used to retrieve the current `lineWidth`).
 * @param style - The `LineStyle` enum value to convert.
 * @returns An array of numbers representing the dash pattern (segments and gaps), or an empty array for solid lines.
 */
export function computeDashPattern(ctx: CanvasRenderingContext2D, style: LineStyle): number[] {
	switch (style) {
		case LineStyle.Solid: return [];
		case LineStyle.Dotted: return [ctx.lineWidth, ctx.lineWidth];
		case LineStyle.Dashed: return [2 * ctx.lineWidth, 2 * ctx.lineWidth];
		case LineStyle.LargeDashed: return [6 * ctx.lineWidth, 6 * ctx.lineWidth];
		case LineStyle.SparseDotted: return [ctx.lineWidth, 4 * ctx.lineWidth];
		default: return [];
	}
}

/**
 * Applies a specific dash pattern to the canvas rendering context.
 * 
 * This low-level wrapper ensures compatibility across different browser implementations,
 * handling standard `setLineDash` as well as legacy vendor-prefixed properties
 * (`mozDash`, `webkitLineDash`) if necessary.
 *
 * @param ctx - The canvas rendering context to configure.
 * @param dashPattern - The array of numbers representing distances to alternately draw a line and a gap.
 */
export function setLineDash(ctx: CanvasRenderingContext2D, dashPattern: number[]): void {
	if (ctx.setLineDash) {
		ctx.setLineDash(dashPattern);
	} else {
		// Fallback for older browsers (mozDash and webkitLineDash were non-standard)
		// Note: We need to cast to any to access these non-standard properties.
		(ctx as any).mozDash = dashPattern;
		(ctx as any).webkitLineDash = dashPattern;
	}
}

/**
 * Configures the canvas context with the dash pattern corresponding to a specific `LineStyle`.
 * 
 * This is a high-level utility that combines {@link computeDashPattern} and {@link setLineDash}.
 * It also resets the `lineDashOffset` to 0 to ensure the pattern starts cleanly at the beginning of the path.
 *
 * @param ctx - The canvas rendering context to configure.
 * @param style - The `LineStyle` enum value to apply.
 */
export function setLineStyle(ctx: CanvasRenderingContext2D, style: LineStyle): void {
	ctx.lineDashOffset = 0;
	const dashPattern = computeDashPattern(ctx, style); 
	setLineDash(ctx, dashPattern);
}

/**
 * Calculates a scaling multiplier for line decorations (such as arrows or circles) based on the line's width.
 * 
 * This utility helps maintain visual balance; as lines get thicker, the decoration size multiplier
 * typically decreases to prevent end caps from becoming disproportionately large.
 *
 * @param lineWidth - The width of the line in pixels.
 * @returns A numeric multiplier to be applied to the base decoration size.
 */
export function computeEndLineSize(lineWidth: number): number {
	switch (lineWidth) {
		case 1: return 3.5;
		case 2: return 2;
		case 3: return 1.5;
		case 4: return 1.25;
		default: return 1; // For other widths, use 1
	}
}

/**
 * Draws a pixel-perfect horizontal line on the canvas.
 * 
 * This function applies a 0.5-pixel correction offset if the context's line width is odd (e.g., 1px).
 * This "pixel snapping" ensures the line renders sharply on the pixel grid rather than blurring across two pixel rows.
 *
 * @param ctx - The canvas rendering context.
 * @param y - The y-coordinate for the line position.
 * @param left - The starting x-coordinate.
 * @param right - The ending x-coordinate.
 */
export function drawHorizontalLine(ctx: CanvasRenderingContext2D, y: number, left: number, right: number): void {
	ctx.beginPath();
	const correction = (ctx.lineWidth % 2) ? 0.5 : 0; // Pixel snapping
	ctx.moveTo(left, y + correction);
	ctx.lineTo(right, y + correction);
	ctx.stroke();
}

/**
 * Draws a pixel-perfect vertical line on the canvas.
 * 
 * Similar to {@link drawHorizontalLine}, this function applies a 0.5-pixel correction offset
 * if the context's line width is odd, ensuring the line renders sharply on the pixel grid.
 *
 * @param ctx - The canvas rendering context.
 * @param x - The x-coordinate for the line position.
 * @param top - The starting y-coordinate.
 * @param bottom - The ending y-coordinate.
 */
export function drawVerticalLine(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number): void {
	ctx.beginPath();
	const correction = (ctx.lineWidth % 2) ? 0.5 : 0; // Pixel snapping
	ctx.moveTo(x + correction, top);
	ctx.lineTo(x + correction, bottom);
	ctx.stroke();
}

/**
 * Draws a line segment between two points using the specified `LineStyle`.
 * 
 * This is the primary general-purpose line drawing function. It includes safety checks for finite coordinates
 * and automatically delegates to {@link drawDashedLine} or {@link drawSolidLine} based on the style provided.
 *
 * @param ctx - The canvas rendering context.
 * @param x1 - The x-coordinate of the start point.
 * @param y1 - The y-coordinate of the start point.
 * @param x2 - The x-coordinate of the end point.
 * @param y2 - The y-coordinate of the end point.
 * @param style - The `LineStyle` to apply (Solid, Dashed, Dotted, etc.).
 */
export function drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, style: LineStyle): void {
	if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) { return; }
	if (style !== LineStyle.Solid) {
		drawDashedLine(ctx, x1, y1, x2, y2, style); // FIX: Pass style explicitly
	} else {
		drawSolidLine(ctx, x1, y1, x2, y2);
	}
}

/**
 * Draws a standard solid line path between two points.
 * 
 * This is a performance-optimized primitive for drawing lines when the style is known to be `LineStyle.Solid`.
 * It assumes the line style/dash has already been handled or cleared by the caller (see {@link setLineStyle}).
 *
 * @param ctx - The canvas rendering context.
 * @param x1 - The x-coordinate of the start point.
 * @param y1 - The y-coordinate of the start point.
 * @param x2 - The x-coordinate of the end point.
 * @param y2 - The y-coordinate of the end point.
 */
export function drawSolidLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
}


/**
 * Draws a dashed or dotted line segment between two points.
 *
 * This function handles the context state management required for dashed lines.
 * It saves the context, applies the specific `LineStyle` (dash pattern), draws the path,
 * and then restores the context to prevent the dash pattern from leaking into subsequent operations.
 *
 * @param ctx - The canvas rendering context.
 * @param x1 - The x-coordinate of the start point.
 * @param y1 - The y-coordinate of the start point.
 * @param x2 - The x-coordinate of the end point.
 * @param y2 - The y-coordinate of the end point.
 * @param style - The `LineStyle` defining the dash pattern (e.g., Dashed, Dotted).
 */
export function drawDashedLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, style: LineStyle): void {
	ctx.save();
	ctx.beginPath();
	setLineStyle(ctx, style); // FIX: Pass style explicitly
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
	ctx.restore();
}

/**
 * Draws a solid circular decoration at the end of a line.
 *
 * This is typically used for "dot" line endings. The circle's size is automatically scaled
 * relative to the line width using {@link computeEndLineSize}. The circle is filled with
 * the current stroke color of the context.
 *
 * @param point - The center {@link Point} of the circle.
 * @param ctx - The canvas rendering context.
 * @param width - The width of the line this end decoration is attached to (used for scaling).
 */
export function drawCircleEnd(point: Point, ctx: CanvasRenderingContext2D, width: number): void {
	const circleEndMultiplier = computeEndLineSize(width);
	ctx.save();
	ctx.fillStyle = ctx.strokeStyle; // Use current stroke color for fill
	ctx.beginPath();
	ctx.arc(point.x, point.y, width * circleEndMultiplier, 0, 2 * Math.PI, false);
	ctx.fill();
	ctx.restore();
}

/**
 * Calculates the geometric line segments required to draw an arrowhead.
 *
 * This function computes the vector geometry for a standard arrow shape pointing from `point0` to `point1`.
 * It scales the arrow size based on the provided line width and ensures the arrow is not drawn
 * if the line segment is too short to support it.
 *
 * @param point0 - The base (tail) point of the direction vector.
 * @param point1 - The tip (head) point of the arrow.
 * @param width - The width of the line (used for scaling the arrow head).
 * @returns An array of {@link Segment}s that form the arrow shape, or an empty array if the line is too short.
 */
export function getArrowPoints(point0: Point, point1: Point, width: number): Segment[] {
    const r = 0.5 * width;
    const n = Math.sqrt(2);
    const o = point1.subtract(point0);
    const a = o.normalized();
    const arrowheadMultiplier = computeEndLineSize(width);
    const l = 5 * width * arrowheadMultiplier;
    const c = 1 * r;

    // Check if the arrow is too small to draw meaningful points
    if (o.length() < l * 0.1) { // Adjusted threshold for very short lines
        return []; 
    }

    const h = a.scaled(l);
    const d = point1.subtract(h);
    const u = a.transposed();
    const p = 1 * l; // Arrowhead spread multiplier
    const z = u.scaled(p);
    const m = d.add(z);
    const g = d.subtract(z);
    // f and v are for minor adjustments to the points to make the arrow look sharper,
    // assuming they are proportional to c (which is based on r and width)
    const f = m.subtract(point1).normalized().scaled(c);
    const v = g.subtract(point1).normalized().scaled(c);
    const S = point1.add(f); // Adjusted point m
    const y = point1.add(v); // Adjusted point g
    
    // Additional points for the base of the arrow to make it look robust
    const b_val = r * (n - 1);
    const w = u.scaled(b_val);
    const C_val = Math.min(l - r / n, r * n * 1); // Clamp length based on line width
    const P = a.scaled(C_val);
    const T = point1.subtract(P).subtract(w); // Base point 1 (tail)
    const x_val = point1.subtract(P).add(w); // Base point 2 (tail)
    
    return [[m, S], [g, y], [T, x_val]]; // The three segments forming the arrow
}

/**
 * Draws an arrow decoration at the end of a line segment.
 *
 * This function utilizes {@link getArrowPoints} to determine the geometry and then renders
 * the arrow using {@link drawLine}. This ensures that the arrow head itself respects the
 * dash style of the parent line (e.g., a dashed line has a dashed arrow head).
 *
 * @param point0 - The base (tail) point of the direction vector.
 * @param point1 - The tip (head) point where the arrow will be drawn.
 * @param ctx - The canvas rendering context.
 * @param width - The width of the line.
 * @param style - The `LineStyle` to apply to the arrow geometry.
 */
export function drawArrowEnd(point0: Point, point1: Point, ctx: CanvasRenderingContext2D, width: number, style: LineStyle): void {
	if (point1.subtract(point0).length() < 1) { return; }
	const arrowPoints = getArrowPoints(point0, point1, width);
	for (const segment of arrowPoints) {
		drawLine(ctx, segment[0].x, segment[0].y, segment[1].x, segment[1].y, style); // FIX: Pass style explicitly
	}
}

// #endregion

// #region Rectangles & Borders (adapted from V3.8 renderers/draw-rect.ts)

/**
 * Internal helper that generates the path for a rounded rectangle on the canvas context.
 * 
 * This function handles the logic of drawing line segments and circular arcs (`arcTo`) 
 * for each corner based on the provided radii. It does not stroke or fill; it only 
 * traces the path.
 *
 * @param ctx - The canvas rendering context.
 * @param x - The x-coordinate of the top-left corner.
 * @param y - The y-coordinate of the top-left corner.
 * @param w - The width of the rectangle.
 * @param h - The height of the rectangle.
 * @param radii - A tuple `[TL, TR, BR, BL]` specifying the radius for each corner.
 */
function drawPathRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii: [number, number, number, number]): void {
	ctx.beginPath();
	ctx.moveTo(x + radii[0], y);
	ctx.lineTo(x + w - radii[1], y);
	if (radii[1] !== 0) { ctx.arcTo(x + w, y, x + w, y + radii[1], radii[1]); }
	ctx.lineTo(x + w, y + h - radii[2]);
	if (radii[2] !== 0) { ctx.arcTo(x + w, y + h, x + w - radii[2], y + h, radii[2]); }
	ctx.lineTo(x + radii[3], y + h);
	if (radii[3] !== 0) { ctx.arcTo(x, y + h, x, y + h - radii[3], radii[3]); }
	ctx.lineTo(x, y + radii[0]);
	if (radii[0] !== 0) { ctx.arcTo(x, y, x + radii[0], y, radii[0]); }
	ctx.closePath();
}

/**
 * Draws the outline (stroke) of a rectangle with rounded corners.
 *
 * This function supports flexible corner radius definitions. You can provide a single number for uniform
 * corners, or an array to specify distinct radii for the top-left, top-right, bottom-right, and bottom-left corners.
 *
 * @param ctx - The canvas rendering context.
 * @param x - The x-coordinate of the top-left corner.
 * @param y - The y-coordinate of the top-left corner.
 * @param width - The width of the rectangle.
 * @param height - The height of the rectangle.
 * @param radius - The border radius. Can be a number (all corners) or an array `[TL, TR, BR, BL]`.
 * @param borderStyle - The `LineStyle` to use for the border stroke.
 */
export function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number | number[], borderStyle: LineStyle): void {
	let r: [number, number, number, number];
	if (Array.isArray(radius)) {
		// V3.8 had a [radiusX, radiusY] case for length 2, but for simplicity,
		// and to align with CSS-like standard, we'll map length 2 to [TR, TL, BR, BL] for now, or just map to all corners same if we consider x and y radius.
		// For now, let's assume if it's 2, it means [topLeftBottomRight, topRightBottomLeft]
		if (radius.length === 2) { // Assuming [top-left/bottom-right, top-right/bottom-left] or some interpretation
			r = [radius[0], radius[1], radius[0], radius[1]];
		}
		else if (radius.length === 4) {
			r = radius as [number, number, number, number];
		}
		else {
			console.warn('Invalid radius array length. Expected 1, 2, or 4 elements. Defaulting to 0.');
			r = [0, 0, 0, 0]; // Invalid, revert to no radius
		}
	} else {
		r = [radius, radius, radius, radius];
	}
	
	drawPathRoundRect(ctx, x, y, width, height, r);
	setLineStyle(ctx, borderStyle);
	ctx.stroke();
}

/**
 * A comprehensive utility to draw a filled rectangle with an optional border, rounded corners, and infinite horizontal extensions.
 *
 * This function handles complex geometry, including:
 * - Normalizing coordinate bounds (min/max).
 * - Extending the rectangle to the edges of the container (left/right).
 * - Aligning the border stroke (inner, outer, or center) to ensure crisp pixel rendering.
 * - Filling and stroking with distinct colors and styles.
 *
 * @param ctx - The canvas rendering context.
 * @param point0 - The first defining point of the rectangle (any corner).
 * @param point1 - The second defining point of the rectangle (opposite corner).
 * @param backgroundColor - The fill color (optional).
 * @param borderColor - The stroke color (optional).
 * @param borderWidth - The width of the border stroke.
 * @param borderStyle - The `LineStyle` of the border.
 * @param radius - The corner radius (number or array of 4 numbers).
 * @param borderAlign - The alignment of the border relative to the path: `'inner'`, `'outer'`, or `'center'`.
 * @param extendLeft - If `true`, the rectangle extends infinitely to the left (x=0).
 * @param extendRight - If `true`, the rectangle extends infinitely to the right (x=containerWidth).
 * @param containerWidth - The total width of the drawing area (used for extension).
 */
export function fillRectWithBorder(
	ctx: CanvasRenderingContext2D,
	point0: Point,
	point1: Point,
	backgroundColor: string | undefined,
	borderColor: string | undefined,
	borderWidth: number = 0,
	borderStyle: LineStyle,
	radius: number | number[], // NEW PARAMETER
	borderAlign: 'outer' | 'center' | 'inner',
	extendLeft: boolean,
	extendRight: boolean,
	containerWidth: number // The actual width of the drawing area.
): void {
	// FIX START: Geometric Normalization
	// Determine the true geometric bounds (Left/Right/Top/Bottom) regardless of point order.
	const minX = Math.min(point0.x, point1.x);
	const maxX = Math.max(point0.x, point1.x);
	const minY = Math.min(point0.y, point1.y);
	const maxY = Math.max(point0.y, point1.y);

	// Apply extensions to the geometric bounds
	const x1 = extendLeft ? 0 : minX;
	const x2 = extendRight ? containerWidth : maxX;
	const y1 = minY;
	// const y2 = maxY; // Not needed for drawing, used for height calculation

	const width = x2 - x1;
	const height = maxY - minY;
	// FIX END

	// Prepare radii for fill path
	let fillRadii: [number, number, number, number];
	if (Array.isArray(radius)) {
		if (radius.length === 2) {
			fillRadii = [radius[0], radius[1], radius[0], radius[1]];
		} else if (radius.length === 4) {
			fillRadii = radius as [number, number, number, number];
		} else {
			fillRadii = [0, 0, 0, 0];
		}
	} else {
		fillRadii = [radius, radius, radius, radius];
	}

	// Fill background
	if (backgroundColor !== undefined) {
		ctx.fillStyle = backgroundColor;
		// Use drawPathRoundRect for fill to support rounded corners
		drawPathRoundRect(ctx, x1, y1, width, height, fillRadii);
		ctx.fill();
	}

	// Draw border
	if (borderColor !== undefined && borderWidth > 0) {
		setLineStyle(ctx, borderStyle || LineStyle.Solid);

		let offsetLeft = 0;
		let offsetRight = 0;
		let offsetTop = 0;
		let offsetBottom = 0;

		switch (borderAlign) {
			case 'outer':
				offsetLeft = -borderWidth / 2;
				offsetRight = borderWidth / 2;
				offsetTop = -borderWidth / 2;
				offsetBottom = borderWidth / 2;
				break;
			case 'center':
				// Ensure pixel snapping for center-aligned borders
				offsetLeft = -borderWidth / 2;
				offsetRight = borderWidth / 2;
				offsetTop = -borderWidth / 2;
				offsetBottom = borderWidth / 2;
				break;
			case 'inner':
				offsetLeft = borderWidth / 2;
				offsetRight = -borderWidth / 2;
				offsetTop = borderWidth / 2;
				offsetBottom = -borderWidth / 2;
				break;
		}

		ctx.lineWidth = borderWidth;
		ctx.strokeStyle = borderColor;

		// Use drawPathRoundRect for border stroke
		drawPathRoundRect(ctx, x1 + offsetLeft, y1 + offsetTop, width - offsetLeft + offsetRight, height - offsetTop + offsetBottom, fillRadii);
		ctx.stroke();
	}
}

// #endregion