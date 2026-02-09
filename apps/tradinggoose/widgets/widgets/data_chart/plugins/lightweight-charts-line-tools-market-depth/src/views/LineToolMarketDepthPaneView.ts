// lightweight-charts-line-tools-market-depth/src/views/LineToolMarketDepthPaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPaneView,
	CompositeRenderer,
	OffScreenState,
	getToolCullingState,
	LineToolOptionsInternal,
	TextRenderer,
	HitTestType,
	TextRendererData,
	HitTestResult,
	Point,
	deepCopy,
} from '../../../lightweight-charts-line-tools-core/src';

import { LineToolMarketDepth } from '../model/LineToolMarketDepth';
import { MarketDepthRenderer, MarketDepthRendererData } from '../rendering/MarketDepthRenderer';


/**
 * Pane View for the Market Depth tool.
 *
 * **Tutorial Note on View Logic:**
 * This view coordinates the rendering of high-density Order Book data. It manages:
 * 1. **Data Passthrough:** Taking the Bid/Ask arrays from the model and preparing them for the specialized renderer.
 * 2. **Context Provision:** Passing essential Lightweight Charts APIs (PriceScale, TimeScale) to the renderer 
 *    so it can perform coordinate conversions internally for every price level.
 * 3. **Multiple Renderers:** Combining the main depth histogram with a standard anchor label.
 */
export class LineToolMarketDepthPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	/**
	 * Specialized renderer for the Market Depth visualization (Bid/Ask lines and volume text).
	 * @protected
	 */
	protected _marketDepthRenderer: MarketDepthRenderer<HorzScaleItem> = new MarketDepthRenderer();

	/**
	 * Standard text renderer used to display an optional label at the tool's anchor point (P0).
	 * @protected
	 */
	protected _anchorLabelRenderer: TextRenderer<HorzScaleItem> = new TextRenderer(new HitTestResult(HitTestType.Regular));

	/**
	 * Initializes the Market Depth View.
	 *
	 * @param source - The specific Market Depth model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolMarketDepth<HorzScaleItem>,
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);
	}

	/**
	 * The core update logic.
	 *
	 * This method synchronizes the tool's state with the rendering pipeline. It performs
	 * coordinate conversion for the anchor, runs culling logic, and populates the data 
	 * payloads for the specialized depth renderer and the anchor label.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
 
		// Ensure this._renderer is a CompositeRenderer instance
		const compositeRenderer = this._renderer as CompositeRenderer<HorzScaleItem>;
		compositeRenderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'MarketDepth'>;
 
		if (!options.visible) {
			return;
		}

		const points = this._tool.points();
 
		// Tool requires at least one point to draw.
		if (points.length < 1) {
			return;
		}

		// 1. Coordinate Conversion is handled by the base _updatePoints call
		const hasScreenPoints = this._updatePoints();

		if (!hasScreenPoints) {
			return;
		}

		const [anchorPoint] = this._points; // Screen coordinates of the single anchor P0
		// Deep copy the data to avoid unexpected mutations in the options object during rendering
		const rawData = deepCopy(options.marketDepth.marketDepthData);

		// --- CULLING IMPLEMENTATION START ---
		/**
		 * CULLING & VISIBILITY CHECK
		 *
		 * Although this tool is non-interactive, culling is still essential for performance.
		 * If the horizontal anchor (P0) is far outside the viewport, we skip the 
		 * heavy lifting of processing and rendering the Bid/Ask arrays.
		 */
		const cullingState = getToolCullingState(points, this._tool as BaseLineTool<HorzScaleItem>);
 
		if (cullingState !== OffScreenState.Visible) {
			//console.log('market depth culled')
			return; // Exit if culled
		}
		// --- CULLING IMPLEMENTATION END ---


		// 2. Setup MarketDepthRenderer Data
		/**
		 * MARKET DEPTH RENDERER DATA SETUP
		 *
		 * We construct a comprehensive data package for the `MarketDepthRenderer`.
		 * - `anchorPoint`: The screen-space X-coordinate where the visualization begins.
		 * - `data`: A deep copy of the Bid/Ask arrays to prevent mutation during draw.
		 * - `Axis APIs`: We pass the `priceScaleApi`, `timeScaleApi`, and `seriesApi`. 
		 *   This "dependency injection" allows the renderer to convert many price levels 
		 *   efficiently within a single drawing loop.
		 */
		const marketDepthRendererData: MarketDepthRendererData = {
			anchorPoint: anchorPoint,
			data: rawData, // Pass the raw data for the renderer to process
			options: options.marketDepth,
			textOptions: options.text, // <-- FIX: Pass the text options to the renderer data
			// Pass necessary axis APIs from the tool's context
			priceScaleApi: this._tool.priceScale()!,
			timeScaleApi: this._chart.timeScale()!,
			seriesApi: this._tool.getSeries(),
			chartWidth: width,
		};
 
		this._marketDepthRenderer.setData(marketDepthRendererData);
		compositeRenderer.append(this._marketDepthRenderer);

		// 3. Render the Anchor Label (for the single point P0)
		/**
		 * ANCHOR LABEL DATA SETUP
		 *
		 * We configure a secondary standard `TextRenderer` to draw an optional label
		 * at the anchor point. This is useful for identifying specific data points 
		 * or providing context to the order book visualization.
		 */
		const textRendererData: TextRendererData = {
			points: [anchorPoint, new Point(anchorPoint.x, anchorPoint.y)],
			text: options.text,
			hitTestBackground: false, // Label is for display only
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		};
		this._anchorLabelRenderer.setData(textRendererData);
		compositeRenderer.append(this._anchorLabelRenderer);
	}
}