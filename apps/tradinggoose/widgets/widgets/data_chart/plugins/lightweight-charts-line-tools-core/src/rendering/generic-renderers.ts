// /src/rendering/generic-renderers.ts

/**
 * This file contains a collection of generic and reusable canvas renderers for
 * common geometric shapes and text, which can be composited to build complex line tools.
 * Each renderer is designed to be fully configurable via its setData() method.
 */

import { Coordinate, LineStyle, LineWidth } from 'lightweight-charts';
import {
	CanvasRenderingTarget2D,
	MediaCoordinatesRenderingScope,
	IPaneRenderer,
	LineToolHitTestData,
	LineOptions,
	RectangleOptions,
	TextOptions,
	LineEnd,
	HitTestResult,
	HitTestType,
	PaneCursorType,
	TextRendererData,
	BoxHorizontalAlignment,
	BoxVerticalAlignment,
	TextAlignment,
} from '../types';
import {
	drawArrowEnd, drawLine, drawVerticalLine, drawHorizontalLine,
	setLineStyle, drawRoundRect, fillRectWithBorder, drawCircleEnd
} from '../utils/canvas-helpers';
import { ensureNotNull, ensureDefined } from '../utils/helpers';
import { Point, Segment, Box, extendAndClipLineSegment, distanceToSegment, pointInBox, pointInPolygon, rotatePoint, equalPoints } from '../utils/geometry';
import { AnchorPoint } from './line-anchor-renderer'; 
import {
	getBoxHeight,
	getBoxWidth,
	getFontAwareScale,
	getFontSize,
	getScaledBackgroundInflationX,
	getScaledBackgroundInflationY,
	getScaledBoxPaddingX,
	getScaledBoxPaddingY,
	getScaledPadding,
	isRtl,
	textWrap,
	getScaledFontSize,
	isFullyTransparent,
	cacheCanvas,
	createCacheCanvas,
} from '../utils/text-helpers'; 


// Common interaction tolerance for hit-testing lines and borders
const interactionTolerance = {
	line: 4, // Make the line hit-test a bit more forgiving
};

// #region Segment Renderer
// =================================================================================================================
// Used for drawing line segments (like Trend Lines, Rays, Arrows, Parallel Channels, etc.)

/**
 * Data structure required by the {@link SegmentRenderer}.
 *
 * It defines the geometry of a straight line segment, including its two defining points
 * and the complete set of styling options for drawing the line and its end caps.
 */
export interface SegmentRendererData {
	points: [AnchorPoint, AnchorPoint];
	line: LineOptions;
	toolDefaultHoverCursor?: PaneCursorType;
	toolDefaultDragCursor?: PaneCursorType;
}

/**
 * Renders a single straight line segment between two points.
 *
 * This renderer is highly versatile, supporting infinite extensions (Rays, Extended Lines, Horizontal/Vertical Lines),
 * line dashing/styling, and custom end caps (Arrows, Circles). It implements robust hit testing along the line path.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class SegmentRenderer<HorzScaleItem> implements IPaneRenderer {
	private _data: SegmentRendererData | null = null;
	private _mediaSize: { width: number; height: number; } = { width: 0, height: 0 };
	private _hitTest: HitTestResult<LineToolHitTestData>;

	/**
	 * Initializes the Segment Renderer.
	 *
	 * @param hitTest - An optional, pre-configured {@link HitTestResult} template that will be returned on a successful hit.
	 */
	public constructor(hitTest?: HitTestResult<LineToolHitTestData>) {
		this._hitTest = hitTest || new HitTestResult(HitTestType.MovePoint);
	}

	/**
	 * Sets the data payload required to draw and hit-test the segment.
	 *
	 * @param data - The {@link SegmentRendererData} containing the points and styling options.
	 * @returns void
	 */
	public setData(data: SegmentRendererData): void {
		this._data = data;
	}

	/**
	 * Draws the line segment onto the chart pane.
	 *
	 * This method calculates any necessary line extensions or viewport clipping before drawing
	 * the final segment, ensuring that the line stays within the visible area.
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @returns void
	 */	
	public draw(target: CanvasRenderingTarget2D): void {
		if (!this._data || !this._data.points || this._data.points.length < 2) {
			return;
		}

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			this._mediaSize = mediaSize; // Store mediaSize for hitTest
			const { line, points } = this._data!;
			const [point0, point1] = points;

			// Ensure LineWidth is treated as a number for ctx.lineWidth
			const lineWidth: number = line.width as number || 1;
			const lineColor = line.color || 'white';
			const lineStyle = line.style || LineStyle.Solid;

			ctx.lineCap = line.cap || 'butt'; // Apply lineCap from options, default to 'butt'
			ctx.lineJoin = line.join || 'miter'; // Apply lineJoin from options, default to 'miter'
			ctx.strokeStyle = lineColor;
			ctx.lineWidth = lineWidth;

			setLineStyle(ctx, lineStyle);

			// Draw line caps (arrows, circles) based on EndOptions
			// drawArrowEnd and drawCircleEnd assume ctx.lineWidth has been set.
			this._drawEnds(ctx, points, lineWidth, lineStyle); // Pass lineStyle to drawArrowEnd

			// Extend and clip the line segment based on options
			const extendedClippedSegment = extendAndClipLineSegment(
				point0,
				point1,
				mediaSize.width,
				mediaSize.height,
				!!line.extend?.left, // Convert boolean to real boolean
				!!line.extend?.right // Convert boolean to real boolean
			);

			if (extendedClippedSegment !== null && lineWidth > 0) {
				if (extendedClippedSegment instanceof Point) {
					// Segment degenerated to a single point. Do not draw a line.
					return;
				}

				const [start, end] = extendedClippedSegment; // Safe destructuring as it's not a Point

				// Use generic drawLine, which correctly picks solid/dashed
				// drawVerticalLine and drawHorizontalLine do not take style, they are low-level pixel operations
				if (start.x === end.x) {
					drawVerticalLine(ctx, start.x, start.y, end.y);
				} else if (start.y === end.y) {
					drawHorizontalLine(ctx, start.y, start.x, end.x);
				} else {
					drawLine(ctx, start.x, start.y, end.x, end.y, lineStyle);
				}
			}
		});
	}

	/**
	 * Performs a hit test along the entire rendered path of the line segment.
	 *
	 * This includes any extended or clipped portions of the line, providing a large enough
	 * tolerance to make clicking on the line easy.
	 *
	 * @param x - The X coordinate for the hit test.
	 * @param y - The Y coordinate for the hit test.
	 * @returns A {@link HitTestResult} if the coordinates are within the line's tolerance, otherwise `null`.
	 */	
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		if (!this._data || this._data.points.length < 2 || !this._mediaSize.width || !this._mediaSize.height) {
			return null;
		}

		const { line, points, toolDefaultHoverCursor } = this._data;
		const [point0, point1] = points;

		const extendedClippedSegment = extendAndClipLineSegment(
			point0,
			point1,
			this._mediaSize.width,
			this._mediaSize.height,
			!!line.extend?.left,
			!!line.extend?.right
		);

		if (extendedClippedSegment === null) {
			return null;
		}

		if (extendedClippedSegment instanceof Point) {
			if (extendedClippedSegment.subtract(new Point(x, y)).length() <= interactionTolerance.line) {
				const suggestedCursor = toolDefaultHoverCursor || PaneCursorType.Pointer;
				return new HitTestResult(this._hitTest.type(), { pointIndex: null, suggestedCursor });
			}
			return null;
		}

		// If it's a Segment (array of two points), proceed with segment hit-test.
		const [start, end] = extendedClippedSegment;
		if (distanceToSegment(start, end, new Point(x, y)).distance <= interactionTolerance.line) {
			const suggestedCursor = toolDefaultHoverCursor || PaneCursorType.Pointer;
			return new HitTestResult(this._hitTest.type(), { pointIndex: null, suggestedCursor });
		}

		return null;
	}

	/**
	 * Helper method to draw the decorative end caps (Arrow, Circle) specified in the `LineOptions`.
	 *
	 * This is performed before the main line segment to ensure Z-order correctness.
	 *
	 * @param ctx - The CanvasRenderingContext2D.
	 * @param points - The two defining points of the line.
	 * @param width - The line width for sizing the end caps.
	 * @param style - The line style, passed for correct arrow dashing consistency.
	 * @private
	 */
	private _drawEnds(ctx: CanvasRenderingContext2D, points: Point[], width: number, style: LineStyle): void {
		const lineOptions = this._data?.line;
		if (!lineOptions) return;

		// Note: drawArrowEnd needs the style to ensure consistent dashing for the arrow itself.
		if (lineOptions.end?.left === LineEnd.Arrow) {
			drawArrowEnd(points[1], points[0], ctx, width, style);
		} else if (lineOptions.end?.left === LineEnd.Circle) {
			drawCircleEnd(points[0], ctx, width);
		}

		if (lineOptions.end?.right === LineEnd.Arrow) {
			drawArrowEnd(points[0], points[1], ctx, width, style);
		} else if (lineOptions.end?.right === LineEnd.Circle) {
			drawCircleEnd(points[1], ctx, width);
		}
	}
}

// #endregion

// #region Polygon Renderer
// =================================================================================================================
// Used for drawing multi-point shapes that can be filled (like Brush and Path tools)

/**
 * Data structure required by the {@link PolygonRenderer}.
 *
 * It defines a shape or path consisting of multiple points, including the line style
 * for the perimeter and background options for the fill.
 */
export interface PolygonRendererData {
	points: AnchorPoint[];
	line: LineOptions; // Uses complete LineOptions from types.ts
	background?: { color: string }; // Simplified BackgroundOptions for direct color
	hitTestBackground?: boolean;
	toolDefaultHoverCursor?: PaneCursorType;
	toolDefaultDragCursor?: PaneCursorType; 
	enclosePerimeterWithLine?: boolean;
}

/**
 * Renders an open or closed shape/path defined by an array of points.
 *
 * This is used for complex freehand tools like Brush, Highlighter, and Path/Polyline.
 * It supports drawing the line perimeter, filling the background, and defining line end decorations.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class PolygonRenderer<HorzScaleItem> implements IPaneRenderer {
	protected _data: PolygonRendererData | null = null;
	protected _hitTest: HitTestResult<LineToolHitTestData>;
	private _mediaSize: { width: number; height: number; } = { width: 0, height: 0 };

	/**
	 * Initializes the Polygon Renderer.
	 *
	 * @param hitTest - An optional, pre-configured {@link HitTestResult} template that will be returned on a successful hit.
	 */
	public constructor(hitTest?: HitTestResult<LineToolHitTestData>) {
		this._hitTest = hitTest || new HitTestResult(HitTestType.MovePoint);
	}

	/**
	 * Sets the data payload required to draw and hit-test the polygon.
	 *
	 * @param data - The {@link PolygonRendererData} containing the points and styling options.
	 * @returns void
	 */	
	public setData(data: PolygonRendererData): void {
		this._data = data;
	}

	/**
	 * Draws the polygon path, including drawing the background fill and stroking the line perimeter.
	 *
	 * This handles both open paths (Polyline, Brush) and closed shapes (if `enclosePerimeterWithLine` is set).
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @returns void
	 */	
	public draw(target: CanvasRenderingTarget2D): void {
		if (!this._data || !this._data.points || this._data.points.length < 1) { return; }

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			this._mediaSize = mediaSize; // Store mediaSize for hitTest
			const { line, background, points } = this._data!;
			const pointsCount = points.length; // Get points count

			ctx.beginPath();
			ctx.lineCap = line.cap || 'butt'; // Apply lineCap from options
			ctx.lineJoin = line.join || 'miter'; // Apply lineJoin from options
			ctx.lineWidth = line.width as number || 1; // Ensure LineWidth is number
			ctx.strokeStyle = line.color || 'white';
			setLineStyle(ctx, line.style || LineStyle.Solid); // Apply lineStyle

			ctx.moveTo(points[0].x, points[0].y);
			for (const point of points) {
				ctx.lineTo(point.x, point.y);
			}

			if (background?.color) { // Apply background color from options
				ctx.fillStyle = background.color;
				ctx.fill();
			}
			
			if (this._data!.enclosePerimeterWithLine) {
				ctx.closePath(); 
			}

			if (ctx.lineWidth > 0) {
				ctx.stroke();
			}

			// LINE ENDS (ARROWHEAD) START
            if (pointsCount >= 2) {
                const startPoint = points[0];     // P0
                const secondPoint = points[1];    // P1
                const endPoint = points[pointsCount - 1]; // Pn
                const segmentStart = points[pointsCount - 2]; // Pn-1
                const lineWidth = line.width as number || 1;
                const style = line.style || LineStyle.Solid;

                // End of Path (line.end.right) - Pointing at Pn
                if (line.end?.right === LineEnd.Arrow) {
                    // drawArrowEnd(tail, head, ctx, width, style)
                    drawArrowEnd(segmentStart, endPoint, ctx, lineWidth, style);
                } else if (line.end?.right === LineEnd.Circle) {
                    drawCircleEnd(endPoint, ctx, lineWidth);
                }

                // Start of Path (line.end.left) - Pointing at P0
                if (line.end?.left === LineEnd.Arrow) {
                    // drawArrowEnd(tail, head, ctx, width, style) -> Draw arrow pointing from P1 to P0
                    drawArrowEnd(secondPoint, startPoint, ctx, lineWidth, style);
                } else if (line.end?.left === LineEnd.Circle) {
                    drawCircleEnd(startPoint, ctx, lineWidth);
                }
            }
            //LINE ENDS (ARROWHEAD) END		
		});
	}

	/**
	 * Performs a hit test on the polygon's line segments and its optional background fill area.
	 *
	 * For fills, it uses the robust ray casting algorithm (`pointInPolygon`) to check for hits.
	 *
	 * @param x - The X coordinate for the hit test.
	 * @param y - The Y coordinate for the hit test.
	 * @returns A {@link HitTestResult} if the polygon is hit, otherwise `null`.
	 */	
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		if (!this._data || !this._data.points || this._data.points.length < 1 || !this._mediaSize.width || !this._mediaSize.height) {
			return null;
		}

		const point = new Point(x, y);
		const { points, background, hitTestBackground, toolDefaultHoverCursor, toolDefaultDragCursor } = this._data; // NEW: Get default cursors

		// Hit test line segments (perimeter)
		for (let i = 1; i < points.length; i++) {
			if (distanceToSegment(points[i - 1], points[i], point).distance <= interactionTolerance.line) {
				const suggestedCursor = toolDefaultHoverCursor || PaneCursorType.Pointer;
				return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor });
			}
		}
		// Also check from last point to first point to close the shape for hit testing
		if (points.length > 2 && distanceToSegment(points[points.length - 1], points[0], point).distance <= interactionTolerance.line) {
			const suggestedCursor = toolDefaultHoverCursor || PaneCursorType.Pointer;
			return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor });
		}

		// Hit test background
		if (hitTestBackground && background?.color && points.length > 2 && pointInPolygon(point, points)) {
			const suggestedCursor = toolDefaultDragCursor || PaneCursorType.Grabbing;
			return new HitTestResult(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor });
		}

		return null;
	}
}

// #endregion

// #region Rectangle Renderer
// =================================================================================================================
// Used for drawing axis-aligned rectangles (like Rectangle tool, Fib bands, etc.)

/**
 * Data structure required by the {@link RectangleRenderer}.
 *
 * It defines the axis-aligned rectangle via its two defining diagonal points, styling (border/background),
 * and behavior (horizontal extensions for Fibs or Price Range tools).
 */
export interface RectangleRendererData {
	points: [AnchorPoint, AnchorPoint]; // Top-left and bottom-right defining points
	background?: { color: string; inflation?: { x: number; y: number; } }; // Optional background, including inflation
	border?: { color: string; width: number; style: LineStyle; radius?: number | number[]; highlight?: boolean }; // Optional border
	extend?: { left: boolean; right: boolean }; // Optional line extensions
	hitTestBackground?: boolean;
	toolDefaultHoverCursor?: PaneCursorType; // For hovering over border
	toolDefaultDragCursor?: PaneCursorType;  // For dragging background
}

/**
 * Renders an axis-aligned rectangular shape.
 *
 * This renderer is primarily used for the Rectangle drawing tool, as well as for drawing the
 * background fills of range tools like Fib Retracements and Price Ranges.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class RectangleRenderer<HorzScaleItem> implements IPaneRenderer {
	protected _data: RectangleRendererData | null = null;
	private _mediaSize: { width: number; height: number; } = { width: 0, height: 0 };
	private _hitTest: HitTestResult<LineToolHitTestData>;

	/**
	 * Initializes the Rectangle Renderer.
	 *
	 * @param hitTest - An optional, pre-configured {@link HitTestResult} template that will be returned on a successful hit.
	 */	
	public constructor(hitTest?: HitTestResult<LineToolHitTestData>) {
		this._hitTest = hitTest || new HitTestResult(HitTestType.MovePoint);
	}

	/**
	 * Sets the data payload required to draw and hit-test the rectangle.
	 *
	 * @param data - The {@link RectangleRendererData} containing the points and styling options.
	 * @returns void
	 */	
	public setData(data: RectangleRendererData): void {
		this._data = data;
	}

	/**
	 * Draws the rectangle onto the chart pane, handling background fill, borders, and horizontal extensions.
	 *
	 * This relies on the core `fillRectWithBorder` canvas helper for drawing the shape with proper pixel alignment.
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @returns void
	 */	
	public draw(target: CanvasRenderingTarget2D): void {
		if (!this._data || this._data.points.length < 2) return;

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			this._mediaSize = mediaSize; // Store mediaSize for hitTest
			const { border, background, extend, points } = this._data!;
			const [point0, point1] = points;

			const borderWidth: number = border?.width as number || 0;
			const borderColor = border?.color;
			const backgroundColor = background?.color;
			const borderStyle = border?.style || LineStyle.Solid;
			const borderRadius = border?.radius || 0;

			if (borderWidth <= 0 && !backgroundColor) return; // Nothing to draw

			// Call fillRectWithBorder, passing all relevant options
			fillRectWithBorder(
				ctx,
				point0,
				point1,
				backgroundColor,
				borderColor,
				borderWidth,
				borderStyle,
				borderRadius,
				'center', // Border alignment, often 'center' for rects
				!!extend?.left,
				!!extend?.right,
				mediaSize.width
			);
		});
	}

	/**
	 * Performs a hit test on the four border segments and the optional background fill area of the rectangle.
	 *
	 * It correctly accounts for horizontal extensions when checking the top and bottom borders.
	 *
	 * @param x - The X coordinate for the hit test.
	 * @param y - The Y coordinate for the hit test.
	 * @returns A {@link HitTestResult} if the rectangle is hit, otherwise `null`.
	 */	
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {

		//console.log(`[RectangleRenderer] hitTest called at X:${x}, Y:${y}`);

		// FIX: Corrected initial null/data/point length check
		if (!this._data || this._data.points.length < 2 || !this._mediaSize.width || !this._mediaSize.height) {
			return null;
		}

		const { extend, points, hitTestBackground, toolDefaultHoverCursor, toolDefaultDragCursor } = this._data!;
		const [point0, point1] = points;

		// Extract min/max values for coordinates, ensuring they are typed as Coordinate again
		const minX = Math.min(point0.x, point1.x) as Coordinate;
		const maxX = Math.max(point0.x, point1.x) as Coordinate;
		const minY = Math.min(point0.y, point1.y) as Coordinate;
		const maxY = Math.max(point0.y, point1.y) as Coordinate;

		const clickedPoint = new Point(x, y);

		const lineTolerance = interactionTolerance.line;

		// Re-calculate the specific corner points as Coordinates
		const topLeft = new Point(minX, minY);
		const topRight = new Point(maxX, minY);
		const bottomLeft = new Point(minX, maxY);
		const bottomRight = new Point(maxX, maxY);

		// Hit-testing the actual segments of the rectangle's border
		// Note: extend?.left/right are booleans, so the !! conversion is fine.
		// The logic can be simplified by defining temporary points for start/end of segment for hit test.

		// Hit-testing the actual segments of the rectangle's border
		const suggestedHoverCursor = toolDefaultHoverCursor || PaneCursorType.Pointer;

		// Top line: check between (minX, minY) and (maxX, minY), with extension accounted for
		const htTopLeft = new Point(extend?.left ? 0 as Coordinate : minX, minY);
		const htTopRight = new Point(extend?.right ? this._mediaSize.width as Coordinate : maxX, minY);
		if (distanceToSegment(htTopLeft, htTopRight, clickedPoint).distance <= lineTolerance) {
			//console.log(`[RectangleRenderer] *** HIT DETECTED on top border! Suggesting cursor: ${suggestedHoverCursor}`);
			return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor: suggestedHoverCursor });
		}

		// Bottom line: check between (minX, maxY) and (maxX, maxY), with extension accounted for
		const htBottomLeft = new Point(extend?.left ? 0 as Coordinate : minX, maxY);
		const htBottomRight = new Point(extend?.right ? this._mediaSize.width as Coordinate : maxX, maxY);
		if (distanceToSegment(htBottomLeft, htBottomRight, clickedPoint).distance <= lineTolerance) {
			//console.log(`[RectangleRenderer] *** HIT DETECTED on bottom border! Suggesting cursor: ${suggestedHoverCursor}`);
			return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor: suggestedHoverCursor });
		}

		// Left line: check between (minX, minY) and (minX, maxY) (no horizontal extension here for vertical lines)
		if (distanceToSegment(topLeft, bottomLeft, clickedPoint).distance <= lineTolerance) {
			//console.log(`[RectangleRenderer] *** HIT DETECTED on left border! Suggesting cursor: ${suggestedHoverCursor}`);
			return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor: suggestedHoverCursor });
		}

		// Right line: check between (maxX, minY) and (maxX, maxY) (no horizontal extension here for vertical lines)
		if (distanceToSegment(topRight, bottomRight, clickedPoint).distance <= lineTolerance) {
			//console.log(`[RectangleRenderer] *** HIT DETECTED on right border! Suggesting cursor: ${suggestedHoverCursor}`);
			return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor: suggestedHoverCursor });
		}

		// Check if point is inside the rectangle (for background hit)
		// FIX: Corrected Box constructor call to pass two Point objects
		if (hitTestBackground && pointInBox(clickedPoint, new Box(topLeft, bottomRight))) {
			const suggestedDragCursor = toolDefaultDragCursor || PaneCursorType.Grabbing;
			//console.log(`[RectangleRenderer] *** HIT DETECTED on background! Suggesting cursor: ${suggestedDragCursor}`);
			return new HitTestResult(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor: suggestedDragCursor });
		}

		return null;
	}
}

// #endregion

// #region Internal Interfaces for Caching (from V3.8)

/**
 * Internal utility interface to cache calculated information about text lines after word wrapping.
 *
 * @property lines - An array of strings representing the final, wrapped lines of text.
 * @property linesMaxWidth - The pixel width of the longest line of text.
 */
export interface LinesInfo {
	lines: string[];
	linesMaxWidth: number;
}

/**
 * Internal utility interface to cache the computed font metrics.
 *
 * This prevents repeated calculation of the CSS font string and pixel size.
 *
 * @property fontSize - The computed font size in pixels.
 * @property fontStyle - The complete CSS font string (e.g., `'bold 12px sans-serif'`).
 */
export interface FontInfo {
	fontSize: number;
	fontStyle: string;
}

/**
 * Internal utility interface to cache the final pixel dimensions of the text box.
 *
 * This represents the bounding box required to contain the wrapped text content, including
 * padding, inflation, and border width.
 *
 * @property width - The final calculated width of the text box in pixels.
 * @property height - The final calculated height of the text box in pixels.
 */
export interface BoxSize {
	width: number;
	height: number;
}

/**
 * The master internal state cache for the {@link TextRenderer}.
 *
 * Stores all pre-calculated screen coordinates, dimensions, and text alignment values
 * required to draw the text and its box in the correct position relative to the anchor point.
 */
export interface InternalData {
	boxLeft: number;
	boxTop: number;
	boxWidth: number;
	boxHeight: number;
	textStart: number;
	textTop: number;
	textAlign: TextAlignment;
	rotationPivot: Point;
}

// #endregion Internal Interfaces

// #region Text Renderer
// =================================================================================================================
// Used for drawing text labels with boxes, rotation, etc.

/**
 * Renders complex text and its surrounding box.
 *
 * This powerful renderer supports multi-line word wrapping, custom alignment to a parent rectangle,
 * rotation, scaling, borders, background fills, and drop shadows, making it suitable for all text-based tools.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class TextRenderer<HorzScaleItem> implements IPaneRenderer {

	protected _internalData: InternalData | null = null;
	protected _polygonPoints: Point[] | null = null;
	protected _linesInfo: LinesInfo | null = null;
	protected _fontInfo: FontInfo | null = null;
	protected _boxSize: BoxSize | null = null;
	// _data is already present from previous implementation
	protected _data: TextRendererData | null = null;

	protected _hitTest: HitTestResult<LineToolHitTestData>; // Uses LineToolHitTestData now
	private _mediaSize: { width: number; height: number; } = { width: 0, height: 0 }; // Still needed for screen dimensions

	/**
	 * Initializes the Text Renderer.
	 *
	 * @param hitTest - An optional, pre-configured {@link HitTestResult} template.
	 */	
	public constructor(hitTest?: HitTestResult<LineToolHitTestData>) {
		// HitTestResult for MovePoint will be the default for the text box body
		this._hitTest = hitTest || new HitTestResult(HitTestType.MovePoint);
	}

	/**
	 * Sets the data payload required to draw and hit-test the text.
	 *
	 * This method is complex as it includes logic to **invalidate internal caches** (`_linesInfo`, `_boxSize`, etc.)
	 * only when the relevant parts of the new data differ from the old data.
	 *
	 * @param data - The {@link TextRendererData} containing the content and styling.
	 * @returns void
	 */
	public setData(data: TextRendererData): void {
		// eslint-disable-next-line complexity
		function checkUnchanged(before: TextRendererData | null, after: TextRendererData | null): boolean {
			if (null === before || null === after) { return before === after;} // If both null, or one null one not
			if (before.points === undefined !== (after.points === undefined)) { return false; }

			if (before.points !== undefined && after.points !== undefined) {
				if (before.points.length !== after.points.length) { return false; }
				for (let i = 0; i < before.points.length; ++i) {
					if (before.points[i].x !== after.points[i].x || before.points[i].y !== after.points[i].y) { return false; }
				}
			}

			// Perform deep comparison for text options and cursor data
			// This part is crucial for cache invalidation
			return before.text?.forceCalculateMaxLineWidth === after.text?.forceCalculateMaxLineWidth
				&& before.text?.forceTextAlign === after.text?.forceTextAlign
				&& before.text?.wordWrapWidth === after.text?.wordWrapWidth
				&& before.text?.padding === after.text?.padding
				&& before.text?.value === after.text?.value
				&& before.text?.alignment === after.text?.alignment
				&& before.text?.font?.bold === after.text?.font?.bold
				&& before.text?.font?.size === after.text?.font?.size
				&& before.text?.font?.family === after.text?.font?.family
				&& before.text?.font?.italic === after.text?.font?.italic
				&& before.text?.box?.angle === after.text?.box?.angle
				&& before.text?.box?.scale === after.text?.box?.scale
				&& before.text?.box?.offset?.x === after.text?.box?.offset?.x
				&& before.text?.box?.offset?.y === after.text?.box?.offset?.y
				&& before.text?.box?.maxHeight === after.text?.box?.maxHeight
				&& before.text?.box?.padding?.x === after.text?.box?.padding?.x
				&& before.text?.box?.padding?.y === after.text?.box?.padding?.y
				&& before.text?.box?.alignment?.vertical === after.text?.box?.alignment?.vertical
				&& before.text?.box?.alignment?.horizontal === after.text?.box?.alignment?.horizontal
				// Check background inflation (now used)
				&& before.text?.box?.background?.inflation?.x === after.text?.box?.background?.inflation?.x
				&& before.text?.box?.background?.inflation?.y === after.text?.box?.background?.inflation?.y
				// Check border properties (now including radius and highlight)
				&& before.text?.box?.border?.highlight === after.text?.box?.border?.highlight
				&& JSON.stringify(before.text?.box?.border?.radius) === JSON.stringify(after.text?.box?.border?.radius) // For array comparison
				// Check new cursor properties
				&& before.toolDefaultHoverCursor === after.toolDefaultHoverCursor
				&& before.toolDefaultDragCursor === after.toolDefaultDragCursor
				// Check hitTestBackground
				&& before.hitTestBackground === after.hitTestBackground;
		}

		if (checkUnchanged(this._data, data)) {
			this._data = data; // If unchanged, just reassign for reference consistency
		} else {
			this._data = data; // Assign new data
			// Invalidate all caches
			this._polygonPoints = null;
			this._internalData = null;
			this._linesInfo = null;
			this._fontInfo = null;
			this._boxSize = null;
		}
	}

	/**
	 * Performs a hit test on the text box area.
	 *
	 * The logic first checks if the point falls inside the rotated box polygon and then checks proximity
	 * to the box's border segments. A border hit suggests moving the parent tool anchor(s), and an
	 * internal hit suggests dragging the entire text box (translation).
	 *
	 * @param x - The X coordinate for the hit test.
	 * @param y - The Y coordinate for the hit test.
	 * @returns A {@link HitTestResult} if the text box is hit, otherwise `null`.
	 */
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		if (this._data === null || this._data.points === undefined || this._data.points.length === 0) {
			return null;
		}

		const hitPoint = new Point(x, y);
		const { text, toolDefaultHoverCursor, toolDefaultDragCursor, hitTestBackground } = this._data;

		// The calculated polygon points (4 corners of the rotated text box)
		const polygonPoints = this._getPolygonPoints();

		// Check if the point is inside the calculated polygon
		const isInsidePolygon = pointInPolygon(hitPoint, polygonPoints);
		
		// CRUCIAL FIX: Implement Border Hit Test for robustness, especially on zero-area input
		const borderWidth = text.box?.border?.width || 0;
		const borderHitTolerance = 4; // Add a small pixel tolerance for border clicks (e.g. 4px)
		let isNearBorder = false;

		// Check proximity to the four segments of the polygon
		for (let i = 0; i < polygonPoints.length; i++) {
			const p1 = polygonPoints[i];
			const p2 = polygonPoints[(i + 1) % polygonPoints.length];

			// Calculate the distance from the clicked point to the line segment
			const distance = distanceToSegment(p1, p2, hitPoint).distance;

			// If distance is within tolerance, it's a border hit
			if (distance <= borderWidth + borderHitTolerance) {
				isNearBorder = true;
				break;
			}
		}


		// --- Determine Hit Type based on location ---

		// 1. Hit the border (or near it) - This implies moving the line tool itself
		if (isNearBorder) {
			const suggestedCursor = toolDefaultHoverCursor || PaneCursorType.Pointer;
			// Use HitTestType.MovePoint for the border or general hover/drag.
			return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor });
		}
		
		// 2. Hit inside the polygon (background) - This implies dragging the whole tool
		if (isInsidePolygon && hitTestBackground) {
			const suggestedCursor = toolDefaultDragCursor || PaneCursorType.Grabbing;
			// Use HitTestType.MovePointBackground for drag.
			return new HitTestResult(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor });
		}
		

		return null;
	}	

	/**
	 * Calculates and retrieves the final pixel dimensions of the rendered text box.
	 *
	 * @returns The {@link BoxSize} (width and height) of the rendered element.
	 */
	public measure(): BoxSize {
		if (this._data === null) { return { width: 0, height: 0 }; }
		return this._getBoxSize();
	}

	/**
	 * Retrieves the bounding rectangle (x, y, width, height) of the text box in screen coordinates.
	 *
	 * This uses the cached internal data for position and size.
	 *
	 * @returns An object containing the top-left coordinate, width, and height of the bounding box.
	 */	
	public rect(): { x: number; y: number; width: number; height: number; } { // Using a simplified Rect type
		if (this._data === null) { return { x: 0, y: 0, width: 0, height: 0 }; }
		const internalData = this._getInternalData();
		return { x: internalData.boxLeft, y: internalData.boxTop, width: internalData.boxWidth, height: internalData.boxHeight };
	}

	/**
	 * Determines if the entire text box is positioned off-screen.
	 *
	 * This check first uses a simple AABB comparison and then, for more robust culling of rotated boxes,
	 * checks if all four corners of the rotated polygon are outside the viewport.
	 *
	 * @param width - The width of the visible pane area.
	 * @param height - The height of the visible pane area.
	 * @returns `true` if the text box is entirely off-screen, `false` otherwise.
	 */	
	public isOutOfScreen(width: number, height: number): boolean {
		if (null === this._data || void 0 === this._data.points || 0 === this._data.points.length) { return true; }

		const internalData = this._getInternalData();
		if (internalData.boxLeft + internalData.boxWidth < 0 || internalData.boxLeft > width) {
			const screenBox = new Box(new Point(0 as Coordinate, 0 as Coordinate), new Point(width as Coordinate, height as Coordinate));
			return this._getPolygonPoints().every((point: Point) => !pointInBox(point, screenBox));
		}
		return false;
	}

	/**
	 * Retrieves the cached CSS font string used for rendering and measurement (e.g., 'bold 12px sans-serif').
	 *
	 * @returns The computed font style string.
	 */	
	public fontStyle(): string {
		return this._data === null ? '' : this._getFontInfo().fontStyle;
	}

	/**
	 * Executes the word-wrapping logic for a given string, font, and maximum line width.
	 *
	 * This is primarily a proxy for the external `textWrap` utility function.
	 *
	 * @param test - The raw string content to wrap.
	 * @param wrapWidth - The maximum pixel width for a single line before wrapping.
	 * @param font - Optional font string to use for measurement.
	 * @returns An array of strings representing the final, wrapped lines.
	 */	
	public wordWrap(test: string, wrapWidth?: number, font?: string): string[] {
		// Calls the external textWrap helper function
		return textWrap(test, font || this.fontStyle(), wrapWidth);
	}

	/**
	 * Draws the complete text box element onto the chart pane.
	 *
	 * This method:
	 * 1. Saves the canvas context and applies rotation/translation transforms based on the box's configuration.
	 * 2. Draws the shadow, background fill, and border.
	 * 3. Draws each of the wrapped text lines.
	 * 4. Restores the canvas context.
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @returns void
	 */
	public draw(target: CanvasRenderingTarget2D): void {
		if (this._data === null || this._data.points === undefined || this._data.points.length === 0) { return; }

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			this._mediaSize = mediaSize;
			const cssWidth = mediaSize.width;
			const cssHeight = mediaSize.height;

			if (this.isOutOfScreen(cssWidth, cssHeight)) { return; }

			const data = ensureNotNull(this._data); // Ensure _data is not null
			const textData = ensureNotNull(data.text);
			const internalData = this._getInternalData();
			const pivot = internalData.rotationPivot; // Use the stored rotationPivot
			const angleDegrees = textData.box?.angle || 0;
			const angle = -angleDegrees * Math.PI / 180; // Convert to radians, negative for clockwise rotation

			ctx.save(); // Save context before rotation/translation
			ctx.translate(pivot.x, pivot.y);
			ctx.rotate(angle);
			ctx.translate(-pivot.x, -pivot.y);

			// These variables are now ready for use, directly reflecting internalData.boxLeft/Top
			const scaledBoxLeft = internalData.boxLeft;
			const scaledBoxTop = internalData.boxTop;

			const scaledBoxWidth = internalData.boxWidth;
			const scaledBoxHeight = internalData.boxHeight;

			const borderRadius = textData.box?.border?.radius || 0; // Ensure radius is passed
			const boxBorderStyle = textData.box?.border?.style || LineStyle.Solid;

			// --- Shadow, Background, and Border Drawing ---
			// Draw order: Shadow (cast by fill) -> Fill -> Border -> Text

			// 1. Apply shadow properties if they exist and blur/color is set
			let shadowApplied = false; 
			if (textData.box?.shadow) {
				const shadow = textData.box.shadow;
				if (shadow.blur > 0 || !isFullyTransparent(shadow.color)) {
					ctx.shadowColor = shadow.color;
					ctx.shadowBlur = shadow.blur;
					ctx.shadowOffsetX = shadow.offset.x;
					ctx.shadowOffsetY = shadow.offset.y;
					shadowApplied = true;
				}
			}

			// 2. Draw box background (this will cast the shadow)
			if (textData.box?.background?.color && !isFullyTransparent(textData.box.background.color)) {
                ctx.fillStyle = textData.box.background.color;
                drawRoundRect(ctx, scaledBoxLeft, scaledBoxTop, scaledBoxWidth, scaledBoxHeight, borderRadius, boxBorderStyle);
                ctx.fill();
            }

			// 3. Reset shadow properties BEFORE drawing the border, so the border itself doesn't cast a shadow
			// and so the shadow only appears from the filled background.
			if (shadowApplied) { // Only reset if shadow was applied
				ctx.shadowColor = 'transparent';
				ctx.shadowBlur = 0;
				ctx.shadowOffsetX = 0;
				ctx.shadowOffsetY = 0;
			}

			// 4. Draw border
            if ((textData.box?.border?.width || 0) > 0 && textData.box?.border?.color && !isFullyTransparent(textData.box.border.color)) {
                ctx.strokeStyle = textData.box.border.color;
                ctx.lineWidth = textData.box.border.width;
                drawRoundRect(ctx, scaledBoxLeft, scaledBoxTop, scaledBoxWidth, scaledBoxHeight, borderRadius, boxBorderStyle);
                ctx.stroke();
            }

			// Draw text
			ctx.fillStyle = textData.font?.color;
			ctx.font = this._getFontInfo().fontStyle; // Use cached font string
			
			// FIX: Robustly map the stored string enum value to the correct Canvas literal string.
			// This addresses the issue of the tertiary operator failing to correctly resolve the center case.
			const alignValue = internalData.textAlign;
			let canvasAlign: CanvasTextAlign;

			if (alignValue === TextAlignment.Center) {
				canvasAlign = 'center';
			} else if (alignValue === TextAlignment.End || alignValue === TextAlignment.Right) {
				canvasAlign = 'right';
			} else { // Catches TextAlignment.Start, TextAlignment.Left, and any ambiguous default
				canvasAlign = 'left'; 
			}

			ctx.textAlign = canvasAlign; // Apply the explicit alignment
			ctx.textBaseline = 'middle';
			

			const { lines } = this._getLinesInfo();
			const linePadding = getScaledPadding(data);
			const scaledFontSize = getScaledFontSize(data);
			const extraSpace = 0.05 * scaledFontSize;

			// Apply extraSpace to the initial Y position
			let currentTextY = internalData.boxTop + internalData.textTop + extraSpace; // Start Y for first line

			for (const line of lines) {
				const textX = internalData.boxLeft + internalData.textStart; // Text X is always based on box position
				// Draw text with scaling to handle non-integer pixel ratios
				ctx.fillText(line, textX, currentTextY); // No need for drawScaled in V5 media space
				currentTextY += scaledFontSize + linePadding;
			}

			ctx.restore(); // Restore context to remove rotation/translation
		});
	}

	// #region Private/Protected Helper Methods (from V3.8)

	/**
	 * Calculates and caches the master internal state (`InternalData`) for positioning and drawing.
	 *
	 * This is a heavy calculation that:
	 * 1. Determines the final position (`boxLeft`, `boxTop`) based on the tool's anchor points and text box alignment/offset.
	 * 2. Determines the text alignment and start position within the box.
	 * 3. Calculates the `rotationPivot`.
	 *
	 * @returns The cached {@link InternalData} object.
	 * @private
	 */
	private _getInternalData(): InternalData {
		if (this._internalData !== null) { return this._internalData; }

		const data = ensureNotNull(this._data);

		const paddingX = getScaledBoxPaddingX(data);
		const paddingY = getScaledBoxPaddingY(data);
		const inflationPaddingX = getScaledBackgroundInflationX(data) + paddingX;
		const inflationPaddingY = getScaledBackgroundInflationY(data) + paddingY;

		//Check if two points are present but identical.
		const isDegenerate = data.points && data.points.length >= 2 && equalPoints(data.points[0], data.points[1]); 


		// Ensure we have at least one point, which is now expected to be the rectangle's top-left in the pane view context
		// However, for the new logic, we expect two points (rectangle's corners) to calculate parent bounds.
		//console.log('data.points', data.points)

		if (!data.points || data.points.length < 2 || isDegenerate) {
			// Fallback: Treat the first point as the anchor/reference for positioning.
			//console.warn('[TextRenderer] _getInternalData called with less than 2 points or degenerate. Using anchor-based alignment.');
			const boxSize = this._getBoxSize();
			const boxWidth = boxSize.width;
			const boxHeight = boxSize.height;
			const defaultAnchor = data.points && data.points.length > 0 ? data.points[0] : new Point(0 as Coordinate, 0 as Coordinate);

			// Recompute paddings (safe to re-call; mirrors main path)
			const paddingX = getScaledBoxPaddingX(data);
			const paddingY = getScaledBoxPaddingY(data);
			const inflationPaddingX = getScaledBackgroundInflationX(data) + paddingX;
			const inflationPaddingY = getScaledBackgroundInflationY(data) + paddingY;

			// --- Mirror Step 1: refX/Y from "degenerate rectangle" (single point as min=max) ---
			// For degenerate, rect bounds = defaultAnchor (no min/max calc needed)
			let refX: number = defaultAnchor.x as number;
			let refY: number = defaultAnchor.y as number;

			// But for HorizontalLine context, refX is already the desired pivot (0/center/paneWidth from pane view),
			// so no switch needed here—refX is the "attachment point".

			// --- Mirror Step 2: Offset boxLeft/Top from refX/Y based on box.alignment ---
			let textBoxFinalX = refX;
			let textBoxFinalY = refY;

			// Horizontal: Position box left edge relative to refX
			switch ((data.text?.box?.alignment?.horizontal || '').toLowerCase()) {
				case 'left':
					textBoxFinalX = refX; // Left edge at refX, expands right
					break;
				case 'center':
					textBoxFinalX = refX - boxWidth / 2; // Center at refX
					break;
				case 'right':
					textBoxFinalX = refX - boxWidth; // Right edge at refX, expands left
					break;
			}

			// Vertical: Position box top edge relative to refY (unchanged from original)
			switch ((data.text?.box?.alignment?.vertical || '').toLowerCase()) {
				case 'top':
					textBoxFinalY = refY - boxHeight; // Top at refY? Wait, original: Bottom at refY, expands up? No:
					// Per original: For Top: textBoxFinalY = refY - boxHeight (bottom at refY? Wait, clarify:
					// Original Vertical Top: "Bottom edge of text box aligns with refY. It expands up." → textBoxFinalY = refY - boxHeight
					// (Assuming Y increases down; box top at Y - height, bottom at Y)
					break;
				case 'middle':
					textBoxFinalY = refY - boxHeight / 2;
					break;
				case 'bottom':
					textBoxFinalY = refY;
					break;
			}

			// --- Mirror Step 3: Apply offset ---
			textBoxFinalX += (data.text?.box?.offset?.x || 0);
			textBoxFinalY += (data.text?.box?.offset?.y || 0);

			// --- Mirror Step 4: Internal text alignment/textStart (your existing switch) ---
			const rawAlignment = (ensureDefined(data.text?.alignment) || 'start').toLowerCase().trim();
			let textStart: number = inflationPaddingX; // Safe init
			let textAlign: TextAlignment = TextAlignment.Start;

			switch (rawAlignment) {
				case TextAlignment.Start:
				case TextAlignment.Left: {
					// FIX: Always assign TextAlignment.Start to maintain clean enum value.
					textAlign = TextAlignment.Start;
					textStart = inflationPaddingX;
					if (isRtl()) {
						if (data.text?.forceTextAlign) {
							// FIX: Ensure clean enum. Since it's forcing LTR start in RTL, use Start.
							textAlign = TextAlignment.Start; 
						} else {
							textStart = boxWidth - inflationPaddingX;
							// FIX: Use clean enum for RTL end.
							textAlign = TextAlignment.End; 
						}
					}
					break;
				}
				case TextAlignment.Center: {
					// FIX: Always assign TextAlignment.Center.
					textAlign = TextAlignment.Center;
					textStart = boxWidth / 2;
					break;
				}
				case TextAlignment.End:
				case TextAlignment.Right: {
					// FIX: Always assign TextAlignment.End.
					textAlign = TextAlignment.End;
					textStart = boxWidth - inflationPaddingX;
					if (isRtl() && data.text?.forceTextAlign) {
						// FIX: Ensure clean enum. Since it's forcing LTR end in RTL, use End.
						textAlign = TextAlignment.End; 
					}
					break;
				}
				default: {
					console.warn(`[TextRenderer] Unknown text alignment "${data.text?.alignment}" in fallback; defaulting to Start.`);
					textStart = inflationPaddingX;
					// FIX: Explicitly set default to clean enum.
					textAlign = TextAlignment.Start; 
				}
			}

			// Text Y (unchanged)
			const textTop = inflationPaddingY + getScaledFontSize(data) / 2;

			// --- Rotation Pivot: Use ref point (anchor) ---
			const rotationPivot = defaultAnchor;

			this._internalData = {
				boxLeft: textBoxFinalX,
				boxTop: textBoxFinalY,
				boxWidth: boxWidth,
				boxHeight: boxHeight,
				textAlign: textAlign,
				textTop: textTop,
				textStart: textStart,
				rotationPivot: rotationPivot,
			};
			return this._internalData;
		}

		const [rectPointA, rectPointB] = data.points; // These are the two defining points of the parent rectangle
		
		// Calculate the actual bounding box of the parent rectangle
		const rectMinX = Math.min(rectPointA.x, rectPointB.x);
		const rectMaxX = Math.max(rectPointA.x, rectPointB.x);
		const rectMinY = Math.min(rectPointA.y, rectPointB.y);
		const rectMaxY = Math.max(rectPointA.y, rectPointB.y);

		const boxSize = this._getBoxSize();
		const boxWidth = boxSize.width;
		const boxHeight = boxSize.height;

		let refX: number = 0; // Reference point on the parent rectangle for the text box
		let refY: number = 0;

		// --- Step 1: Determine the Reference Point on the Parent Rectangle ---
		switch ((data.text?.box?.alignment?.horizontal || '').toLowerCase()) {
			case BoxHorizontalAlignment.Left:
				refX = rectMinX;
				break;
			case BoxHorizontalAlignment.Center:
				refX = (rectMinX + rectMaxX) / 2;
				break;
			case BoxHorizontalAlignment.Right:
				refX = rectMaxX;
				break;
		}

		switch ((data.text?.box?.alignment?.vertical || '').toLowerCase()) {
			case BoxVerticalAlignment.Top:
				refY = rectMinY;
				break;
			case BoxVerticalAlignment.Middle:
				refY = (rectMinY + rectMaxY) / 2;
				break;
			case BoxVerticalAlignment.Bottom:
				refY = rectMaxY;
				break;
		}

		// --- Store this calculated reference point as the rotation pivot immediately ---
        const rotationPivot = new Point(refX as Coordinate, refY as Coordinate);

		let textBoxFinalX = refX;
		let textBoxFinalY = refY;

		// --- Step 2: Position the Text Box's Top-Left based on its own size and alignment to the Reference Point ---
		switch ((data.text?.box?.alignment?.horizontal || '').toLowerCase()) {
			case BoxHorizontalAlignment.Left:
				// Left edge of text box aligns with refX. It expands right.
				textBoxFinalX = refX;
				break;
			case BoxHorizontalAlignment.Center:
				// Center of text box aligns with refX.
				textBoxFinalX = refX - boxWidth / 2;
				break;
			case BoxHorizontalAlignment.Right:
				// Right edge of text box aligns with refX. It expands left.
				textBoxFinalX = refX - boxWidth;
				break;
		}

		switch ((data.text?.box?.alignment?.vertical || '').toLowerCase()) {
			case BoxVerticalAlignment.Top:
				// Bottom edge of text box aligns with refY. It expands up.
				textBoxFinalY = refY - boxHeight;
				break;
			case BoxVerticalAlignment.Middle:
				// Middle of text box aligns with refY.
				textBoxFinalY = refY - boxHeight / 2;
				break;
			case BoxVerticalAlignment.Bottom:
				// Top edge of text box aligns with refY. It expands down.
				textBoxFinalY = refY;
				break;
		}

		// --- Step 3: Apply `text.box.offset` as a final adjustment ---
		textBoxFinalX += (data.text?.box?.offset?.x || 0);
		textBoxFinalY += (data.text?.box?.offset?.y || 0);


		//let textX = 0; // X position for text rendering relative to textbox left
		//let textAlign = TextAlignment.Start;

		// --- Step 4: Determine internal text alignment within the textbox ---
		const rawAlignment = (ensureDefined(data.text?.alignment) || 'start').toLowerCase().trim(); // Normalize + fallback to 'start' + trim whitespace
		let textX: number = inflationPaddingX; // Safe init: padded left (better than 0)
		let textAlign: TextAlignment = TextAlignment.Start;

		switch (rawAlignment) {
			case 'start':
			case 'left': {
				textAlign = TextAlignment.Start;
				textX = inflationPaddingX;

				if (isRtl()) {
					if (data.text?.forceTextAlign) {
						textAlign = TextAlignment.Start;
					} else {
						textX = boxWidth - inflationPaddingX;
						textAlign = TextAlignment.End;
					}
				}
				break;
			}
			case 'center': {
				textAlign = TextAlignment.Center;
				textX = boxWidth / 2;
				break;
			}
			case 'end':
			case 'right': {
				textAlign = TextAlignment.End;
				textX = boxWidth - inflationPaddingX;

				if (isRtl() && data.text?.forceTextAlign) {
					textAlign = TextAlignment.End;
				}
				break;
			}
			default: {
				// Fallback + log for debugging
				console.warn(`[TextRenderer] Unknown text alignment "${data.text?.alignment}"; defaulting to Start (padded left).`);
				textX = inflationPaddingX;
				// Optionally force center for unknown: textAlign = TextAlignment.Center; textX = boxWidth / 2;
			}
		}

		// Calculate text start Y relative to box top. textBaseline is 'middle'
		const textY = inflationPaddingY + getScaledFontSize(data) / 2;


		this._internalData = {
			boxLeft: textBoxFinalX,
			boxTop: textBoxFinalY,
			boxWidth: boxWidth,
			boxHeight: boxHeight,
			textAlign: textAlign,
			textTop: textY, // Offset from box top to text middle
			textStart: textX, // Offset from box left to text start
			rotationPivot: rotationPivot,
		};

		return this._internalData;
	}

	/**
	 * Calculates the maximum pixel width among all wrapped lines of text.
	 *
	 * If word wrap is configured, this uses the fixed `wordWrapWidth` instead of measuring.
	 *
	 * @param lines - The array of wrapped text strings.
	 * @returns The maximum width in pixels.
	 * @private
	 */	
	private _getLinesMaxWidth(lines: string[]): number {
		const data = ensureNotNull(this._data); // Ensure data is not null for helper functions

		// Use text-helpers' createCacheCanvas and cacheCanvas
		createCacheCanvas();
		const ctx = ensureNotNull(cacheCanvas);
		ctx.font = this.fontStyle(); // Set font for accurate measurement

		if (data.text?.wordWrapWidth && !data.text?.forceCalculateMaxLineWidth) {
			return data.text.wordWrapWidth * getFontAwareScale(data);
		}

		let maxWidth = 0;
		for (const line of lines) {
			maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
		}
		return maxWidth;
	}

	/**
	 * Calculates and caches the {@link LinesInfo} structure.
	 *
	 * This performs the word wrapping, checks for max height constraints (truncating lines if necessary),
	 * and calculates the max line width.
	 *
	 * @returns The cached {@link LinesInfo} object.
	 * @private
	 */	
	private _getLinesInfo(): LinesInfo {
		if (null === this._linesInfo) {
			const data = ensureNotNull(this._data);
			let lines = textWrap(ensureDefined(data.text?.value), this.fontStyle(), data.text?.wordWrapWidth);

			if (data.text?.box?.maxHeight !== undefined && data.text.box.maxHeight > 0) {
				const maxHeight = ensureDefined(data.text?.box?.maxHeight);
				const scaledFontSize = getScaledFontSize(data);
				const scaledPadding = getScaledPadding(data);

				// MODIFIED: Use V3.8's maxHeight calculation for maxLines
				// V3.8: maxLines = Math.floor((maxHeight + scaledPadding) / (scaledFontSize + scaledPadding));
				// This interprets maxHeight as the space *for the content*, and scaledPadding accounts for the space *between* lines.
				// If scaledPadding is 0, this simplifies to maxHeight / scaledFontSize.
				const lineHeightWithSpacing = scaledFontSize + scaledPadding;
				let maxLines: number;
				if (lineHeightWithSpacing > 0) { // Avoid division by zero
					maxLines = Math.floor((maxHeight + scaledPadding) / lineHeightWithSpacing);
				} else {
					maxLines = Infinity; // If no height/spacing per line, assume unlimited lines
				}
				
				if (lines.length > maxLines) {
					lines = lines.slice(0, maxLines); // Truncate lines
				}
			}

			this._linesInfo = { linesMaxWidth: this._getLinesMaxWidth(lines), lines };
		}
		return this._linesInfo;
	}

	/**
	 * Calculates and caches the {@link FontInfo} structure, including the final CSS font string and pixel size.
	 *
	 * This is used once to configure the drawing context and repeatedly for text width measurement.
	 *
	 * @returns The cached {@link FontInfo} object.
	 * @private
	 */	
	private _getFontInfo(): FontInfo {
		if (this._fontInfo === null) {
			const data = ensureNotNull(this._data);
			const fontSize = getScaledFontSize(data);
			const fontStyle = (data.text?.font?.bold ? 'bold ' : '') + (data.text?.font?.italic ? 'italic ' : '') + fontSize + 'px ' + ensureDefined(data.text?.font?.family);
			this._fontInfo = { fontStyle: fontStyle, fontSize: fontSize };
		}
		return this._fontInfo;
	}

	/**
	 * Calculates and caches the total pixel dimensions of the text box.
	 *
	 * This uses the results of `_getLinesInfo` and the configured padding/inflation options.
	 *
	 * @returns The cached {@link BoxSize} object.
	 * @private
	 */	
	private _getBoxSize(): BoxSize {
		if (null === this._boxSize) {
			const linesInfo = this._getLinesInfo();
			const data = ensureNotNull(this._data);
			this._boxSize = {
				width: getBoxWidth(data, linesInfo.linesMaxWidth),
				height: getBoxHeight(data, linesInfo.lines.length),
			};
		}
		return this._boxSize;
	}

	/**
	 * Calculates and caches the four corner points of the rotated text box bounding polygon in screen coordinates.
	 *
	 * This polygon is the basis for accurate hit testing on the rotated element.
	 *
	 * @returns An array of four {@link Point} objects defining the rotated bounding box.
	 * @private
	 */	
	private _getPolygonPoints(): Point[] {
		if (null !== this._polygonPoints) { return this._polygonPoints; }
		if (null === this._data) { return []; }

		const { boxLeft, boxTop, boxWidth, boxHeight } = this._getInternalData();
		const pivot = this._getRotationPoint();
		const angleDegrees = this._data.text?.box?.angle || 0;
		const angle = -angleDegrees * Math.PI / 180; // Convert to radians, negative for clockwise rotation

		this._polygonPoints = [
			rotatePoint(new Point(boxLeft as Coordinate, boxTop as Coordinate), pivot, angle),
			rotatePoint(new Point((boxLeft + boxWidth) as Coordinate, boxTop as Coordinate), pivot, angle),
			rotatePoint(new Point((boxLeft + boxWidth) as Coordinate, (boxTop + boxHeight) as Coordinate), pivot, angle),
			rotatePoint(new Point(boxLeft as Coordinate, (boxTop + boxHeight) as Coordinate), pivot, angle),
		];

		return this._polygonPoints;
	}

	/**
	 * Retrieves the pivot point in screen coordinates around which the text box is rotated.
	 *
	 * This point is calculated and stored in the internal data cache by `_getInternalData`.
	 *
	 * @returns A {@link Point} object representing the rotation pivot.
	 * @private
	 */
	private _getRotationPoint(): Point {
        // After changes in _getInternalData, the 'rotationPivot' already holds the correct
        // conceptual anchor point (e.g., line midpoint, or rectangle center).
        // This method now simply retrieves and returns that stored pivot.
		const internalData = this._getInternalData();
		return internalData.rotationPivot;
	}
	

	
}

// #endregion Private/Protected Helper Methods

// #region Circle Renderer
// =================================================================================================================
// Used for drawing circles (like the Circle tool)

/**
 * Data structure required by the {@link CircleRenderer}.
 *
 * It defines the circle's geometry via two points (Center Point and a point on the Circumference),
 * and includes styling for the background fill and border stroke.
 */
export interface CircleRendererData {
	points: [AnchorPoint, AnchorPoint]; // Point0: center, Point1: a point on circumference
	background?: { color: string };
	border?: { color: string; width: number; style: LineStyle; };
	hitTestBackground?: boolean;
	toolDefaultHoverCursor?: PaneCursorType;
	toolDefaultDragCursor?: PaneCursorType; 
}

/**
 * Renders an arbitrary circle defined by two points.
 *
 * This supports hit testing on both the circle's perimeter (border) and its interior (background fill).
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class CircleRenderer<HorzScaleItem> implements IPaneRenderer {
	protected _data: CircleRendererData | null = null;
	private _mediaSize: { width: number; height: number; } = { width: 0, height: 0 };
	protected _hitTest: HitTestResult<LineToolHitTestData>;

	/**
	 * Initializes the Circle Renderer.
	 *
	 * @param hitTest - An optional, pre-configured {@link HitTestResult} template.
	 */	
	public constructor(hitTest?: HitTestResult<LineToolHitTestData>) {
		this._hitTest = hitTest || new HitTestResult(HitTestType.MovePoint);
		// console.log("CircleRenderer constructor called");
	}

	/**
	 * Sets the data payload required to draw and hit-test the circle.
	 *
	 * @param data - The {@link CircleRendererData} containing the points and styling options.
	 * @returns void
	 */
	public setData(data: CircleRendererData): void {
		this._data = data;
		// console.log("CircleRenderer setData", data);
	}

	/**
	 * Draws the circle onto the chart pane, handling both the background fill and the border stroke.
	 *
	 * The radius is dynamically calculated as the distance between the two input points.
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @returns void
	 */	
	public draw(target: CanvasRenderingTarget2D): void {
		if (!this._data || !this._data.points || this._data.points.length < 2) {
			return;
		}

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			this._mediaSize = mediaSize; // Store mediaSize for hitTest
			const { background, border, points } = this._data!;
			const [point0, point1] = points;

			const centerX = point0.x;
			const centerY = point0.y;
			const radius = point0.subtract(point1).length(); // Distance from center to circumference point

			if (radius <= 0) { // Don't draw if radius is zero or negative
				return;
			}

			// Background fill
			if (background?.color) {
				ctx.fillStyle = background.color;
				ctx.beginPath();
				ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
				ctx.fill();
			}

			// Border stroke
			if (border?.width && border.width > 0 && border.color) {
				ctx.strokeStyle = border.color;
				ctx.lineWidth = border.width as number; // Ensure LineWidth is number
				setLineStyle(ctx, border.style || LineStyle.Solid); // Apply line style
				ctx.beginPath();
				ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
				ctx.stroke();
			}
		});
	}

	/**
	 * Performs a hit test on the circle's perimeter and its optional background fill area.
	 *
	 * Perimeter hit testing uses a tolerance around the calculated radius.
	 *
	 * @param x - The X coordinate for the hit test.
	 * @param y - The Y coordinate for the hit test.
	 * @returns A {@link HitTestResult} if the circle is hit, otherwise `null`.
	 */	
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		if (!this._data || !this._data.points || this._data.points.length < 2 || !this._mediaSize.width || !this._mediaSize.height) {
			return null;
		}

		const { points, hitTestBackground, toolDefaultHoverCursor, toolDefaultDragCursor } = this._data;
		const [point0, point1] = points;

		const clickedPoint = new Point(x, y);
		const centerX = point0.x;
		const centerY = point0.y;
		const radius = point0.subtract(point1).length();

		if (radius <= 0) {
			return null;
		}

		const distanceToCenter = new Point(centerX, centerY).subtract(clickedPoint).length();
		const lineWidth = this._data.border?.width || 0;
		const hitTestTolerance = interactionTolerance.line; // Use general line tolerance

		// Check if point is near the circle's outline (border)
		if (Math.abs(distanceToCenter - radius) <= hitTestTolerance) {
			// NEW: Return LineToolHitTestData with suggestedCursor
			const suggestedCursor = toolDefaultHoverCursor || PaneCursorType.Pointer;
			return new HitTestResult(HitTestType.MovePoint, { pointIndex: null, suggestedCursor });
		}

		// Check if point is inside the circle (for background hit)
		if (hitTestBackground && distanceToCenter < radius) {
			// NEW: Return LineToolHitTestData with suggestedCursor
			const suggestedCursor = toolDefaultDragCursor || PaneCursorType.Grabbing;
			return new HitTestResult(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor });
		}

		return null;
	}
}

// #endregion