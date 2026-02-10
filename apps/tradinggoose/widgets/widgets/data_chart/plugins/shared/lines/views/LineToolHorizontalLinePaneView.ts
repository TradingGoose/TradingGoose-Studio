// /src/views/LineToolHorizontalLinePaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
	Coordinate,
	LineStyle,
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
	BoxHorizontalAlignment,
	deepCopy,
	PaneCursorType,
	SinglePointOrientation
} from '../../../core';

import { LineToolHorizontalLine } from '../model/LineToolHorizontalLine';


/**
 * Pane View for the Horizontal Line tool.
 *
 * **Tutorial Note on Logic:**
 * Unlike a Trend Line which connects two points, a Horizontal Line is defined by a **Single Point**
 * but renders a line that spans the width of the chart (or specific rays based on extension options).
 *
 * This view is responsible for:
 * 1. calculating the visible start and end X-coordinates of the line.
 * 2. Positioning the text label specifically relative to the visible segment (e.g., aligning text to the right edge of the screen).
 */
export class LineToolHorizontalLinePaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	/**
	 * Internal renderer for the main horizontal line segment.
	 * @protected
	 */
	protected _lineRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();

	/**
	 * Internal renderer for the optional text label.
	 * @protected
	 */
	protected _textRenderer: TextRenderer<HorzScaleItem> = new TextRenderer();

	/**
	 * Initializes the Horizontal Line View.
	 *
	 * @param source - The specific Horizontal Line model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolHorizontalLine<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);
	}

	/**
	 * The core update logic.
	 *
	 * It translates the single logical anchor point into a specific horizontal segment
	 * based on the chart's current width and the tool's extension settings.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'HorizontalLine'>;
 
		if (!options.visible) {
			return;
		}

		const points = this._tool.points(); 
		if (points.length === 0) {
			return;
		}
 
		// --- 1. CULLING IMPLEMENTATION ---

		/**
		 * CULLING CONFIGURATION
		 *
		 * A Horizontal Line is defined by a single point but has infinite horizontal extent.
		 * We define a `singlePointOrientation` to tell the culling engine that this point represents
		 * a line extending infinitely along the X-axis (Time).
		 *
		 * `getToolCullingState` uses this to determine visibility: the tool is only hidden if
		 * the Y-coordinate (Price) is completely off-screen. The X-coordinate is ignored for culling
		 * because the line exists at all times.
		 */
		const singlePointOrientation : SinglePointOrientation = {
			horizontal: true,
			vertical: false,
		}

		// We trust the geometric check to handle all scenarios
		const cullingState = getToolCullingState(points, this._tool as BaseLineTool<HorzScaleItem>, options.line.extend, singlePointOrientation);
		if (cullingState !== OffScreenState.Visible) {
			return; // Exit if culled
		}

		// 2. Coordinate Conversion and Setup
		const hasScreenPoints = this._updatePoints(); 
		if (!hasScreenPoints) {
			return;
		}

		const [anchorPoint] = this._points; // Screen coordinates of the single anchor
        
		// --- 3. Bespoke Logic: Dynamic Horizontal Segment Calculation ---
		
		// The anchor point's X coordinate determines where the line starts/ends if extensions are off.

		/**
		 * SEGMENT CALCULATION
		 *
		 * Since the Model only provides one point (the anchor), we must calculate the
		 * Start (X1) and End (X2) of the line to draw.
		 *
		 * - If `extend.left` is true, X1 is 0.
		 * - If `extend.right` is true, X2 is the full pane width.
		 * - Otherwise, the line starts/stops at the anchor's X position.
		 */
        const anchorX = anchorPoint.x; 
        const lineY = anchorPoint.y;
        
        let startX: Coordinate;
        let endX: Coordinate;

		// --- GET VALIDATED CHART DRAWING WIDTH ---
		// Use the validated method to get the definitive width of the drawing pane of the chart area only.
		//const paneDrawingHeight = this._tool.getChartDrawingHeight();
		const paneDrawingWidth = this._tool.getChartDrawingWidth();


        const { left: extendLeft, right: extendRight } = options.line.extend;
        
        // Calculate the custom startX
        if (extendLeft) {
            // Full extension to the left edge of the pane (X=0)
            startX = 0 as Coordinate;
        } else {
            // No left extension: line starts at the anchor's X position
            startX = anchorX;
        }

        // Calculate the custom endX
        if (extendRight) {
            // Full extension to the right edge of the pane (X=width)
            endX = paneDrawingWidth as Coordinate;
        } else {
            // No right extension: line ends at the anchor's X position
            endX = anchorX;
        }
        
        // Define the two points of the segment to be drawn
        const segmentStart = new AnchorPoint(startX, lineY, 0);
        const segmentEnd = new AnchorPoint(endX, lineY, 0); // PointIndex doesn't matter here

		// --- 4. Line Rendering: SegmentRenderer ---
		
		const lineOptions = deepCopy(options.line) as any;
		lineOptions.join = lineOptions.join || LineJoin.Miter;
		lineOptions.cap = lineOptions.cap || LineCap.Butt;

		/**
		 * LINE RENDERER DATA SETUP
		 *
		 * We construct the data payload for the SegmentRenderer using our manually calculated bounds.
		 * - `points`: The `segmentStart` and `segmentEnd` calculated above (clamped to screen edges).
		 * - `line`: The visual styling options.
		 * - `toolDefault...`: Cursor styles for hit testing.
		 */
		this._lineRenderer.setData({ 
			// Pass the dynamically calculated segment start and end points
			points: [segmentStart, segmentEnd], 
			line: lineOptions as LineOptions,
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		});
		(this._renderer as CompositeRenderer<HorzScaleItem>).append(this._lineRenderer);


		// --- 5. Text Rendering: Bespoke Pivot Calculation ---

		/**
		 * TEXT RENDERING & ALIGNMENT
		 *
		 * Horizontal Lines have special text alignment needs. "Left" alignment usually means
		 * "Left side of the screen", not "Left side of the anchor".
		 *
		 * We calculate a dynamic `textPivotX` based on the visible segment bounds (`minXBound`, `maxXBound`)
		 * calculated earlier. This ensures that if the user aligns text "Right", it sticks to the
		 * right edge of the chart even as the chart scrolls.
		 */
		if (options.text.value) {
			const paneDrawingWidth = this._tool.getChartDrawingWidth(); // Get the true width (W_pane)
			const horizontalAlignment = (options.text.box?.alignment?.horizontal || '').toLowerCase();
			
			// PIVOT BOUNDARY LOGIC
			// The anchor's screen X is the point where the line is 'anchored'
			const anchorX = anchorPoint.x; 

			// Define the X-bounds of the line segment drawn on the screen
			// This is the X-Axis boundary for text placement
			const minXBound = extendLeft ? 0 : anchorX;      // Start at 0 if extended left, otherwise start at anchor
			const maxXBound = extendRight ? paneDrawingWidth : anchorX; // End at W_pane if extended right, otherwise end at anchor

			const segmentWidth = maxXBound - minXBound;
			let textPivotX: Coordinate;

			// Calculate the custom X-pivot based on the alignment and the segment bounds
			switch (horizontalAlignment) {
				case BoxHorizontalAlignment.Left.toLowerCase():
					// Pivot is at the left edge of the segment
					textPivotX = minXBound as Coordinate;
					break;
				case BoxHorizontalAlignment.Right.toLowerCase():
					// Pivot is at the right edge of the segment
					textPivotX = maxXBound as Coordinate;
					break;
				case BoxHorizontalAlignment.Center.toLowerCase():
				default:
					// Pivot is at the center of the segment
					textPivotX = (minXBound + segmentWidth / 2) as Coordinate;
					break;
			}
 
			// The Y-pivot is simply the anchor's Y-coordinate
			const textPivot = new AnchorPoint(textPivotX, anchorPoint.y, 0);

			/**
			 * TEXT RENDERER DATA SETUP
			 *
			 * We construct the data payload for the TextRenderer using the dynamic pivot.
			 * - `points`: We use the calculated `textPivot` point (twice) to anchor the text box.
			 *   This pivot moves dynamically with the screen edges if alignment is set to Left/Right.
			 * - `text`: The full text configuration options.
			 * - `hitTestBackground`: Enabled to allow selecting the tool via the text label.
			 */
			const textRendererData = {
				points: [textPivot, textPivot], // Pass two of the same point for the text bounding box logic
				text: options.text,
				hitTestBackground: true,
				toolDefaultHoverCursor: options.defaultHoverCursor,
				toolDefaultDragCursor: options.defaultDragCursor,
			};

			this._textRenderer.setData(textRendererData);
			(this._renderer as CompositeRenderer<HorzScaleItem>).append(this._textRenderer);
		}


		// 6. Line Anchors (Handles for P1)
		//if (this.areAnchorsVisible()) {
			this._addAnchors(this._renderer as CompositeRenderer<HorzScaleItem>);
		//}
	}	
	
	/**
	 * Adds the single interactive anchor point.
	 *
	 * We use the `VerticalResize` cursor because a Horizontal Line is typically fixed in Time
	 * and only moves up/down in Price.
	 *
	 * @param renderer - The composite renderer to append the anchor to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 1) return;

		const [anchorPoint] = this._points;
 
		// The single anchor point (P1)
		const anchorData = {
			points: [anchorPoint],
			pointsCursorType: [PaneCursorType.VerticalResize], // Vertical resize as it only moves in Price
		};
 
		// Add the single LineAnchorRenderer set
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}