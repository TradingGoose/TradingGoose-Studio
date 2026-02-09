// /src/rendering/line-anchor-renderer.ts

import { IChartApiBase, Coordinate, LineStyle } from 'lightweight-charts';
import { HitTestResult, HitTestType } from '../types';
import { Point,  } from '../utils/geometry';
import { merge } from '../utils/helpers';
import { drawRoundRect } from '../utils/canvas-helpers';
import { CanvasRenderingTarget2D, MediaCoordinatesRenderingScope, IPaneRenderer, PaneCursorType, LineToolHitTestData } from '../types';
import { DeepPartial } from '../utils/helpers';


//GOTCHA im having an issue with when hovering over the rectangle perimiter the pointer is one thing, and then i move and hover
// to an anchor, the pointer does not seem to respect the anchors pointer definition. its like a drawing timing issue, or z depth?
//but if i hover off the line then back onto the anchor, then the pointer is correct.  increasing anchor larger does not seem to fix it.
const interactionTolerance = {
    //anchor: 5, // Pixel tolerance for clicking on an anchor
	anchor: 8,
};

/**
 * Extends the base {@link Point} class to include necessary metadata for an interactive anchor handle.
 *
 * This point represents the screen coordinates of a resize/edit handle, along with data
 * about its type, index in the tool's point array, and specific cursor requirements.
 */
export class AnchorPoint extends Point {
	public data: number;
	public square: boolean;
	public specificCursor?: PaneCursorType;

	/**
	 * Initializes a new Anchor Point.
	 *
	 * @param x - The X-coordinate in pixels.
	 * @param y - The Y-coordinate in pixels.
	 * @param data - The index of this point in the parent tool's point array.
	 * @param square - If `true`, the anchor is drawn as a square; otherwise, it is a circle.
	 * @param specificCursor - An optional, specific cursor to display when hovering over this anchor.
	 */
	public constructor(x: number, y: number, data: number, square: boolean = false, specificCursor?: PaneCursorType) { 
		super(x as Coordinate, y as Coordinate);
		this.data = data;
		this.square = square;
		this.specificCursor = specificCursor;
	}

	/**
	 * Creates a deep copy of the anchor point, preserving all metadata.
	 * @returns A new {@link AnchorPoint} instance.
	 */	
	public override clone(): AnchorPoint {
		return new AnchorPoint(this.x, this.y, this.data, this.square, this.specificCursor);
	}
}

/**
 * The data payload required by the {@link LineAnchorRenderer}.
 *
 * This encapsulates the list of anchor points to draw, their colors, styling properties
 * (radius, stroke), and the current interaction state (selected, hovered, editing) to
 * determine which effects to render.
 */
export interface LineAnchorRendererData {
	points: AnchorPoint[];
	backgroundColors: string[];
	pointsCursorType?: PaneCursorType[];
	editedPointIndex: number | null;
	currentPoint: Point; // a.k.a the mouse position
	color: string;
	radius: number;
	strokeWidth: number;
	hoveredStrokeWidth: number;
	selected: boolean;
	visible: boolean;
	hitTestType: HitTestType;
	defaultAnchorHoverCursor?: PaneCursorType;
	defaultAnchorDragCursor?: PaneCursorType; 
}

/**
 * Defines a function signature for drawing the body or shadow of an anchor.
 */
type DrawCallback = (ctx: CanvasRenderingContext2D, point: Point, radius: number, lineWidth: number) => void;

/**
 * Renders the interactive anchor points (resize/edit handles) for a line tool.
 *
 * It draws the small square or circle handles that appear when a tool is selected
 * and performs the highly sensitive hit testing required for dragging these handles.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class LineAnchorRenderer<HorzScaleItem> implements IPaneRenderer {
	/**
	 * Internal data payload.
	 * @internal
	 */
	protected _data: LineAnchorRendererData | null = null;
	private _chart: IChartApiBase<HorzScaleItem>;

	/**
	 * Initializes the Anchor Renderer.
	 *
	 * @param chart - The Lightweight Charts chart API instance (for context/API access).
	 * @param data - Optional initial {@link LineAnchorRendererData} to set.
	 */	
	public constructor(chart: IChartApiBase<HorzScaleItem>, data?: LineAnchorRendererData) {
		this._chart = chart;
		this._data = data ?? null;
	}

	/**
	 * Overwrites the entire data payload for the renderer.
	 * @param data - The new {@link LineAnchorRendererData}.
	 * @returns void
	 */	
	public setData(data: LineAnchorRendererData): void {
		this._data = data;
	}

	/**
	 * Partially updates the current data payload by merging a set of changes.
	 * @param data - A partial update object for the {@link LineAnchorRendererData}.
	 * @returns void
	 */	
	public updateData(data: Partial<LineAnchorRendererData>): void {
		if(this._data) {
			this._data = merge(this._data as DeepPartial<LineAnchorRendererData>, data) as LineAnchorRendererData;
		}
	}

	/**
	 * Draws all configured anchor points (circles or squares) onto the chart pane.
	 *
	 * It uses helper drawing functions (`drawCircleBody`, `drawRectBody`) to render
	 * the main handle and applies special effects (shadows/halos) if the anchor is hovered.
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @returns void
	 */	
	public draw(target: CanvasRenderingTarget2D): void {
		if (!this._data || !this._data.visible) {
			return;
		}

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			const squarePoints: AnchorPoint[] = [];
			const squareColors: string[] = [];
			const circlePoints: AnchorPoint[] = [];
			const circleColors: string[] = [];
	
			for (let e = 0; e < this._data!.points.length; ++e) {
				const point = this._data!.points[e];
				const color = this._data!.backgroundColors[e];
				if (point.square) {
					squarePoints.push(point);
					squareColors.push(color);
				} else {
					circlePoints.push(point);
					circleColors.push(color);
				}
			}
	
			ctx.strokeStyle = this._data!.color;
	
			if (squarePoints.length) {
				this._drawPoints(ctx, squarePoints, squareColors, drawRectBody, drawRectShadow);
			}
	
			if (circlePoints.length) {
				this._drawPoints(ctx, circlePoints, circleColors, drawCircleBody, drawCircleShadow);
			}
		});
	}

	/**
	 * Performs a hit test specifically over the anchor points.
	 *
	 * This logic uses an augmented radius (`this._data.radius + interactionTolerance.anchor`)
	 * to create a larger, forgiving target area for the user to click/drag.
	 * It determines the specific anchor index hit and the appropriate cursor type (e.g., 'resize').
	 *
	 * @param x - The X coordinate for the hit test.
	 * @param y - The Y coordinate for the hit test.
	 * @returns A {@link HitTestResult} containing the anchor index and cursor, or `null`.
	 */	
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		
		// [FIX] Allow hit-testing even if visually hidden (unselected).
		// This allows the user to find the anchor (resize cursor) even if they haven't 
		// clicked the tool to select it yet.
		if (this._data === null) {
			return null;
		}

		const position = new Point(x, y);
		
		// Define the hit threshold once (Radius + Tolerance)
		// Ensure 'interactionTolerance.anchor' is defined at the top of your file (e.g., set to 8 or 10)
		const hitThreshold = this._data.radius + interactionTolerance.anchor;

		for (let i = 0; i < this._data.points.length; ++i) {
			const point = this._data.points[i];
			
			// Calculate distance from mouse to anchor center
			const distance = point.subtract(position).length();

			// Check distance against the calculated threshold
			if (distance <= hitThreshold) {
				
				// Determine the suggested cursor based on hierarchy
				let suggestedCursor: PaneCursorType = PaneCursorType.Default;

				// Priority 1: Specific cursor defined on the individual anchor point (e.g., nwse-resize)
				if (point.specificCursor) {
					suggestedCursor = point.specificCursor;
				}
				// Priority 2: Default anchor hover cursor defined for the whole tool
				else if (this._data.defaultAnchorHoverCursor) {
					suggestedCursor = this._data.defaultAnchorHoverCursor;
				}
				// Priority 3: Fallback for ChangePoint hit type (standard resize)
				else if (this._data.hitTestType === HitTestType.ChangePoint) {
					suggestedCursor = PaneCursorType.DiagonalNwSeResize;
				}
				// Priority 4: Generic pointer fallback
				else {
					suggestedCursor = PaneCursorType.Pointer;
				}

				const pointIndex = point.data;

				// Return the hit result immediately
				return new HitTestResult(this._data.hitTestType, { pointIndex, suggestedCursor });
			}
		}
		return null;
	}	

	/**
	 * Internal helper to iterate over a list of points (either circles or squares) and draw their bodies and hover shadows.
	 *
	 * This abstracts the logic for drawing the shape itself (`drawBody`) and applying the hover effect (`drawShadow`).
	 *
	 * @param ctx - The CanvasRenderingContext2D.
	 * @param points - The array of {@link AnchorPoint}s to draw.
	 * @param colors - The array of corresponding background colors.
	 * @param drawBody - The callback function to draw the main body of the shape.
	 * @param drawShadow - The callback function to draw the hover shadow/halo.
	 * @private
	 */
	private _drawPoints(ctx: CanvasRenderingContext2D, points: AnchorPoint[], colors: string[], drawBody: DrawCallback, drawShadow: DrawCallback): void {
		const data = this._data!;
		const currentPoint = data.currentPoint;

		let lineWidth = Math.max(1, Math.floor(data.strokeWidth || 2));
		if (data.selected) {
			lineWidth += 1;
		}
		
		const radius = data.radius * 2; // Make radius bigger for better visibility
		
		for (let d = 0; d < points.length; ++d) {
			const point = points[d];
			ctx.fillStyle = colors[d];

			if (!(Number.isInteger(point.data) && data.editedPointIndex === point.data)) {
				drawBody(ctx, point, radius / 2, lineWidth);
				if (point.subtract(currentPoint).length() <= data.radius + interactionTolerance.anchor) {
					const hoveredLineWidth = Math.max(1, data.hoveredStrokeWidth);
					drawShadow(ctx, point, radius / 2, hoveredLineWidth);
				}
			}
		}
	}
}

/**
 * Draws the path for a rectangular anchor handle.
 *
 * This function calculates the correct dimensions to center the rectangle path around the point
 * while accounting for the border line width.
 *
 * @param ctx - The CanvasRenderingContext2D.
 * @param point - The center {@link Point} of the rectangle.
 * @param radius - The base size of the anchor (half-width/height).
 * @param lineWidth - The stroke width for the border.
 * @returns void
 */
function drawRect(ctx: CanvasRenderingContext2D, point: Point, radius: number, lineWidth: number): void {
	ctx.lineWidth = lineWidth;
	const n = radius + lineWidth / 2;
	drawRoundRect(ctx, point.x - n, point.y - n, 2 * n, 2 * n, (radius + lineWidth) / 2, LineStyle.Solid); 
	ctx.closePath();
}

/**
 * Draws the hover shadow/halo for a rectangular anchor handle.
 *
 * It uses a reduced alpha value to create a semi-transparent border effect.
 *
 * @param ctx - The CanvasRenderingContext2D.
 * @param point - The center {@link Point} of the anchor.
 * @param radius - The base size of the anchor.
 * @param lineWidth - The width of the shadow line.
 * @returns void
 */
function drawRectShadow(ctx: CanvasRenderingContext2D, point: Point, radius: number, lineWidth: number): void {
	ctx.globalAlpha = 0.2;
	drawRect(ctx, point, radius, lineWidth);
	ctx.stroke();
	ctx.globalAlpha = 1;
}

/**
 * Draws the main filled body and stroke of a rectangular anchor handle.
 *
 * @param ctx - The CanvasRenderingContext2D.
 * @param point - The center {@link Point} of the anchor.
 * @param radius - The base size of the anchor.
 * @param lineWidth - The stroke width for the border.
 * @returns void
 */
function drawRectBody(ctx: CanvasRenderingContext2D, point: Point, radius: number, lineWidth: number): void {
	drawRect(ctx, point, radius - lineWidth, lineWidth);
	ctx.fill();
	ctx.stroke();
}

/**
 * Draws the hover shadow/halo for a circular anchor handle.
 *
 * It uses a reduced alpha value to create a semi-transparent border effect.
 *
 * @param ctx - The CanvasRenderingContext2D.
 * @param point - The center {@link Point} of the anchor.
 * @param radius - The base size of the anchor.
 * @param lineWidth - The width of the shadow line.
 * @returns void
 */
function drawCircleShadow(ctx: CanvasRenderingContext2D, point: Point, radius: number, lineWidth: number): void {
	ctx.lineWidth = lineWidth;
	ctx.globalAlpha = 0.2;
	ctx.beginPath();
	ctx.arc(point.x, point.y, radius + lineWidth / 2, 0, 2 * Math.PI, true);
	ctx.closePath();
	ctx.stroke();
	ctx.globalAlpha = 1;
}

/**
 * Draws the main filled body and stroke of a circular anchor handle.
 *
 * @param ctx - The CanvasRenderingContext2D.
 * @param point - The center {@link Point} of the anchor.
 * @param radius - The base size of the anchor.
 * @param lineWidth - The stroke width for the border.
 * @returns void
 */
function drawCircleBody(ctx: CanvasRenderingContext2D, point: Point, radius: number, lineWidth: number): void {
	ctx.lineWidth = lineWidth;
	ctx.beginPath();
	ctx.arc(point.x, point.y, radius - lineWidth / 2, 0, 2 * Math.PI, true);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
}