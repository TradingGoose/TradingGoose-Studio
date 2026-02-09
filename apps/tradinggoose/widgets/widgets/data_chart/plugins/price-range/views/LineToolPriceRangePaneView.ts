// lightweight-charts-line-tools-price-range/src/views/LineToolPriceRangePaneView.ts

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
	AnchorPoint,
	OffScreenState,
	getToolCullingState,
	LineToolOptionsInternal,
	TextRenderer,
	RectangleRenderer,
	SegmentRenderer,
	deepCopy,
	LineEnd,
	BoxVerticalAlignment,
	BoxHorizontalAlignment,
	PaneCursorType,
	TextAlignment,
	LineOptions,
	TextRendererData,
	LineToolPoint,
	LineToolCullingInfo,
	ensureNotNull
} from '../../core';

import { LineToolPriceRange } from '../model/LineToolPriceRange';


/**
 * Pane View for the Price Range tool.
 *
 * **Tutorial Note on Logic:**
 * This view is a complex composition of multiple renderers. It does not just draw one shape;
 * it orchestrates:
 * 1. A **Rectangle** (the main body).
 * 2. Two **Lines** (the center crosshair).
 * 3. Two **Labels** (optional user text + forced price difference label).
 *
 * It also handles the complex **8-anchor** logic, converting the 2 logical points into
 * 8 distinct resize handles on the screen.
 */
export class LineToolPriceRangePaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	// Two segment renderers for the two center lines
	/**
	 * Internal renderer for the horizontal center line (crosshair).
	 * @protected
	 */
	protected _horizontalLineRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();

	/**
	 * Internal renderer for the vertical center line (crosshair).
	 * @protected
	 */
	protected _verticalLineRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();
	
	// A second text renderer for the dynamic price difference label (the forced text)
	/**
	 * Internal renderer specifically for the dynamic price difference label (e.g., "+50.00").
	 * @protected
	 */
	protected _priceDifferenceLabelRenderer: TextRenderer<HorzScaleItem> = new TextRenderer();

	/**
	 * Initializes the Price Range View.
	 *
	 * @param source - The specific Price Range model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolPriceRange<HorzScaleItem>, // Specific tool instance
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);
		
		// The base class initializes:
		// this._rectangleRenderer: for the body (will be used for hit-test)
		// this._labelRenderer: for the optional user-defined text
		// this._renderer: the main CompositeRenderer
	}

	/**
	 * The core update logic.
	 *
	 * It calculates the screen coordinates for the corners, performs a sub-segment culling check
	 * (checking edges vs viewport), and then systematically configures and appends the
	 * Rectangle, Line, and Text renderers to the composite.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const tool = this._tool as LineToolPriceRange<HorzScaleItem>;
		const options = tool.options() as LineToolOptionsInternal<'PriceRange'>;
		
		if (!options.visible) {
			return;
		}

		// 1. Coordinate Conversion
		const hasScreenPoints = this._updatePoints();
		if (!hasScreenPoints || this._points.length < tool.pointsCount) {
			return;
		}

		const compositeRenderer = this._renderer as CompositeRenderer<HorzScaleItem>;
		const P0 = this._points[0];
		const P1 = this._points[1];

		// Ensure points are sorted for geometric calculations (Top-Left and Bottom-Right)
		const minX = Math.min(P0.x, P1.x);
		const maxX = Math.max(P0.x, P1.x);
		const minY = Math.min(P0.y, P1.y);
		const maxY = Math.max(P0.y, P1.y);

		const topLeftScreen = new AnchorPoint(minX, minY, 0);
		const bottomRightScreen = new AnchorPoint(maxX, maxY, 1);
		
		// --- CULLING CHECK (Using Sub-Segment Strategy) ---
		// The culling function relies on the logical points, so we pull those directly.
		const P0_cull = this._tool.getPoint(0)!;
		const P1_cull = this._tool.getPoint(1)!;

		if(P0_cull && P1_cull && this._points.length >= this._tool.pointsCount && !this._tool.isCreating() && !this._tool.isEditing()){
			
			// --- 1. Calculate the Four Geometric Corner Points (Logical) ---
			// These four points define the absolute geometric boundaries regardless of P0/P1 storage.
			
			const minTime = Math.min(P0_cull.timestamp, P1_cull.timestamp);
			const maxTime = Math.max(P0_cull.timestamp, P1_cull.timestamp);
			const minPrice = Math.min(P0_cull.price, P1_cull.price);
			const maxPrice = Math.max(P0_cull.price, P1_cull.price);

			const P_TL: LineToolPoint = { timestamp: minTime, price: maxPrice };
			const P_TR: LineToolPoint = { timestamp: maxTime, price: maxPrice };
			const P_BR: LineToolPoint = { timestamp: maxTime, price: minPrice };
			const P_BL: LineToolPoint = { timestamp: minTime, price: minPrice };

			// The culler expects a single flat array of points to define the geometry.
			// We pass the four corners.
			const cullingPoints: LineToolPoint[] = [P_TL, P_TR, P_BR, P_BL];
			
			const cullingInfo: LineToolCullingInfo = {
				// Check only the top (0->1) and bottom (2->3) edges for extension visibility
				subSegments: [
					[0, 1], // Top Edge (P_TL -> P_TR)
					[3, 2]  // Bottom Edge (P_BL -> P_BR)
				]
			};

			// Get the extension settings from the rectangle property
			const extendOptions = options.priceRange.rectangle.extend;

			// 4. Pass the stable array to the culling function (using the complex Rectangle logic)

			/**
			 * CULLING & VISIBILITY CHECK
			 *
			 * The Price Range tool can be inverted (P1 < P0). To ensure accurate culling:
			 * 1. We calculate the absolute min/max Logical coordinates to form a stable bounding box.
			 * 2. We define specific "Sub-Segments" (Top Edge and Bottom Edge) for the culler to check.
			 *    This allows the tool to remain visible even if the corners are off-screen, provided
			 *    an edge passes through the viewport.
			 */
			const cullingState = getToolCullingState(cullingPoints, tool, extendOptions, undefined, cullingInfo);

			// 5. Apply Custom Culling Logic based on State and Extend Options
			let shouldCull = false;

			switch (cullingState) {

				case OffScreenState.OffScreenTop:
				case OffScreenState.OffScreenBottom:
					// Vertical miss is a strong cull signal (no horizontal extension can save it)
					shouldCull = true;
					break;

				case OffScreenState.OffScreenLeft:
					// Tool is off-screen left. Only render if it extends infinitely to the right (extend.right is true)
					if (extendOptions.right !== true) {
						shouldCull = true;
					}
					break;

				case OffScreenState.OffScreenRight:
					// Tool is off-screen right. Only render if it extends infinitely to the left (extend.left is true)
					if (extendOptions.left !== true) {
						shouldCull = true;
					}
					break;

				case OffScreenState.FullyOffScreen:
					// Catch-all for disconnected tools
					shouldCull = true;
					break;

				case OffScreenState.Visible:
				default:
					// Tool is visible or horizontally overlaps, proceed to render
					shouldCull = false;
					break;
			}

			if (shouldCull) {
				// Stop rendering logic immediately and clear the renderer for efficiency.
				//console.log('price range culled')
				compositeRenderer.clear();
				return;
			}
		}

		
		// --- 2. Rectangle Body (Hit-Test and Background/Border) ---
		
		const rectBodyPoints: [AnchorPoint, AnchorPoint] = [topLeftScreen, bottomRightScreen];
		
		/**
		 * RECTANGLE RENDERER DATA SETUP
		 *
		 * We configure the main body renderer.
		 * - `points`: Top-Left and Bottom-Right screen coordinates.
		 * - `hitTestBackground`: Set to `false` here because the CompositeRenderer might handle
		 *   hit-testing differently, or we rely on border hits. (If dragging the body is required,
		 *   this might need to be true based on specific UX requirements).
		 */
		this._rectangleRenderer.setData({ 
			...deepCopy(options.priceRange.rectangle),
			points: rectBodyPoints,
			hitTestBackground: false,
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		});

		compositeRenderer.append(this._rectangleRenderer);

		// --- 3. Center Horizontal Line ---
		if (options.priceRange.showCenterHorizontalLine) {
			const midY = (minY + maxY) / 2 as Coordinate;
			const horizontalLinePoints: [AnchorPoint, AnchorPoint] = [
				new AnchorPoint(minX, midY, 0),
				new AnchorPoint(maxX, midY, 1),
			];

			/**
			 * HORIZONTAL CENTER LINE SETUP
			 *
			 * We calculate the vertical midpoint (`midY`) and create a horizontal segment.
			 * We apply specific styling (often dashed) distinct from the main border.
			 */
			this._horizontalLineRenderer.setData({
				points: horizontalLinePoints,
				line: {
					...options.priceRange.horizontalLine,
					// Ensure horizontal line is drawn full width or extended
					extend: options.priceRange.rectangle.extend,
					join: 'miter',
					cap: 'butt',
				} as LineOptions,
			});
			compositeRenderer.append(this._horizontalLineRenderer);
		}

		// --- 4. Center Vertical Line ---
		if (options.priceRange.showCenterVerticalLine) {
			const midX = (minX + maxX) / 2 as Coordinate;
			const verticalLinePoints: [AnchorPoint, AnchorPoint] = [
				new AnchorPoint(midX, minY, 0),
				new AnchorPoint(midX, maxY, 1),
			];
			
			// The vertical line doesn't support horizontal extension, but we pass the options anyway
			/**
			 * VERTICAL CENTER LINE SETUP
			 *
			 * We calculate the horizontal midpoint (`midX`) and create a vertical segment.
			 * Note: `extend` is disabled for the vertical center line to keep it contained within the box.
			 */
			this._verticalLineRenderer.setData({
				points: verticalLinePoints,
				line: {
					...options.priceRange.verticalLine,
					extend: { left: false, right: false }, // Vertical line does not extend horizontally
					join: 'miter',
					cap: 'butt',
				} as LineOptions,
			});
			compositeRenderer.append(this._verticalLineRenderer);
		}

		// --- 5. Optional User-Defined Text ---
		if (options.text.value) {
			
			const alignment = options.text.box.alignment;
			let pivotX: number;
			let pivotY: number;

			// 1. Calculate Vertical Pivot
			switch (alignment.vertical) {
				case BoxVerticalAlignment.Top:
					pivotY = minY;
					break;
				case BoxVerticalAlignment.Bottom:
					pivotY = maxY;
					break;
				case BoxVerticalAlignment.Middle:
				default:
					pivotY = (minY + maxY) / 2;
					break;
			}

			// 2. Calculate Horizontal Pivot
			switch (alignment.horizontal) {
				case BoxHorizontalAlignment.Left:
					pivotX = minX;
					break;
				case BoxHorizontalAlignment.Right:
					pivotX = maxX;
					break;
				case BoxHorizontalAlignment.Center:
				default:
					pivotX = (minX + maxX) / 2;
					break;
			}
			
			// Create the calculated pivot point
			const pivot = new AnchorPoint(pivotX as Coordinate, pivotY as Coordinate, 0); 

			/**
			 * USER TEXT RENDERER DATA SETUP
			 *
			 * If the user has added custom text (separate from the price label), we render it here.
			 * We calculate a `pivot` point based on the alignment options (e.g., aligning to the
			 * 'Top' implies using `minY` as the anchor).
			 */
			const textRendererData: TextRendererData = {
				points: [topLeftScreen, bottomRightScreen],
				text: deepCopy(options.text),
				hitTestBackground: true, 
			};
			
			this._labelRenderer.setData(textRendererData);
			compositeRenderer.append(this._labelRenderer);
		}		

		// --- 6. Dynamic Forced Price Difference Label ---
		// Target only permanent points and ghost point. Model's points() includes ghost point.
		const activePoints = tool.points();
		
		// --- TARGETED CHANGE START ---
		// Check if the tool has enough points (including the ghost point) to draw the label's magnitude
		if (activePoints.length >= 2) {
			this._addPriceDifferenceLabel(compositeRenderer, tool, P0, P1, topLeftScreen, bottomRightScreen);
		}


		// --- 7. Anchors ---
		//if (this.areAnchorsVisible()) {
			this._addAnchors(compositeRenderer);
		//}
	}

	/**
	 * Calculates and draws the dynamic price difference label.
	 *
	 * **Logic:**
	 * 1. **Direction:** Determines if price went Up or Down to set color/position (Top vs Bottom).
	 * 2. **Formatting:** Uses the Series formatter to get the exact string representation of prices.
	 * 3. **Positioning:** Calculates the geometric center of the specific edge (Top or Bottom) to anchor the text.
	 *
	 * @param renderer - The composite renderer to append to.
	 * @param tool - The tool model.
	 * @param P0 - Screen point start.
	 * @param P1 - Screen point end.
	 * @param topLeftScreen - Normalized Top-Left.
	 * @param bottomRightScreen - Normalized Bottom-Right.
	 */
	private _addPriceDifferenceLabel(
		renderer: CompositeRenderer<HorzScaleItem>,
		tool: LineToolPriceRange<HorzScaleItem>,
		P0: AnchorPoint,
		P1: AnchorPoint,
		topLeftScreen: AnchorPoint,
		bottomRightScreen: AnchorPoint,
	): void {
		const options = tool.options() as LineToolOptionsInternal<'PriceRange'>;
		const series = this._tool.getSeries();
		const priceRangeOptions = options.priceRange;

		// 1. GET RAW POINTS FIRST (Source of Truth)
		// tool.points() includes the ghost point during creation.
		const allActivePoints = tool.points();
		if (allActivePoints.length < 2) return;

		const price0Raw = allActivePoints[0];
		const price1Raw = allActivePoints[1];

		// 2. CALCULATE DIRECTION LOCALLY
		// Instead of asking the tool for a cached flag, compare the live prices immediately.
		// P1 (End) >= P0 (Start) means Price went UP (Long).
		const isUpward = price1Raw.price >= price0Raw.price;

		// Decide placement and visibility flags based on this live calculation
		const showLabel = isUpward ? priceRangeOptions.showTopPrice : priceRangeOptions.showBottomPrice;
		
		if (!showLabel) {
			return;
		}

		// Retrieve the formatter
		const priceFormatter = series.priceFormatter();

		// Snap the raw values to the series grid using the formatter.
		const P0_price_value = parseFloat(priceFormatter.format(price0Raw.price));
		const P1_price_value = parseFloat(priceFormatter.format(price1Raw.price));

		// Calculate magnitude
		const priceDifferenceMagnitude = Math.abs(P1_price_value - P0_price_value);
		
		// Determine sign
		const sign = isUpward ? '+' : '-';

		// Use the formatter again on the difference magnitude.
		const priceMagnitudeText = priceFormatter.format(priceDifferenceMagnitude);
		const priceText = `${sign}${priceMagnitudeText}`;

		// 3. Calculate Geometric Center Pivot using SCREEN Points (P0, P1)
		// Note: P0 and P1 passed into this function are derived from this._points,
		// which are the Screen Coordinate versions of tool.points().
		// Since normalization is off, P0 is Start(Screen) and P1 is End/Ghost(Screen).
		
		const minX = Math.min(P0.x, P1.x);
		const maxX = Math.max(P0.x, P1.x);
		const minY = Math.min(P0.y, P1.y); // Top of box
		const maxY = Math.max(P0.y, P1.y); // Bottom of box
		
		const geometricCenterX = (minX + maxX) / 2 as Coordinate;
		
		// If Upward (Long), place at Top (minY). If Downward (Short), place at Bottom (maxY).
		const geometricCenterY = isUpward ? minY : maxY; 
		
		const centerEdgePivot = new AnchorPoint(geometricCenterX, geometricCenterY, 0);

		// 4. Prepare TextOptions
		const finalLabelOptions = deepCopy(options.text);
		finalLabelOptions.value = priceText;
		
		const placementVerticalAlignment = isUpward ? BoxVerticalAlignment.Top : BoxVerticalAlignment.Bottom;

		finalLabelOptions.box.alignment.horizontal = BoxHorizontalAlignment.Center;
		finalLabelOptions.box.alignment.vertical = placementVerticalAlignment;
		finalLabelOptions.alignment = TextAlignment.Center;
		finalLabelOptions.font.size = 28;
		finalLabelOptions.font.bold = true;
		
		// IMPORTANT: Check your yOffset logic visually. 
		// If text is aligned "Top", offset +10 usually pushes it *down* inside. -10 pushes it up outside.
		// Adjust this based on your preference for "inside" or "outside" the box.
		// Below assumes pushing it "Inside" away from the edge slightly:
		finalLabelOptions.box.offset = { x: 0, y: isUpward ? -10 : 10 }; 

		const textRendererData: TextRendererData = {
			points: [centerEdgePivot], 
			text: finalLabelOptions,
			hitTestBackground: true,
		};

		this._priceDifferenceLabelRenderer.setData(textRendererData);
		renderer.append(this._priceDifferenceLabelRenderer);
	}	

	/**
	 * Creates and adds the 8 interactive anchor points.
	 *
	 * **Tutorial Note on Anchor Generation:**
	 * Unlike simple tools, we don't just loop through points. We manually manufacture 8 specific anchors:
	 * - **0-3 (Corners):** Combinations of Min/Max X and Y.
	 * - **4-7 (Edges):** Averages of X or Y to find midpoints.
	 *
	 * We assign specific cursors (e.g., `VerticalResize` for top/bottom edges) to give the user
	 * visual feedback on how that specific handle will behave.
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<any>): void {
		if (this._points.length < 2) return;

		const P0 = this._points[0]; // Start Point (Index 0)
		const P1 = this._points[1]; // End Point (Index 1)

		// We calculate the 4 corners based on logical combinations, NOT visual bounds
		// 0: P0 (Start)
		// 1: P1 (End)
		// 2: Corner combining P0 Time + P1 Price (Logical Bottom-Left if normalized)
		// 3: Corner combining P1 Time + P0 Price (Logical Top-Right if normalized)

		// 1. Define coordinates for the 8 anchors based on specific P0/P1 relationships
		
		// Point 0 (Start Corner)
		const anchor0 = new AnchorPoint(P0.x, P0.y, 0, false, this._getAnchorCursor(0));

		// Point 1 (End Corner)
		const anchor1 = new AnchorPoint(P1.x, P1.y, 1, false, this._getAnchorCursor(1));

		// Index 2: Uses P0 X (Time) and P1 Y (Price)
		const anchor2 = new AnchorPoint(P0.x, P1.y, 2, false, this._getAnchorCursor(2));

		// Index 3: Uses P1 X (Time) and P0 Y (Price)
		const anchor3 = new AnchorPoint(P1.x, P0.y, 3, false, this._getAnchorCursor(3));


		// Midpoints (Calculated as averages)
		const midX = (P0.x + P1.x) / 2 as Coordinate;
		const midY = (P0.y + P1.y) / 2 as Coordinate;

		// Index 4: Middle of Vertical line at P0 X (P0 X, Mid Y)
		const anchor4 = new AnchorPoint(P0.x, midY, 4, true, PaneCursorType.HorizontalResize);

		// Index 5: Middle of Vertical line at P1 X (P1 X, Mid Y)
		const anchor5 = new AnchorPoint(P1.x, midY, 5, true, PaneCursorType.HorizontalResize);

		// Index 6: Middle of Horizontal line at P0 Y (Mid X, P0 Y)
		const anchor6 = new AnchorPoint(midX, P0.y, 6, true, PaneCursorType.VerticalResize);

		// Index 7: Middle of Horizontal line at P1 Y (Mid X, P1 Y)
		const anchor7 = new AnchorPoint(midX, P1.y, 7, true, PaneCursorType.VerticalResize);

		const anchorData = {
			// The order here doesn't matter for logic, only drawing order
			points: [
				anchor0, anchor1, anchor2, anchor3,
				anchor4, anchor5, anchor6, anchor7
			],
		};
 
		const toolOptions = this._tool.options();
		renderer.append(this.createLineAnchor({
			...anchorData,
			defaultAnchorHoverCursor: toolOptions.defaultAnchorHoverCursor,
			defaultAnchorDragCursor: toolOptions.defaultAnchorDragCursor,
		}, 0));
	}	


	/**
	 * Determines the specific CSS cursor for an anchor based on its position and the box orientation.
	 *
	 * **Complexity:**
	 * If the user inverts the box (drags P1 above/left of P0), the "Top Left" visual corner might
	 * actually be the P1 logical point. This method checks the `isRight` / `isDown` geometry to
	 * ensure that the resizing cursors (NW-SE vs NE-SW) always match the visual diagonal.
	 *
	 * @param index - The anchor index.
	 * @returns The appropriate {@link PaneCursorType}.
	 * @private
	 */
	private _getAnchorCursor(index: number): PaneCursorType {
		const P0 = this._points[0];
		const P1 = this._points[1];
		
		// Determine the visual direction of the box
		const isRight = P1.x >= P0.x;
		const isDown = P1.y >= P0.y; // Screen coordinates (Down is +Y)

		// Basic NW-SE (TopLeft to BottomRight)
		const nwSe = PaneCursorType.DiagonalNwSeResize;
		// Basic NE-SW (TopRight to BottomLeft)
		const neSw = PaneCursorType.DiagonalNeSwResize;

		// Map cursors based on which physical corner the index represents
		switch (index) {
			case 0: // P0
				// If P0 is Top-Left (Standard): NW-SE
				// If P0 is Bottom-Left (Inverted Y): NE-SW
				return (isRight === isDown) ? nwSe : neSw;
			
			case 1: // P1
				// Opposite of P0, but same diagonal axis
				return (isRight === isDown) ? nwSe : neSw;

			case 2: // P0 X, P1 Y
				// This mixes corners. 
				// If Standard box: Bottom-Left -> NE-SW
				return (isRight === isDown) ? neSw : nwSe;

			case 3: // P1 X, P0 Y
				// If Standard box: Top-Right -> NE-SW
				return (isRight === isDown) ? neSw : nwSe;
			
			case 4: return PaneCursorType.HorizontalResize;
			case 5: return PaneCursorType.HorizontalResize;
			case 6: return PaneCursorType.VerticalResize;
			case 7: return PaneCursorType.VerticalResize;
			
			default: return PaneCursorType.Move;
		}
	}	
}