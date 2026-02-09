// /lightweight-charts-line-tools-fib-retracement/src/views/LineToolFibRetracementPaneView.ts

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
	RectangleRenderer,
	TextRenderer,
	AnchorPoint,
	OffScreenState,
	getToolCullingState,
	LineToolOptionsInternal,
	deepCopy,
	LineJoin,
	LineCap,
	LineOptions,
	TextRendererData,
	HitTestResult,
	LineToolHitTestData,
	RectangleRendererData,
	BoxHorizontalAlignment,
	BoxVerticalAlignment,
	TextAlignment,
	FibRetracementLevel,
	LineEnd,
	PaneCursorType,
	ensureNotNull,
	LineToolPoint,
	HitTestType,
	LineToolCullingInfo,
	TextOptions
} from '../../../lightweight-charts-line-tools-core/src';

import { LineToolFibRetracement } from '../model/LineToolFibRetracement';


// Helper interface for calculated level data (Now holds the final screen Y as well)
interface LevelCoordinates {
	price: number;
	coordinate: Coordinate;
}


/**
 * Pane View for the Fibonacci Retracement tool.
 *
 * **Tutorial Note on Complexity:**
 * This is the most complex view in the library. While most tools have one renderer, the 
 * Fib Retracement manages an **array of renderer sets**. For every level (e.g., 0.618), 
 * it coordinates:
 * 1. A `SegmentRenderer` for the level line.
 * 2. A `RectangleRenderer` for the fill between this level and the previous one.
 * 3. A `TextRenderer` for the coefficient and price label.
 *
 * It implements a "Sub-Segment" culling strategy to ensure the tool remains visible 
 * as long as any individual level line is on screen.
 */
export class LineToolFibRetracementPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {

	/**
	 * An array of pooled renderer sets. Each entry contains the line, rectangle, 
	 * and label renderers for a specific Fibonacci level.
	 * @protected
	 */
	protected _levelRenderers: {
		line: SegmentRenderer<HorzScaleItem>;
		rectangle: RectangleRenderer<HorzScaleItem>;
		label: TextRenderer<HorzScaleItem>;
	}[] = [];

	/**
	 * Renderer for the primary trend line (P0 to P1) that defines the Fib range.
	 * @protected
	 */
	protected _primaryLineRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer(new HitTestResult(HitTestType.MovePoint));


	/**
	 * Initializes the Fibonacci View and pre-allocates renderer sets for the 
	 * levels configured in the tool options.
	 *
	 * @param source - The specific Fibonacci model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolFibRetracement<HorzScaleItem>,
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);

		// Initialize renderers for all potential levels (e.g., 11 levels = 11 lines, 10 fills, 11 labels)
		const maxLevels = source.options().levels.length;
		for (let i = 0; i < maxLevels; i++) {
			this._levelRenderers.push({
				line: new SegmentRenderer(new HitTestResult(HitTestType.MovePoint)),
				rectangle: new RectangleRenderer(),
				label: new TextRenderer(),
			});
		}
	}

	/**
	 * Calculates the price difference between the current level and a user-specified 
	 * target coefficient.
	 * 
	 * **Tutorial Note:**
	 * This feature allows traders to see exactly how many price units exist between 
	 * two specific Fib levels (e.g., "Distance from 0.618 to 0.5").
	 *
	 * @param config - The configuration for the current level.
	 * @param levelPrice - The calculated price of the current level.
	 * @param levelsConfig - The full list of level configurations.
	 * @param levelsData - The pre-calculated coordinates and prices for all levels.
	 * @returns A formatted string like "(Diff: 10.50 from 0.5 line)" or an empty string.
	 * @private
	 */
	private _calculateDistanceText(
		config: FibRetracementLevel,
		levelPrice: number,
		levelsConfig: FibRetracementLevel[],
		levelsData: LevelCoordinates[] // THIS IS NOW THE COMPLETE ARRAY
	): string {
		// FIX: Only check if enabled. Do NOT check for === 0, as 0 is a valid target coefficient.
		if (!config.distanceFromCoeffEnabled) {
			return '';
		}
		
		// Search the full levelsConfig array to find the target's index
		const targetIndex = levelsConfig.findIndex(level => level.coeff === config.distanceFromCoeff);

		if (targetIndex === -1) {
			return '';
		}

		// Use the found index to access the complete, pre-calculated coordinates array
		const targetPrice = levelsData[targetIndex].price;
		const priceDifference = Math.abs(levelPrice - targetPrice);

		if (priceDifference === 0) {
			return '';
		}

		const priceFormatter = this._series.priceFormatter();
		const formattedPriceDifference = priceFormatter.format(priceDifference);

		return ` (Diff: ${formattedPriceDifference} from ${config.distanceFromCoeff} line)`;
	}	

	/**
	 * Helper to generate a translucent RGBA color string from a hex or rgb input.
	 * 
	 * **Why use this?**
	 * To create the "faded" background effect between Fib levels, we must apply 
	 * the user-defined `opacity` to the level's primary `color`. This method parses 
	 * various CSS color formats and injects the correct alpha value.
	 *
	 * @param color - The base color string (Hex or RGB).
	 * @param opacity - The alpha value (0 to 1).
	 * @returns A valid `rgba(...)` CSS string.
	 * @private
	 */
	private _getFadedColor(color: string, opacity: number): string {
		let r = 0, g = 0, b = 0;

		if (color.startsWith('#')) {
			const hex = color.slice(1);
			if (hex.length === 3) {
				// Handle short hex #RGB
				r = parseInt(hex[0] + hex[0], 16);
				g = parseInt(hex[1] + hex[1], 16);
				b = parseInt(hex[2] + hex[2], 16);
			} else if (hex.length >= 6) {
				// Handle standard hex #RRGGBB
				r = parseInt(hex.substring(0, 2), 16);
				g = parseInt(hex.substring(2, 4), 16);
				b = parseInt(hex.substring(4, 6), 16);
			}
		} else if (color.startsWith('rgb')) {
			// Extract numbers from "rgb(r, g, b)" or "rgba(r, g, b, a)"
			const matches = color.match(/(\d+(\.\d+)?)/g);
			if (matches && matches.length >= 3) {
				r = parseFloat(matches[0]);
				g = parseFloat(matches[1]);
				b = parseFloat(matches[2]);
			} else {
				// Fallback if regex fails (unlikely for valid CSS colors)
				return color; 
			}
		} else {
			// Fallback for named colors (e.g. "red", "blue")
			// To support names properly, you'd need a canvas context or a lookup table.
			// Returning a safe default grey here.
			return `rgba(120, 123, 134, ${opacity})`;
		}

		// Return new string with the specific FILL opacity
		return `rgba(${r}, ${g}, ${b}, ${opacity})`;
	}

	/**
	 * The core update logic. 
	 * 
	 * This method performs a multi-stage render pass:
	 * 1. **Data Prep:** Synchronizes the model's calculated levels with the view.
	 * 2. **Culling:** Performs a robust geometric check against every level line.
	 * 3. **Level Loop:** Iterates through sorted levels to configure lines, fills, and labels.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const model = this._tool as LineToolFibRetracement<HorzScaleItem>;
		const options = model.options() as LineToolOptionsInternal<'FibRetracement'>;
		const points = model.points();

		if (!options.visible || points.length < model.pointsCount) {
			return;
		}

		// 1. Get Calculated Segment Data from Model (Single Source of Truth)
		// We sort this here to ensure labels/colors align with prices, and we will use THIS array for everything below.
		const segmentData = model.getLineSegmentPoints().sort((a, b) => b.coeff - a.coeff);

		// 2. Initial Data Setup: Screen Point Conversion
		const hasScreenPoints = this._updatePoints();
		if (!hasScreenPoints) {
			return;
		}

		const [screenP0, screenP1] = this._points;

		// Get sorted config to match the sorted segmentData
		const levelsConfig = options.levels.slice().sort((a, b) => b.coeff - a.coeff);

		// --- CULLING PREPARATION ---
		const paneDrawingWidth = this._tool.getChartDrawingWidth();

		// CRITICAL FIX: Generate culling points directly from our sorted segmentData.
		// This removes the redundant call to model.getAllLogicalPointsForCulling() which would recalculate everything.
		// This flattens the segments into [Start, End, Start, End...]
		const allLogicalPointsForCulling: LineToolPoint[] = [];
		for (const segment of segmentData) {
			allLogicalPointsForCulling.push(segment.start);
			allLogicalPointsForCulling.push(segment.end);
		}
		
		// Map pre-calculated coordinates
		const allDerivedLevelCoordinates: LevelCoordinates[] = segmentData.map(segment => {
			const price = segment.price;
			const coordinate = this._series.priceToCoordinate(price);
			return { price: price, coordinate: coordinate as Coordinate };
		});

		// Setup Culling Arrays
		// This tells the culler: "Points 0 & 1 form a line", "Points 2 & 3 form a line", etc.
		const subSegments: number[][] = [];
		const numSegments = segmentData.length;
		for (let i = 0; i < numSegments; i++) {
			subSegments.push([i * 2, i * 2 + 1]);
		}

		// Perform Culling Check
		const cullingInfo: LineToolCullingInfo = { subSegments: subSegments };

		/**
		 * CULLING PREPARATION & MULTI-SEGMENT CHECK
		 *
		 * Fibonacci tools are large and can span far beyond the viewport. To ensure 
		 * performance while preventing "popping" (the tool disappearing while a 
		 * level is still visible):
		 * 
		 * 1. We flatten every level into a single array of logical points.
		 * 2. We define `subSegments` where every pair of points forms a level line.
		 * 3. `getToolCullingState` performs a robust intersection test on every 
		 *    individual line, accounting for infinite extensions if enabled.
		 */
		const cullingState = getToolCullingState(
			allLogicalPointsForCulling,
			this._tool as BaseLineTool<HorzScaleItem>,
			options.extend,
			undefined,
			cullingInfo
		);

		if (cullingState !== OffScreenState.Visible) {
			//console.log('fib retracement culled')
			return;
		}
		// --- CULLING END ---

		const lineOptions: LineOptions = {
			...deepCopy(options.line) as any,
			extend: options.extend,
			join: LineJoin.Miter,
			cap: LineCap.Butt,
		};

		const commonCursorOptions = {
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		};

		// --- RENDER LOOP ---
		for (let i = 0; i < levelsConfig.length; i++) {
			const config = levelsConfig[i];
			const levelData = allDerivedLevelCoordinates[i];
			const levelPrice = levelData.price;
			const levelCoord = levelData.coordinate;

			if (levelCoord === null || !isFinite(levelCoord)) continue;

			// If the user added more levels dynamically, create new renderers now.
			if (!this._levelRenderers[i]) {
				this._levelRenderers[i] = {
					line: new SegmentRenderer(new HitTestResult(HitTestType.MovePoint)),
					rectangle: new RectangleRenderer(),
					label: new TextRenderer(),
				};
			}
			const levelRendererSet = this._levelRenderers[i];

			const priceFormatter = this._series.priceFormatter();

			// --- A. Text Label Setup ---
			const distanceText = this._calculateDistanceText(config, levelPrice, levelsConfig, allDerivedLevelCoordinates);
			const labelText = `${config.coeff} (${priceFormatter.format(levelPrice)})${distanceText}`;

			const minX = Math.min(screenP0.x, screenP1.x);
			const X_left_of_pane = 0 as Coordinate;
			const X_min_segment = minX as Coordinate;

			const P_TextLeftAnchor = new AnchorPoint(X_left_of_pane, levelCoord, i);
			const P_TextRightAnchor = new AnchorPoint(X_min_segment, levelCoord, i);

			const finalTextOptions: TextOptions = {
				value: labelText,
				padding: 0,
				wordWrapWidth: 0,
				forceTextAlign: false,
				forceCalculateMaxLineWidth: false,
				alignment: TextAlignment.Right,
				font: {
					family: 'sans-serif', size: 12, bold: false, italic: false,
					color: config.color,
				},
				box: {
					alignment: { horizontal: BoxHorizontalAlignment.Right, vertical: BoxVerticalAlignment.Middle },
					padding: { x: 5, y: 3 },
				}
			} as TextOptions;

			/**
			 * TEXT LABEL SETUP
			 *
			 * We construct the label string: `[Coeff] ([Price]) [Optional Distance]`.
			 * The label is anchored to the left edge of the visible level segment. 
			 * We use an `AnchorPoint` with the current loop index `i` to ensure 
			 * hit-testing links back to the correct logical level.
			 */
			levelRendererSet.label.setData({
				points: [P_TextLeftAnchor, P_TextRightAnchor],
				text: finalTextOptions,
				hitTestBackground: true,
			});

			// --- B. Line Segment Setup ---
			const minScreenX = Math.min(screenP0.x, screenP1.x);
			const maxScreenX = Math.max(screenP0.x, screenP1.x);

			const lineStart = new AnchorPoint(
				options.extend.left ? 0 as Coordinate : minScreenX as Coordinate,
				levelCoord,
				i
			);
			const lineEnd = new AnchorPoint(
				options.extend.right ? paneDrawingWidth as Coordinate : maxScreenX as Coordinate,
				levelCoord,
				i
			);

			/**
			 * LINE SEGMENT CONFIGURATION
			 *
			 * Each Fib level is drawn as a horizontal line.
			 * - If `extend.left` or `extend.right` is enabled, the segment is 
			 *   projected to the pane boundaries (0 or paneWidth).
			 * - Otherwise, the line is bounded by the X-coordinates of the 
			 *   anchor points P0 and P1.
			 */
			levelRendererSet.line.setData({
				points: [lineStart, lineEnd],
				line: { ...lineOptions, color: config.color } as LineOptions,
				...commonCursorOptions,
			});

			// --- C. Background Rectangle (Fill) Setup ---
			let hasRectangle = false;
			if (i > 0) {
				const prevConfig = levelsConfig[i - 1];
				const prevLevelCoord = allDerivedLevelCoordinates[i - 1].coordinate;
				const rectMinY = Math.min(levelCoord, prevLevelCoord);
				const rectMaxY = Math.max(levelCoord, prevLevelCoord);

				if (prevConfig.opacity > 0) {
					// -----------------------------------------------------------
					// CHANGE: Use prevConfig.color instead of config.color
					// -----------------------------------------------------------
					// This ensures the "Upper" level (prevConfig) owns both the 
					// opacity AND the color of the fill extending downwards.
					const fillColor = this._getFadedColor(prevConfig.color, prevConfig.opacity); 

					const rectPoint1 = new AnchorPoint(minScreenX as Coordinate, rectMinY, 0);
					const rectPoint2 = new AnchorPoint(maxScreenX as Coordinate, rectMaxY, 1);

					/**
					 * BACKGROUND FILL (CONSECUTIVE LEVELS)
					 *
					 * To create the colored bands between levels:
					 * 1. We look at the "Previous" level in our sorted list.
					 * 2. We define a rectangle spanning the vertical gap between the 
					 *    current level and the previous one.
					 * 3. The "Upper" level (higher coefficient) defines the color 
					 *    and opacity for the fill extending downwards.
					 */
					levelRendererSet.rectangle.setData({
						points: [rectPoint1, rectPoint2],
						background: { color: fillColor },
						border: { width: 0, style: LineStyle.Solid, radius: 0 },
						extend: options.extend,
						hitTestBackground: false,
					} as RectangleRendererData);
					
					hasRectangle = true;
				}
			}

			// --- D. APPEND TO RENDERER (ORDER MATTERS) ---
			
			// 1. Background Rectangles (Bottom Layer)
			if (hasRectangle) {
				this._renderer.append(levelRendererSet.rectangle);
			}

			// 2. Lines (Middle Layer)
			this._renderer.append(levelRendererSet.line);

			// 3. Labels (Top Layer)
			this._renderer.append(levelRendererSet.label);
		}

		// --- 4. Add Anchors ---
		//if (this.areAnchorsVisible()) {
			this._addAnchors(this._renderer);
		//}
	}

	/**
	 * Adds the two primary interactive anchor points (P0 and P1).
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
        this._points.forEach((point, index) => {
            const anchor = this.createLineAnchor({
                points: [point],
            }, index);
            renderer.append(anchor);
        });
    }

}