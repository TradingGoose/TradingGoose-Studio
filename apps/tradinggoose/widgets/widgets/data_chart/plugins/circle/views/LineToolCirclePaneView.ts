// /src/views/LineToolCirclePaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
	Coordinate,
} from 'lightweight-charts';
import {
	LineToolPaneView,
	CompositeRenderer,
	CircleRenderer,
	TextRenderer,
	LineToolOptionsInternal,
	AnchorPoint,
	deepCopy,
	CircleRendererData,
	LineToolPoint,
	Point,
	PaneCursorType,
	HitTestType,
	LineToolHitTestData,
	getToolCullingState,
	OffScreenState,
	HitTestResult,
	TextRendererData,
} from '../../core';
import { LineToolCircle } from '../model/LineToolCircle';


/**
 * The Pane View for the LineToolCircle.
 *
 * **Tutorial Note on Logic:**
 * This view is the key coordinator between the Circle Model's 8 anchors and the actual visual components.
 * It is responsible for:
 * 1. **Culling:** Translating the logical Center/Radius into a screen-space bounding box for culling.
 * 2. **Renderer Setup:** Configuring the `CircleRenderer` with the visual data.
 * 3. **Anchor Management:** Calculating the precise screen position of the 8 anchors and passing only the desired handles (Center and Radius Point) to the `LineAnchorRenderer`.
 */
export class LineToolCirclePaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	/**
	 * Internal renderer for the main circular shape (body and border).
	 * @private
	 */
	private readonly _circleRenderer: CircleRenderer<HorzScaleItem>;

	/**
	 * Internal renderer for the optional text label attached to the circle.
	 * @private
	 */
	private readonly _textRenderer: TextRenderer<HorzScaleItem>;

	/**
	 * Initializes the Circle Pane View.
	 *
	 * It instantiates the `CircleRenderer` with a default hit-test result that flags any body hit
	 * as a `MovePointBackground` with the `Grabbing` cursor. This ensures a consistent drag experience.
	 *
	 * @param tool - The specific Circle model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		tool: LineToolCircle<HorzScaleItem>,
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		// Canonical call to the base constructor
		super(tool as any, chart, series as any);

		// Initialize renderers with specific hit-test configuration
		this._circleRenderer = new CircleRenderer<HorzScaleItem>(
			// Hit-test on the circle body should lead to a drag/move
			// Note: The HitTestResult requires an explicit typing and data payload if provided
			new HitTestResult<LineToolHitTestData>(HitTestType.MovePointBackground, { pointIndex: null, suggestedCursor: PaneCursorType.Grabbing })
		);
		this._textRenderer = new TextRenderer<HorzScaleItem>();
	}

	/**
	 * The core update logic that builds the composite renderer.
	 *
	 * It performs bounding box culling and configures the `CircleRenderer` and `TextRenderer`.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		// Clear and reset the composite renderer
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'Circle'>;
		if (!options.visible) {
			return;
		}

		const hasValidPoints = this._updatePoints();

		// --- CULLING IMPLEMENTATION START (CORRECTED) ---

		/**
         * CULLING IMPLEMENTATION
         *
         * A simple logical AABB check is unreliable for a circle because a logical unit
         * does not equal a pixel unit.
         *
         * **Logic:**
         * 1. Get the logical Center (P0) and Radius (P0-P1).
         * 2. Synthesize the bounding box (Top-Left/Bottom-Right) in **screen pixels** (where units are consistent).
         * 3. Convert those 2 screen corner points back to **logical** time/price points.
         * 4. Run `getToolCullingState` on those 2 final logical corner points. This correctly culls
         *    the tool based on its current *screen-space* bounding box.
         */
		if (this._tool.getPermanentPointsCount() >= this._tool.pointsCount && !this._tool.isCreating() && !this._tool.isEditing()) {
			
			const P0_logical = this._tool.getPoint(0); // Center Logical Point
			const P1_logical = this._tool.getPoint(1); // Radius Logical Point

			const P0_screen = this._points[0]; // Center Screen Point
			const P1_screen = this._points[1]; // Radius Screen Point

			if (P0_logical && P1_logical && P0_screen && P1_screen) {
				
				// 1. Calculate the VISUAL screen radius (the actual rendered distance)
				const screenRadius = P0_screen.subtract(P1_screen).length();

				// 2. Synthesize the Bounding Box Corners in SCREEN SPACE
				// This is the Top-Left and Bottom-Right corner of the bounding square.
				const BoundingBoxScreen: Point[] = [
					// Point 1: Top-Left (Min X, Min Y)
					new Point(
						(P0_screen.x - screenRadius) as Coordinate,
						(P0_screen.y - screenRadius) as Coordinate 
					),
					// Point 2: Bottom-Right (Max X, Max Y)
					new Point(
						(P0_screen.x + screenRadius) as Coordinate,
						(P0_screen.y + screenRadius) as Coordinate
					)
				];

				// 3. Convert the Screen Bounding Box Corners back to LOGICAL Space
				const BoundingPointsLogical: LineToolPoint[] = [];

				BoundingBoxScreen.forEach(screenPoint => {
					const logicalPoint = this._tool.screenPointToPoint(screenPoint);
					if (logicalPoint) {
						BoundingPointsLogical.push(logicalPoint);
					}
				});

				// 4. Culling Check: Pass the Logical Bounding Box to the culler
				if (BoundingPointsLogical.length === 2) {
					const cullingState = getToolCullingState(BoundingPointsLogical, this._tool);

					if (cullingState !== OffScreenState.Visible) {
						console.log('circle culled')
						return;
					}
				}
			}
		}
		// --- CULLING IMPLEMENTATION END ---

		if (!hasValidPoints || this._points.length < 2) {
			return;
		}

		// The two defining points in screen coordinates
		const centerPointScreen = this._points[0];
		const radiusPointScreen = this._points[1];

        // --- TEXT BOUNDING BOX CALCULATION START ---
        
        // 1. Calculate the screen radius (distance between center and radius point)
        const screenRadius = centerPointScreen.subtract(radiusPointScreen).length();
        
        // 2. Synthesize the bounding box corners (Top-Left and Bottom-Right)
        // Bounding Box X range: [Center.x - Radius, Center.x + Radius]
        // Bounding Box Y range: [Center.y - Radius, Center.y + Radius]
        
		/**
         * TEXT BOUNDING BOX CALCULATION
         *
         * The text box must be aligned to the **square bounding box** of the circle.
         * We calculate the coordinates for the Top-Left and Bottom-Right corners of this square
         * in screen space. These two synthetic points are passed to the `TextRenderer`.
         */
        const textBoundingPoints: Point[] = [
            // Top-Left Corner (Min X, Min Y)
            new Point(
                (centerPointScreen.x - screenRadius) as Coordinate,
                (centerPointScreen.y - screenRadius) as Coordinate 
            ),
            // Bottom-Right Corner (Max X, Max Y)
            new Point(
                (centerPointScreen.x + screenRadius) as Coordinate,
                (centerPointScreen.y + screenRadius) as Coordinate
            )
        ];
        
        // --- TEXT BOUNDING BOX CALCULATION END ---		

		// --- 1. Prepare and add the Circle Renderer (Main Body) ---
		
		/**
		 * CIRCLE RENDERER DATA SETUP
		 *
		 * We configure the `CircleRenderer` by passing the Center and Radius points in screen coordinates.
		 * - `points`: The screen coordinates of P0 (Center) and P1 (Radius).
		 * - `hitTestBackground`: false, as the HitTestResult was already set in the constructor to handle this.
		 */
		const circleRendererData: CircleRendererData = {
			...deepCopy(options.circle), // Includes background and border options
			points: [centerPointScreen, radiusPointScreen], // Pass Center and Radius Point
			hitTestBackground: false,
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		};
 
		this._circleRenderer.setData(circleRendererData);
		this._renderer.append(this._circleRenderer);

		// --- 2. Prepare and add the Text Renderer (if applicable) ---
		if (options.text.value) {
			// The text renderer needs the two core points to calculate its bounding box and position.

			/**
			 * TEXT RENDERER DATA SETUP
			 *
			 * - `points`: The Top-Left and Bottom-Right screen points of the circle's bounding box.
			 *   The `TextRenderer` uses this rectangular area to calculate text alignment (e.g., align text to center of circle box).
			 * - `hitTestBackground`: true allows the text label to be clickable for selecting the tool.
			 */
			const textRendererData: TextRendererData = {
				text: deepCopy(options.text),
				points: textBoundingPoints,
				toolDefaultHoverCursor: options.defaultHoverCursor,
				toolDefaultDragCursor: options.defaultDragCursor,
				hitTestBackground: true,
			};
			this._textRenderer.setData(textRendererData);
			this._renderer.append(this._textRenderer);
		}

		// --- 3. Prepare and add the Anchor Points (Handles) ---
		//if (this.areAnchorsVisible()) {
			this._addAnchors(this._renderer);
		//}
	}

	/**
	 * Creates and adds the interactive anchor points to the renderer.
	 *
	 * **Tutorial Note on Anchor Filtering:**
	 * The Circle Model creates 8 functional anchors (indices 0-7) for logic, but we only want
	 * the **2 visually meaningful anchors** (Center P0, Radius P1) to be rendered.
	 * This method iterates all 8 and explicitly pushes only the visible handles (0 and 1)
	 * to the `LineAnchorRenderer`.
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 2) return;

		// The full set of functional anchors (indices 0-7)
		const functionalAnchors: AnchorPoint[] = [];

		for (let i = 0; i < 8; i++) {
			const logicalAnchor = this._tool.getPoint(i) as LineToolPoint;

			// Add null check
			if (!logicalAnchor) { 
				continue; 
			}

			const screenPoint = this._tool.pointToScreenPoint(logicalAnchor);

			if (screenPoint) {
				const isPrimaryAnchor = i === 0 || i === 1;
				
				// We create an AnchorPoint for each functional index (0-7)
				const anchor = new AnchorPoint(
					screenPoint.x, 
					screenPoint.y, 
					i, 
					!isPrimaryAnchor // Virtual points can be squares/different shapes
				);
				
				// *** CRITICAL STEP: Only pass data for the 2 visually desired anchors ***
				if (i === 0 || i === 1) {
					functionalAnchors.push(anchor);
				}
			}
		}

		const options = this._tool.options();
		
		const anchorData = {
			points: functionalAnchors, // This array only contains anchors 0 and 1 now
			defaultAnchorHoverCursor: options.defaultAnchorHoverCursor,
			defaultAnchorDragCursor: options.defaultAnchorDragCursor,
		};
		
		// Append the anchor renderer to the composite renderer
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}