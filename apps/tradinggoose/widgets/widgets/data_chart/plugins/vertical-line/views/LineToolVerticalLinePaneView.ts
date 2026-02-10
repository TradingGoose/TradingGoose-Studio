// /src/views/LineToolVerticalLinePaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
	Coordinate,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPaneView,
	CompositeRenderer,
	SegmentRenderer,
	TextRenderer,
	AnchorPoint,
	OffScreenState,
	getToolCullingState,
	LineJoin,
	LineCap,
	LineOptions,
	LineToolOptionsInternal,
	LineToolType,
	deepCopy,
	PaneCursorType,
	BoxHorizontalAlignment,
} from '../../core';

import { LineToolVerticalLine } from '../model/LineToolVerticalLine';


/**
 * Pane View for the Vertical Line tool.
 *
 * **Tutorial Note on Logic:**
 * This view handles the unique requirement of drawing a line that is fixed in Time (X-axis)
 * but infinite in Price (Y-axis).
 *
 * Instead of relying on the renderer's extension logic, this view explicitly calculates
 * the top (Y=0) and bottom (Y=PaneHeight) coordinates of the current viewport and draws
 * a segment between them. This ensures accurate hit-testing and rendering across the full height.
 */
export class LineToolVerticalLinePaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	/**
	 * Internal renderer for the main vertical line segment.
	 * @protected
	 */
	protected _lineRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();

	/**
	 * Internal renderer for the optional text label.
	 * @protected
	 */
	protected _textRenderer: TextRenderer<HorzScaleItem> = new TextRenderer();

	/**
	 * Initializes the Vertical Line View.
	 *
	 * @param source - The specific Vertical Line model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolVerticalLine<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);
	}

	/**
	 * The core update logic.
	 *
	 * It translates the single logical anchor point into a vertical segment spanning the full height
	 * of the chart pane. It also handles the complex logic of rotating text 90 degrees and
	 * re-mapping alignment settings (e.g., "Left" alignment becomes "Bottom" on a vertical line).
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'VerticalLine'>;
 
		if (!options.visible) {
			return;
		}

		const points = this._tool.points(); 
		if (points.length < 1) {
			return;
		}

		// --- GET VALIDATED CHART DRAWING HEIGHT ---
		// Use the validated method to get the definitive height of the drawing pane of the chart area only.
		const paneDrawingHeight = this._tool.getChartDrawingHeight();
		//const paneDrawingWidth = this._tool.getChartDrawingWidth();

		// --- CULLING IMPLEMENTATION START ---
		// We use the single point check, as the tool is conceptually an infinite line.

		/**
		 * CULLING CONFIGURATION
		 *
		 * We treat this as a single point that extends infinitely in the vertical direction.
		 * We pass `{ horizontal: false, vertical: true }` to the culler.
		 * This tells the engine: "Only hide this tool if the X-coordinate (Time) is off-screen."
		 * The Y-coordinate (Price) is ignored for culling because the line spans all prices.
		 */
		const cullingState = getToolCullingState(points, this._tool as BaseLineTool<HorzScaleItem>, options.line.extend, { horizontal: false, vertical: true });
		if (cullingState !== OffScreenState.Visible) {
			//console.log('vertical line culled')
			return; // Exit if culled
		}
		// --- CULLING IMPLEMENTATION END ---

		// 1. Convert the single logical point (P1) to a screen anchor.
		// We can use the base implementation to get the screen coordinate of P1.
		const hasScreenPoints = this._updatePoints(); 
		if (!hasScreenPoints) {
			return;
		}

		const [anchorPoint] = this._points; // Screen coordinates of the single anchor

		// 2. Manufacture two screen points for the vertical segment (P_Top and P_Bottom).
		const lineX = anchorPoint.x; // The X-coordinate is the same for both
		
		/**
		 * SEGMENT CALCULATION
		 *
		 * We manually construct the vertical segment.
		 * - `pTop`: X = anchor, Y = 0 (Top of pane).
		 * - `pBottom`: X = anchor, Y = paneHeight (Bottom of pane).
		 *
		 * This creates a finite segment that covers the exact visible area.
		 */
		const pTop = new AnchorPoint(lineX, 0 as Coordinate, 0); // P_Top (Y=0)
		const pBottom = new AnchorPoint(lineX, paneDrawingHeight as Coordinate, 0); // P_Bottom (Y=paneHeight)

		// The core segment being drawn is between P_Top and P_Bottom.
		const segmentPoints: [AnchorPoint, AnchorPoint] = [pTop, pBottom];

		// --- Setup Renderers ---
		const compositeRenderer = new CompositeRenderer<HorzScaleItem>();

		// 1. Segment Renderer (The Vertical Line itself)
		const lineOptions = deepCopy(options.line) as any;
		lineOptions.join = lineOptions.join || LineJoin.Miter;
		lineOptions.cap = lineOptions.cap || LineCap.Butt;

		// The Vertical Line does not use extension logic in the SegmentRenderer call,
		// as it is already drawn full-pane-height via P_Top and P_Bottom.
		//lineOptions.extend = { left: false, right: false }; 

		/**
		 * LINE RENDERER DATA SETUP
		 *
		 * We configure the `SegmentRenderer` with our manually created vertical segment.
		 * Explicitly defining the start/end points ensures hit-testing works perfectly
		 * from the very top to the very bottom of the chart.
		 */
		this._lineRenderer.setData({ 
			points: segmentPoints, 
			line: lineOptions as LineOptions,
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		});
		compositeRenderer.append(this._lineRenderer);

		// 2. Text Renderer (If applicable - typically not used for a simple vertical line)
		if (options.text.value) {
			
			// --- Conditional Vertical Rotation ---
			// V3.8 behavior: The tool's natural orientation is vertical (90 degrees).
			// We add 90 degrees to the user's defined angle (which is 0 by default).
			// This makes the user's 'angle' setting relative to the vertical axis.
			const userAngle = options.text.box?.angle || 0;
			const textOptions = deepCopy(options.text);
			textOptions.box = { ...textOptions.box, angle: userAngle + 90 };
			// --- End Conditional Rotation ---
			
			// 1. Measure the text box size (Must use the rotated options)
			// Temporarily set data to measure the box's dimensions
			const tempTextRendererData = {
				points: [], // Points not needed for measure
				text: textOptions,
			};
			this._textRenderer.setData(tempTextRendererData);
			const boxDimensions = this._textRenderer.measure(); // { width: unscaled, height: unscaled }
			//console.log('boxDimensions', boxDimensions)

			// --- Text Attachment Point (Pivot) Calculation ---
			
			/**
			 * TEXT ROTATION & ALIGNMENT LOGIC
			 *
			 * Vertical lines have standard text rotated 90 degrees.
			 * 1. **Rotation:** We add 90 degrees to the user's angle setting.
			 * 2. **Alignment Mapping:** Standard "Left/Right" alignment doesn't make sense vertically.
			 *    - "Right" (Forward in time) maps to the **Top** of the screen (Y=0).
			 *    - "Left" (Backward in time) maps to the **Bottom** of the screen (Y=Height).
			 *    - We also apply offsets based on the measured text width (which becomes height after rotation)
			 *      to ensure the text doesn't get cut off at the edges.
			 */
			const textAlignment = options.text.alignment.toLowerCase();
			let textPivotY: Coordinate;

			// We need the measured text box's vertical span for alignment compensation.
			// For vertical alignment (Top/Bottom/Middle), the compensation for text being 
			// cut off at the vertical extremes is based on the box's vertical span.
			// since the text is intially calculated horizontally, and the vertical tool is artificially rotating it, we need
			// to use boxDimensions.width for the rotated boxes heght from the bottom of the screen to the top of the screen.
			const textVerticalSpan = boxDimensions.width;
			const halfVerticalSpan = textVerticalSpan / 2;


			// Check Horizontal Alignment to determine the Y-pivot position along the vertical line
			// This maps the user's X-axis alignment intention (Left/Right) to the vertical Y-axis extremes.
			switch (textAlignment) {
				case BoxHorizontalAlignment.Right.toLowerCase(): 
					// Right (latest/highest) -> Top of screen (Y=0)
					// Shift the center DOWN by half the box's vertical span to prevent cut-off.
					textPivotY = (0 + halfVerticalSpan) as Coordinate; 
					break;
				case BoxHorizontalAlignment.Left.toLowerCase(): 
					// Left (earliest/lowest) -> Bottom of screen (Y=paneDrawingHeight)
					// Shift the center UP by half the box's vertical span to prevent cut-off.
					textPivotY = (paneDrawingHeight - halfVerticalSpan) as Coordinate;
					break;
				case BoxHorizontalAlignment.Center.toLowerCase():
				default:
					// Center -> Center Y-value (for vertical line)
					textPivotY = (paneDrawingHeight / 2) as Coordinate;
					break;
			}

			// Text Attachment Point (X is the line's position, Y is the calculated pivot)
			const textAttachmentPoint = new AnchorPoint(lineX, textPivotY, 0); 

			// 2. Final Data Setup and Render

			/**
			 * TEXT RENDERER DATA SETUP
			 *
			 * - `points`: We use the calculated `textAttachmentPoint` which places the text
			 *   at the correct vertical position along the line.
			 * - `text`: Contains the rotated options.
			 */
			const textRendererData = {
				points: [textAttachmentPoint], // Text anchor is the single point
				text: textOptions, 
				hitTestBackground: true, 
				toolDefaultHoverCursor: options.defaultHoverCursor,
				toolDefaultDragCursor: options.defaultDragCursor,
			};

			this._textRenderer.setData(textRendererData);
			compositeRenderer.append(this._textRenderer);
		}

		// 3. Line Anchors (Handles for P1)
		//if (this.areAnchorsVisible()) {
			this._addAnchors(compositeRenderer);
		//}

		this._renderer = compositeRenderer;
	}
	
	/**
	 * Adds the single interactive anchor point.
	 *
	 * We use the `HorizontalResize` cursor because a Vertical Line is fixed in Price (conceptually)
	 * and only moves Left/Right in Time.
	 *
	 * @param renderer - The composite renderer to append the anchor to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 1) return;

		const [anchorPoint] = this._points;
 
		// The single anchor point (P1) should suggest horizontal movement only
		const anchorData = {
			points: [anchorPoint],
			pointsCursorType: [PaneCursorType.HorizontalResize], // Suggest horizontal resize (ew-resize)
		};
 
		// Add the single LineAnchorRenderer set
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}