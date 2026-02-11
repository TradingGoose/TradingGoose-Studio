// lightweight-charts-line-tools-market-depth/src/rendering/MarketDepthRenderer.ts

import {
	// Primitives
	IPaneRenderer,
	CanvasRenderingTarget2D,
	MediaCoordinatesRenderingScope,
	LineToolOptionsInternal,
	Point,
	ensureNotNull,
	// Types for Data/Options
	MarketDepthSingleAggregatesData,
	MarketDepthAggregatesData,
	LineToolsCorePlugin,
	// Canvas Helpers
	setLineStyle,
	HitTestResult,
} from '../../core';

import {
	Coordinate,
	ISeriesApi,
	SeriesType,
	ITimeScaleApi,
	IPriceScaleApi,
	LineStyle,
} from 'lightweight-charts';
import { resolveSystemFontFamily } from '../../core/utils/theme-text-style';

// Assuming drawSolidLine is exported from the core's canvas-helpers.ts utility
function drawSolidLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
}

/**
 * Data structure required by the `MarketDepthRenderer`.
 *
 * It contains the single screen anchor point, the raw Bid/Ask data, and the visual options.
 * It also provides access to the Series and TimeScale APIs to handle coordinate conversions 
 * during the draw cycle.
 */
export interface MarketDepthRendererData {
	anchorPoint: Point;
	data: MarketDepthAggregatesData;
	options: LineToolOptionsInternal<'MarketDepth'>['marketDepth'];
	priceScaleApi: IPriceScaleApi; // Still needed for context/options, but not conversion
	timeScaleApi: ITimeScaleApi<any>;
	seriesApi: ISeriesApi<SeriesType, any>; // <-- Use this for conversion
	chartWidth: number;
	textOptions: LineToolOptionsInternal<'MarketDepth'>['text']; // Pass text options to get font size
}

/**
 * A specialized renderer for visualizing Market Depth (Order Book) data.
 *
 * **Tutorial Note on Performance:**
 * Unlike standard line tools that draw a few segments, this renderer may be asked to 
 * draw hundreds of individual price levels. It uses a high-performance loops to render 
 * horizontal bars proportional to the volume at each price level, ensuring a smooth 
 * frame rate even during active order book updates.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class MarketDepthRenderer<HorzScaleItem> implements IPaneRenderer {
	private _data: MarketDepthRendererData | null = null;

	/**
	 * Sets the data payload required to draw the market depth.
	 *
	 * @param data - The `MarketDepthRendererData` containing order book snapshots and styling.
	 * @returns void
	 */
	public setData(data: MarketDepthRendererData): void {
		this._data = data;
	}

	/**
	 * The main drawing orchestration for the Market Depth tool.
	 *
	 * It calculates scaling factors, text metrics, and horizontal spacing before 
	 * rendering the Bid and Ask arrays.
	 *
	 * @param target - The `CanvasRenderingTarget2D` provided by Lightweight Charts.
	 * @returns void
	 */
	public draw(target: CanvasRenderingTarget2D): void {
		if (!this._data || !this._data.data || !this._data.anchorPoint) {
			return;
		}

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			const { data, options, anchorPoint, seriesApi, textOptions } = this._data!;
			const { Bids, Asks } = data;

			// 1. Calculate the highest total size for scaling
			/**
			 * SCALING CALCULATION
			 *
			 * To draw proportional bars, we must find the largest volume size in the 
			 * current data set. We calculate this for Bids and Asks independently or 
			 * combined based on the `totalBidAskCalcMethod` option. 
			 * This value becomes the "100%" length for the bars.
			 */
			const highestSizes = this._calculateHighestTotalSize(Bids, Asks, options.totalBidAskCalcMethod);
			const highestBidTotalSize = highestSizes.highestBid;
			const highestAskTotalSize = highestSizes.highestAsk;
			const highestCombinedTotalSize = highestSizes.highestCombined;

			// 2. Setup Common Drawing Properties
			ctx.lineCap = 'butt';
			ctx.lineJoin = 'miter';
			ctx.lineWidth = options.lineWidth || 1;
			setLineStyle(ctx, options.lineStyle || LineStyle.Solid);

			// 3. Setup Text Properties
			const fontSize = textOptions.font?.size || 12;
			const fontFamily = resolveSystemFontFamily(textOptions.font?.family);
			ctx.font = `${fontSize}px ${fontFamily}`; 
			
			// 4. Calculate Fixed Horizontal Offsets
			/**
			 * HORIZONTAL OFFSET CALCULATION
			 *
			 * The visualization is anchored at `baseX`.
			 * 1. `textRightEdgeX`: The vertical boundary where the volume text labels end.
			 * 2. `lineXStart`: The point where the actual depth bars begin, separated from 
			 *    the text by a configurable `lineOffset`.
			 */
			const baseX = anchorPoint.x as number;
			const optionsTimestampOffset = options.timestampStartOffset || 0;
			const optionsLineOffset = options.lineOffset || 0;
			
			// X Start of the Text (Right Edge of the text block)
			const textRightEdgeX = baseX + optionsTimestampOffset;

			// X Start of the Line (Text Block End + Line Offset)
			const assumedTextWidthMargin = 40; 
			const lineXStart = textRightEdgeX + optionsLineOffset;


			// 5. Draw Bids
			/**
			 * BIDS RENDERING (BUY SIDE)
			 *
			 * We iterate through the Bid array and draw teal-colored horizontal bars.
			 * The length of each bar is determined by `(levelSize / maxScale) * lineLength`.
			 */
			ctx.strokeStyle = options.lineBidColor;
			ctx.fillStyle = options.lineBidColor;
			const bidMaxScale = options.totalBidAskCalcMethod === 'combined' ? highestCombinedTotalSize : highestBidTotalSize;

			this._drawLevels(
				ctx,
				Bids,
				lineXStart,
				options.lineLength,
				bidMaxScale,
				seriesApi,
				textRightEdgeX
			);

			// 6. Draw Asks
			/**
			 * ASKS RENDERING (SELL SIDE)
			 *
			 * We iterate through the Ask array and draw red-colored horizontal bars.
			 * Like Bids, these extend to the right from the text block.
			 */
			ctx.strokeStyle = options.lineAskColor;
			ctx.fillStyle = options.lineAskColor;
			const askMaxScale = options.totalBidAskCalcMethod === 'combined' ? highestCombinedTotalSize : highestAskTotalSize;

			this._drawLevels(
				ctx,
				Asks,
				lineXStart,
				options.lineLength,
				askMaxScale,
				seriesApi,
				textRightEdgeX
			);
		});
	}

	/**
	 * Implementation of the hit-test method.
	 *
	 * Since the Market Depth tool is designed to be a non-interactive background layer, 
	 * this method always returns `null`. This ensures that mouse clicks pass through 
	 * to tools underneath or to the chart's native pan/zoom behavior.
	 *
	 * @param x - X coordinate.
	 * @param y - Y coordinate.
	 * @returns Always `null`.
	 */
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		return null;
	}

	/**
	 * Scans the provided Bid and Ask arrays to determine the maximum volume at any price level.
	 *
	 * @param Bids - Array of bid levels.
	 * @param Asks - Array of ask levels.
	 * @param calcMethod - The method to use ('combined' or 'individual') for determining the max size.
	 * @returns An object containing the highest bid, highest ask, and the global maximum.
	 * @private
	 */
	private _calculateHighestTotalSize(Bids: MarketDepthSingleAggregatesData[], Asks: MarketDepthSingleAggregatesData[], calcMethod: string): { highestBid: number, highestAsk: number, highestCombined: number } {
		const bidSizes = Bids.map(b => parseFloat(b.TotalSize || '0'));
		const askSizes = Asks.map(a => parseFloat(a.TotalSize || '0'));

		const highestBid = bidSizes.length > 0 ? Math.max(...bidSizes) : 0;
		const highestAsk = askSizes.length > 0 ? Math.max(...askSizes) : 0;
		const highestCombined = Math.max(highestBid, highestAsk);

		return { highestBid, highestAsk, highestCombined };
	}

	/**
	 * The core primitive drawing loop for Bid/Ask levels.
	 *
	 * **Tutorial Note:**
	 * This method is called twice per frame (once for Bids, once for Asks). 
	 * For each level, it:
	 * 1. Converts the logical `Price` to a screen `Y` coordinate.
	 * 2. Calculates the pixel `width` of the bar based on volume.
	 * 3. Draws the line segment.
	 * 4. Renders the volume string as right-aligned text next to the bar.
	 *
	 * @param ctx - The canvas rendering context.
	 * @param levels - The data levels to draw.
	 * @param lineXStart - The screen X-coordinate where bars begin.
	 * @param maxLineLength - The pixel width allowed for a "100%" volume bar.
	 * @param maxScaleSize - The volume value representing 100% scale.
	 * @param seriesApi - Access to coordinate conversion.
	 * @param textXEnd - The screen X-coordinate where text labels align.
	 * @private
	 */
	private _drawLevels(
		ctx: CanvasRenderingContext2D,
		levels: MarketDepthSingleAggregatesData[],
		lineXStart: number,
		maxLineLength: number,
		maxScaleSize: number,
		seriesApi: ISeriesApi<SeriesType, any>, 
		textXEnd: number // Use this as the position where the right-aligned text ends
	): void {

		if (maxScaleSize === 0) return;

		for (const level of levels) {
			const price = parseFloat(level.Price);
			const size = parseFloat(level.TotalSize || '0');
 
			if (!isFinite(price) || !isFinite(size)) continue;

			// 1. Calculate Vertical Position (Y)
			const yPos = seriesApi.priceToCoordinate(price);
			if (yPos === null) continue;

			// 2. Calculate Line Length (Proportional)
			const lineLength = (size / maxScaleSize) * maxLineLength;
			const lineXEnd = lineXStart + lineLength;

			// --- Drawing ---

			// Draw the horizontal line
			drawSolidLine(ctx, lineXStart, yPos, lineXEnd, yPos);

			// Draw the TotalSize Text
			const textValue = size.toFixed(0);
			const textY = yPos;

			ctx.save();
			// CRITICAL FIX: The text is positioned at textXEnd (the right-most point of the text block)
			// and is drawn leftward because textAlign is 'right'.
			ctx.textAlign = 'right'; 
			ctx.textBaseline = 'middle';
			ctx.fillText(textValue, textXEnd, textY);
			ctx.restore();
		}
	}
}
