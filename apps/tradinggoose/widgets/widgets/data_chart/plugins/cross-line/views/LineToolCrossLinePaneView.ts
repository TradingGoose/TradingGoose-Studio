// /src/views/LineToolCrossLinePaneView.ts

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
	AnchorPoint,
	OffScreenState,
	getToolCullingState,
	LineOptions,
	LineToolOptionsInternal,
	deepCopy,
	LineJoin,
	LineCap,
	PaneCursorType,
} from '../../core';

import { LineToolCrossLine } from '../model/LineToolCrossLine';


/**
 * Pane View for the Cross Line tool.
 *
 * **Tutorial Note on Logic:**
 * The Cross Line is unique because it takes a **Single Point** from the model but renders
 * **Two Infinite Lines** (Horizontal and Vertical).
 *
 * Since the rendering engine draws finite segments, this view is responsible for:
 * 1. Determining the full width and height of the chart pane.
 * 2. Creating a vertical segment from top to bottom at the point's X.
 * 3. Creating a horizontal segment from left to right at the point's Y.
 */
export class LineToolCrossLinePaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	// Need two separate renderers for the two distinct segments
	protected _horizontalRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();
	protected _verticalRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();

	/**
	 * Initializes the Cross Line View.
	 *
	 * @param source - The specific Cross Line model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolCrossLine<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);
	}

	/**
	 * The core update logic.
	 *
	 * It translates the single logical anchor point into two full-screen segments
	 * (Horizontal and Vertical) and configures separate renderers for each.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'CrossLine'>;
 
		if (!options.visible) {
			return;
		}

		const points = this._tool.points(); 
		if (points.length < 1) {
			return;
		}

		// --- CULLING IMPLEMENTATION START ---
		// A CrossLine is visible if the single anchor point is on screen.
		/**
         * 1. CULLING & VISIBILITY CHECK
         *
         * A Cross Line is infinite in both directions.
         * We pass `{ horizontal: true, vertical: true }` to the culler.
         * This tells the culling engine: "Only hide this tool if the anchor is
         * completely off-screen in BOTH X and Y dimensions."
         * (e.g., if the point is to the left AND above the viewport).
         */
		const cullingState = getToolCullingState(
			points, 
			this._tool as BaseLineTool<HorzScaleItem>, 
			options.line.extend, 
			{ horizontal: true, vertical: true } // Dual infinite component
		);
		// Note: A CrossLine is technically visible if the point's X is on screen OR Y is on screen,
		// but since it's infinite in both directions, it's only culled if the point's X is outside
		// the X-range AND the Y is outside the Y-range (i.e., fully off-screen X and Y).
		if (cullingState !== OffScreenState.Visible) {
			return; // Exit if culled
		}
		// --- CULLING IMPLEMENTATION END ---

		/**
         * 2. COORDINATE CONVERSION & DIMENSIONS
         *
         * We convert the single anchor to screen coordinates.
         * We also retrieve the exact drawing dimensions of the pane. This is crucial
         * for defining the start/end points of our "infinite" lines.
         */
		const hasScreenPoints = this._updatePoints(); 
		if (!hasScreenPoints) {
			return;
		}

		const [anchorPoint] = this._points; // Screen coordinates of the single anchor
		const lineX = anchorPoint.x;
		const lineY = anchorPoint.y;

		// --- Setup Renderers ---
		const compositeRenderer = new CompositeRenderer<HorzScaleItem>();

		// We need to use the explicit drawing width/height from the tool's core method
		const paneDrawingHeight = this._tool.getChartDrawingHeight();
		const paneDrawingWidth = this._tool.getChartDrawingWidth();

		// Use the line options, but must ensure X-extension is false for the segment renderer
		const lineOptions = deepCopy(options.line) as any;
		lineOptions.join = lineOptions.join || LineJoin.Miter;
		lineOptions.cap = lineOptions.cap || LineCap.Butt;
		lineOptions.extend = { left: false, right: false }; 

		/**
         * 3. RENDERER MANUFACTURE
         *
         * We manually create two distinct segments:
         * A. **Vertical Segment:** Fixed X, spanning from Y=0 to Y=Height.
         * B. **Horizontal Segment:** Fixed Y, spanning from X=0 to X=Width.
         *
         * We use separate renderers (`_verticalRenderer`, `_horizontalRenderer`) to
         * ensure they can be hit-tested independently if needed.
         */
		const commonSegmentOptions: LineOptions = lineOptions as LineOptions;
		const commonCursorOptions = {
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		};


		// 1. Vertical Segment (Full Height)
		const pTop = new AnchorPoint(lineX, 0 as Coordinate, 0); 
		const pBottom = new AnchorPoint(lineX, paneDrawingHeight as Coordinate, 0);
		
		/**
		 * Internal renderer for the infinite vertical segment of the crosshair.
		 * @protected
		 */
		this._verticalRenderer.setData({ 
			points: [pTop, pBottom], 
			line: commonSegmentOptions,
			...commonCursorOptions,
		});
		compositeRenderer.append(this._verticalRenderer);


		// 2. Horizontal Segment (Full Width)
		const pLeft = new AnchorPoint(0 as Coordinate, lineY, 0); 
		const pRight = new AnchorPoint(paneDrawingWidth as Coordinate, lineY, 0);
		
		/**
		 * Internal renderer for the infinite horizontal segment of the crosshair.
		 * @protected
		 */
		this._horizontalRenderer.setData({ 
			points: [pLeft, pRight], 
			line: commonSegmentOptions,
			...commonCursorOptions,
		});
		compositeRenderer.append(this._horizontalRenderer);


		// 3. Line Anchors (Handles for P1)
		//if (this.areAnchorsVisible()) {
			this._addAnchors(compositeRenderer);
		//}

		this._renderer = compositeRenderer;
	}
	
	/**
	 * Adds the single interactive anchor point at the intersection.
	 *
	 * We use the `Crosshair` cursor to indicate that this point moves freely in 2D space.
	 *
	 * @param renderer - The composite renderer to append the anchor to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 1) return;

		const [anchorPoint] = this._points;
 
		// The single anchor point (P1) should suggest crosshair/move cursor
		const anchorData = {
			points: [anchorPoint],
			pointsCursorType: [PaneCursorType.Crosshair], // Suggest crosshair/move
		};
 
		// Add the single LineAnchorRenderer set
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}