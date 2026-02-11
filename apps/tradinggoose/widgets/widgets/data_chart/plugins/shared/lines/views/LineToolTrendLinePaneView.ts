// /src/views/LineToolTrendLinePaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
	LineStyle,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolOptionsInternal,
	LineToolTrendLineOptions,
	LineToolPaneView,
	CompositeRenderer,
	LineAnchorRenderer,
	SegmentRenderer,
	TextRenderer,
	AnchorPoint,
	OffScreenState,
	getToolCullingState,
	deepCopy,
	TextRendererData,
	PaneCursorType,
	LineJoin,
	LineCap,
	LineOptions,
	BoxHorizontalAlignment,
} from '../../../core';
import { LineToolTrendLine } from '../model/LineToolTrendLine';
import { ensureNotNull, IPrimitivePaneRenderer } from '../../../core';



/**
 * The specific Pane View implementation for the Trend Line tool.
 *
 * **Tutorial Note on Views:**
 * This class demonstrates the standard responsibility of a Pane View in the plugin architecture:
 * 1. **Data Conversion:** It translates the Model's logical points (Time/Price) into Screen points (X/Y pixels).
 * 2. **Culling:** It checks if the tool is actually visible on screen to optimize performance.
 * 3. **Composition:** It configures and combines multiple low-level renderers (Segment, Text, Anchors)
 *    into a single `CompositeRenderer` for the chart to draw.
 */
export class LineToolTrendLinePaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	protected _segmentRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();
	protected _textRenderer: TextRenderer<HorzScaleItem> = new TextRenderer();

	/**
	 * Initializes the Trend Line View.
	 *
	 * @param source - The specific Trend Line model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolTrendLine<HorzScaleItem>,
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<any>, chart, series);
	}

	/**
	 * Retrieves the internal `SegmentRenderer` instance used to draw the main line.
	 *
	 * This can be useful for derived classes (like `LineToolArrowPaneView`) if they need
	 * to inspect or modify the renderer's state directly, though usually configuration is done via options.
	 *
	 * @returns The active {@link SegmentRenderer}.
	 */
	public getSegmentRenderer(): SegmentRenderer<HorzScaleItem> {
		return this._segmentRenderer;
	}

	/**
	 * Retrieves the final `CompositeRenderer` for the current render cycle.
	 *
	 * **Architecture Note:**
	 * This override ensures that `_updateImpl` is called if the view is marked as invalidated.
	 * This "lazy update" pattern ensures that expensive geometry calculations (like text rotation
	 * or culling) only happen once per frame, just before drawing.
	 *
	 * @returns The fully configured {@link IPrimitivePaneRenderer}, or `null` if nothing should be drawn.
	 * @override
	 */
	public override renderer(): IPrimitivePaneRenderer | null {
		// Call the base renderer method to ensure the composite is built/updated
		// NOTE: The logic in _updateImpl builds the composite. 
		// We just need to expose the result after it's built.
		if (this._invalidated) {
			this._updateImpl(0, 0); // Need to pass dimensions if they are required for _updateImpl to build the composite
		}
		return this._renderer; // Assumes _renderer is the CompositeRenderer
	}	

	/**
	 * The core update logic for the Trend Line View.
	 *
	 * This method is responsible for translating the tool's data model into visual renderers.
	 * It performs visibility checks (culling), coordinates conversion, and configures
	 * the sub-renderers (Segment and Text) based on the current options.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'TrendLine'>;
		
		if (!options.visible) {
			return;
		}

		if (this._tool.points().length < this._tool.pointsCount) {
			// Do not cull if actively being drawn, but exit if points are insufficient for a line segment.
			return;
		}
		
		const points = this._tool.points(); 
		
		// --- CULLING IMPLEMENTATION START ---
		
		/**
         * 1. CULLING & VISIBILITY CHECK
         *
         * We rely on the `getToolCullingState` utility to determine if this tool intersects the viewport.
         * - We pass `options.line.extend` so the culler knows to calculate intersections for infinite lines (Rays).
         * - We cast `_tool` to `BaseLineTool` to allow access to Chart APIs for viewport calculation.
         * - If `cullingState` is anything other than `Visible`, we exit immediately to save performance.
         */
		const cullingState = getToolCullingState(points, this._tool as BaseLineTool<HorzScaleItem>, options.line.extend);
		
		let shouldCull = false;

		// 2. Apply Custom Culling Logic based on State and Extension Configuration
		switch (cullingState) {
			case OffScreenState.OffScreenTop:
				shouldCull = true;
				break;

			case OffScreenState.OffScreenBottom:
				shouldCull = true;
				break;

			case OffScreenState.OffScreenLeft:
				shouldCull = true;
				break;

			case OffScreenState.OffScreenRight:
				shouldCull = true;
				break;

			case OffScreenState.FullyOffScreen:
				shouldCull = true;
				break;
			
			case OffScreenState.Visible:
			default:
				shouldCull = false;
				break;
		}

		if (shouldCull) {
			return; // Exit early if culled
		}
        // --- CULLING IMPLEMENTATION END ---


		// 3. If Visible, proceed with coordinate conversion and rendering setup
		const hasScreenPoints = this._updatePoints(); // Converts logical points to screen coordinates (_points array)

		if (!hasScreenPoints) {
            return;
        }

		const [point0, point1] = this._points; // Screen coordinates
		const segmentPoints: [AnchorPoint, AnchorPoint] = [point0, point1];

		// --- Setup Renderers ---

		// 1. Segment Renderer (The TrendLine itself)
        // FIX for Omitted Properties: Re-introduce defaults for 'join' and 'cap'
        const lineOptions = deepCopy(options.line) as any; // Cast to any for modification
        lineOptions.join = lineOptions.join || LineJoin.Miter; 
        lineOptions.cap = lineOptions.cap || LineCap.Butt;

		/**
         * 2. SEGMENT RENDERER CONFIGURATION
         *
         * We configure the `SegmentRenderer` to draw the main line.
         * - `points`: The screen coordinates converted from the model.
         * - `line`: Visual styling (color, width, dashes) and end-caps (arrows).
         * - `toolDefault...`: We pass the cursor styles (e.g., 'pointer') so the renderer's internal
         *   hit-test can suggest the correct cursor to the chart when hovering over the line.
         */
		this._segmentRenderer.setData({ 
			points: segmentPoints, 
			line: lineOptions as LineOptions,
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		});
		(this._renderer as CompositeRenderer<HorzScaleItem>).append(this._segmentRenderer);

		// 2. Text Renderer (if any text is provided)
		if (options.text.value) {
		
			// Get screen points (known to exist if we are here)
			const [point0, point1] = this._points; 

			// --- 1. Text Logic: Determine the Text Box Pivot/Attachment Point ---
			let textLocationPoint: AnchorPoint;
			const horizontalAlignment = (options.text.box?.alignment?.horizontal || '').toLowerCase();
			
			// Check for the three standard alignment points on the segment (P0, P1, Midpoint)
			if (horizontalAlignment === BoxHorizontalAlignment.Left.toLowerCase()) {
				textLocationPoint = point0; // Attach to the first point of the line
			} else if (horizontalAlignment === BoxHorizontalAlignment.Right.toLowerCase()) {
				textLocationPoint = point1; // Attach to the second point of the line
			} else {
				// Default to center (or any other unspecified alignment)
				const lineMidpointX = (point0.x + point1.x) / 2;
				const lineMidpointY = (point0.y + point1.y) / 2;
				textLocationPoint = new AnchorPoint(lineMidpointX, lineMidpointY, 0);
			}

			const textAttachmentPoint = textLocationPoint; 

			// --- 2. Angle Calculation (Cumulative Rotation) ---
			const dx = point1.x - point0.x;
			const dy = point1.y - point0.y;
			const angleRadians = Math.atan2(dy, dx); 

			// Line Slope Angle (The Base Rotation)
			const finalAngleRadians = -angleRadians; 
			const lineSlopeAngleDegrees = finalAngleRadians * (180 / Math.PI); 
		
			// Retrieve the User's Intended Angle Offset
			const userAngleOffsetDegrees = options.text.box?.angle || 0;

			// Calculate the Final Cumulative Angle (Slope Angle + User Offset)
			const finalCumulativeAngleDegrees = lineSlopeAngleDegrees + userAngleOffsetDegrees;

			// 3. Setup Text Options and Renderer Data ---
			
			// Create deep copy of text options
			const textOptions = deepCopy(options.text);
		
			// Overwrite the angle property with the Final Cumulative Angle
			textOptions.box = { ...textOptions.box, angle: finalCumulativeAngleDegrees }; 

			
			/**
             * 3. TEXT RENDERER DATA SETUP
             *
             * This structure defines how the text box is drawn relative to the line.
             * - `points`: The pivot/attachment point. We pass it twice to satisfy the interface,
             *    but for point-attached text, the renderer focuses on the first point.
             * - `text`: The full configuration. Crucially, this object already contains the
             *    `finalCumulativeAngleDegrees` calculated above, ensuring rotation parallel to the line.
             * - `hitTestBackground`: Enables selection by clicking anywhere on the text box.
             */
			const textRendererData: TextRendererData = {
				// Text box dimensions are defined by the area between these two points.
				// For text attached to a point, we use two identical points.
				points: [textAttachmentPoint, textAttachmentPoint], 
				
				text: textOptions, 
				
				// Set up hit testing for the text box area
				hitTestBackground: true, 
				toolDefaultHoverCursor: options.defaultHoverCursor,
				toolDefaultDragCursor: options.defaultDragCursor,
			};

			this._textRenderer.setData(textRendererData);
			(this._renderer as CompositeRenderer<HorzScaleItem>).append(this._textRenderer);
		}	
		

		// 3. Line Anchors (Handles for P1 and P2)
		//if (this.areAnchorsVisible()) {
			this._addAnchors(this._renderer as CompositeRenderer<HorzScaleItem>);
		//}
	}
	
	/**
	 * Adds the interactive anchor points (handles) to the renderer.
	 *
	 * For a Trend Line, this places two handles:
	 * - One at the Start Point (P0).
	 * - One at the End Point (P1).
	 *
	 * It assigns the `DiagonalNwSeResize` cursor to both, indicating to the user that
	 * these points can be dragged freely in 2D space.
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 2) return;

		const [point0, point1] = this._points;
		
		// The two anchor points (P1 and P2)
		const anchorData = {
			points: [point0, point1],
			pointsCursorType: [PaneCursorType.DiagonalNwSeResize, PaneCursorType.DiagonalNwSeResize],
		};
		
		// Add the single LineAnchorRenderer set (which renders both P1 and P2)
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}