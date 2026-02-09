// src/views/LineToolParallelChannelPaneView.ts

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
	AnchorPoint,
	OffScreenState,
	getToolCullingState,
	LineToolOptionsInternal,
	deepCopy,
	LineOptions,
	LineToolType,
	PaneCursorType,
	SegmentRenderer,
	LineJoin,
	LineCap,
	Point,
	LineToolPoint,
	LineToolCullingInfo,
} from '../../../lightweight-charts-line-tools-core/src';

import { LineToolParallelChannel } from '../model/LineToolParallelChannel';
import { ParallelChannelRenderer, ParallelChannelRendererData } from '../rendering/ParallelChannelRenderer';


/**
 * Pane View for the Parallel Channel tool.
 *
 * **Tutorial Note on Logic:**
 * This view manages the complex visual state of a channel.
 * 1. **State Machine:** It distinguishes between the "Ghost Phase" (user has clicked once, drawing the base line)
 *    and the "Channel Phase" (user has clicked twice, expanding the width).
 * 2. **Derivation:** It derives the 4th corner (P3) logic for rendering, mirroring the Model's logic.
 * 3. **Composition:** It uses a `SegmentRenderer` for the ghost phase and a specialized `ParallelChannelRenderer` for the final shape.
 */
export class LineToolParallelChannelPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	/**
	 * Internal renderer for the full channel shape (3 lines + fill).
	 * @protected
	 */
	protected _channelRenderer: ParallelChannelRenderer<HorzScaleItem> = new ParallelChannelRenderer();

	/**
	 * Internal renderer for the single base line segment (used during creation).
	 * @protected
	 */
	protected _segmentRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();

	/**
	 * Initializes the Parallel Channel View.
	 *
	 * @param source - The specific Parallel Channel model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolParallelChannel<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);
	}

	/**
	 * The core update logic.
	 *
	 * It handles visibility culling using a 4-point bounding strategy and switches between
	 * rendering a single line (creation step 1) and the full channel (creation step 2 / final).
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'ParallelChannel'>;

		if (!options.visible) {
			this._renderer.clear();
			return;
		}

		// 2. Convert Points to Screen Coordinates
		const hasScreenPoints = this._updatePoints();
		if (!hasScreenPoints) {
			this._renderer.clear();
			return;
		}
		
		const currentPoints = this._tool.points(); // Re-fetch, should be the same as 'points' above

		const compositeRenderer = (this._renderer as CompositeRenderer<HorzScaleItem>);
		compositeRenderer.clear();

		// --- 1. Culling/Prerequisite Checks ---
        // We can only cull effectively when the shape is fully defined (3 points)
		if (currentPoints.length >= 3) {
            
            // 1. Get the derived P3 (Index 3)
            const P3 = this._tool.getPoint(3); 
            if (!P3) {
                // Should not happen if currentPoints.length >= 3, but is a safe exit
                this._renderer.clear();
                return;
            }

            // 2. Construct the input points array for the culler: [P0, P1, P2, P3]
            // This ensures index 3 is available for lookup.
            const cullerInputPoints: LineToolPoint[] = [
                currentPoints[0], 
                currentPoints[1], 
                currentPoints[2], 
                P3
            ];
            
            // 3. Construct the Culling Info object
            const cullingInfo: LineToolCullingInfo = {
                subSegments: [
                    [0, 1], // Top Line (P0 to P1)
                    [2, 3]  // Bottom Line (P2 to P3, the derived point)
                ]
            };

            // 4. Perform Culling Check using the enhanced function

			/**
			 * CULLING & VISIBILITY CHECK
			 *
			 * The Parallel Channel is defined by 3 points, but occupies the space of 4.
			 * 1. We derive the 4th point (P3) to form the complete parallelogram.
			 * 2. We construct a `cullingInfo` object defining the Top (P0-P1) and Bottom (P2-P3) edges.
			 * 3. We pass this to the culler. If the shape is fully off-screen, we skip rendering.
			 */
            const cullingState = getToolCullingState(
                cullerInputPoints, // Pass the 4-point array
                this._tool as BaseLineTool<HorzScaleItem>,
                options.extend,
                undefined, 
                cullingInfo 
            );
            
            if (cullingState !== OffScreenState.Visible) {
				//console.log('parallel channel culled')
                this._renderer.clear();
                return; // Exit if culled
            }
		}



		// --- 3. RENDERING STATE MACHINE ---

		/**
		 * RENDERING STATE MACHINE
		 *
		 * The visual representation changes based on the creation progress:
		 * - **2 Points (Ghosting P1):** We only have the Base Line. We use `SegmentRenderer` to draw a simple line.
		 * - **3 Points (Ghosting P2 or Final):** We have the full shape. We use `ParallelChannelRenderer` to draw the filled parallelogram.
		 */
		if (currentPoints.length === 2) {
			// State: After 1st click, ghosting P1 (drawing the P0-P1 segment).
			const [p0, p1] = this._points; // Screen coordinates P0, P1_ghost
			
			// Use a segment renderer to draw the base line P0-P1_ghost
			this._segmentRenderer.setData({
				points: [p0, p1],
				// Pass the line options, but must ensure 'extend' is false for the segment render
				line: { 
					...options.channelLine,
					extend: { left: false, right: false },
					join: LineJoin.Miter, 
					cap: LineCap.Butt,
				} as LineOptions, // Cast is safe as we Omitted properties for the interface
				toolDefaultHoverCursor: options.defaultHoverCursor,
				toolDefaultDragCursor: options.defaultDragCursor,
			});
			compositeRenderer.append(this._segmentRenderer);

		} else if (currentPoints.length >= 3) {
			// --- State: Final or Ghosting P2 (Drawing the full parallel shape) ---

			const [point0, point1, point2] = this._points; // Screen coordinates P0, P1, P2_ghost or final

			// 2. Setup Renderer Data
			const channelRendererData: ParallelChannelRendererData = {
				points: [point0, point1, point2],
				channelLine: options.channelLine,
				middleLine: options.middleLine,
				showMiddleLine: options.showMiddleLine,
				extend: options.extend,
				background: options.background,
				hitTestBackground: false,
				toolDefaultHoverCursor: options.defaultHoverCursor,
				toolDefaultDragCursor: options.defaultDragCursor,
			};

			this._channelRenderer.setData(channelRendererData);
			compositeRenderer.append(this._channelRenderer);
		} else {
			// 0 or 1 point (P0 ghosting state) - nothing to draw yet.
			return;
		}

		// 4. Add Anchors (always last for hit-test priority)
		//if (this.areAnchorsVisible()) {
			this._addAnchors(compositeRenderer);
		//}
	}
	
	/**
	 * Creates and adds the 6 interactive anchor points.
	 *
	 * **Tutorial Note on Anchors:**
	 * We render anchors for:
	 * - **0-3:** The four corners (P3 is derived/virtual). These use `Move` cursors (rigid side movement).
	 * - **4:** Bottom Edge Midpoint. Uses `VerticalResize` (adjusts channel height from bottom).
	 * - **5:** Top Edge Midpoint. Uses `VerticalResize` (adjusts channel height from top).
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 3) return;

		// P0, P1, P2 are screen points from _points array
		const [p0Screen, p1Screen, p2Screen] = this._points;

		// Calculate virtual anchor points in screen coordinates (P3, Midpoints)
		const tool = this._tool as LineToolParallelChannel<HorzScaleItem>;

		const getScreenPoint = (index: number): AnchorPoint => {
			const logicalPoint = tool.getPoint(index);
			const screenPoint = logicalPoint ? tool.pointToScreenPoint(logicalPoint)! : new Point(0 as Coordinate, 0 as Coordinate);
			// We return a new AnchorPoint instance with the correct index and screen coordinates
			return new AnchorPoint(screenPoint.x, screenPoint.y, index, false);
		};

		const p3Screen = getScreenPoint(3); // P3 (4th corner - Bottom Right)
		const heightMidScreen = getScreenPoint(4); // Height Midpoint (Bottom Middle)
		const baseMidScreen = getScreenPoint(5); // Translation Midpoint (Top Middle)

		// Anchor points array (must be an AnchorPoint instance to hold the index and cursor)
		const anchorPoints: AnchorPoint[] = [
			// 0: Top-Left (P0) - Rigid X/Y movement. Use 'Move' or 'Diagonal'
			new AnchorPoint(p0Screen.x, p0Screen.y, 0, false, PaneCursorType.Move),

			// 1: Top-Right (P1) - Rigid X/Y movement. Use 'Move' or 'Diagonal'
			new AnchorPoint(p1Screen.x, p1Screen.y, 1, false, PaneCursorType.Move),

			// 2: Bottom-Left (P2) - Rigid X/Y movement. Use 'Move' or 'Diagonal'
			new AnchorPoint(p2Screen.x, p2Screen.y, 2, false, PaneCursorType.Move),

			// 3: Bottom-Right (P3) - Rigid X/Y movement. Use 'Move' or 'Diagonal'
			new AnchorPoint(p3Screen.x, p3Screen.y, 3, false, PaneCursorType.Move),

			// 4: Bottom Middle (Height Midpoint) - ONLY adjusts vertical height (Y)
			new AnchorPoint(heightMidScreen.x, heightMidScreen.y, 4, true, PaneCursorType.VerticalResize),

			// 5: Top Middle (Height Adjustment from Top) - ONLY adjusts vertical height (Y)
			new AnchorPoint(baseMidScreen.x, baseMidScreen.y, 5, true, PaneCursorType.VerticalResize),
		];

		const anchorData = {
			points: anchorPoints,
		};

		// Pass tool-level default anchor cursors to createLineAnchor
		const toolOptions = this._tool.options();
		renderer.append(this.createLineAnchor({
			...anchorData,
			defaultAnchorHoverCursor: toolOptions.defaultAnchorHoverCursor,
			defaultAnchorDragCursor: toolOptions.defaultAnchorDragCursor,
		}, 0));
	}
}