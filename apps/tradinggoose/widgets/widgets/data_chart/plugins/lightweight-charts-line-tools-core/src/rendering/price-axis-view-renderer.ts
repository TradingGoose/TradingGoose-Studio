// /src/rendering/price-axis-view-renderer.ts

import {
	IPriceAxisViewRenderer,
	PriceAxisViewRendererCommonData,
	PriceAxisViewRendererData,
	PriceAxisViewRendererOptions,
	TextWidthCache,
	CanvasRenderingTarget2D,
	MediaCoordinatesRenderingScope,
} from '../types';
import { clearRect } from '../utils/canvas-helpers';

/**
 * The concrete implementation of a renderer responsible for drawing labels on the Price Axis.
 *
 * This class handles the pixel-level details of drawing the label's background box, border, text,
 * and tick mark according to the provided data and options, correctly accounting for LWC's rendering context.
 */
export class PriceAxisViewRenderer implements IPriceAxisViewRenderer {
	private _data!: PriceAxisViewRendererData;
	private _commonData!: PriceAxisViewRendererCommonData;

	/**
	 * Initializes the renderer with the initial data payloads.
	 *
	 * @param data - The {@link PriceAxisViewRendererData} containing the text and visibility flags.
	 * @param commonData - The {@link PriceAxisViewRendererCommonData} containing coordinate and base style information.
	 */	
	public constructor(data: PriceAxisViewRendererData, commonData: PriceAxisViewRendererCommonData) {
		this.setData(data, commonData);
	}

	/**
	 * Updates the data used by the renderer.
	 *
	 * @param data - The new {@link PriceAxisViewRendererData}.
	 * @param commonData - The new {@link PriceAxisViewRendererCommonData}.
	 * @returns void
	 */	
	public setData(data: PriceAxisViewRendererData, commonData: PriceAxisViewRendererCommonData): void {
		this._data = data;
		this._commonData = commonData;
	}

	/**
	 * Draws the price axis label onto the canvas.
	 *
	 * This method calculates the final layout, applies pixel snapping, draws the background/border/tick mark,
	 * and renders the text based on the provided alignment ('left'/'right').
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @param rendererOptions - The {@link PriceAxisViewRendererOptions} for styling and dimensions.
	 * @param textWidthCache - The {@link TextWidthCache} for accurate text measurement.
	 * @param width - The total width of the Price Axis area in pixels.
	 * @param align - The horizontal alignment of the axis ('left' for right scale, 'right' for left scale).
	 * @returns void
	 */	
	public draw(
		target: CanvasRenderingTarget2D, // Now directly accepting CanvasRenderingTarget2D
		rendererOptions: PriceAxisViewRendererOptions,
		textWidthCache: TextWidthCache,
		width: number,
		align: 'left' | 'right'
	): void {
		if (!this._data.visible) {
			return;
		}

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			// pixelRatio is 1.0 in media coordinates if drawn directly.
            // If internal logic requires pixelRatio explicitly, we can derive it from mediaSize.
            const pixelRatio = mediaSize.width / width; // Derive pixelRatio for internal v3.8-like calc

			ctx.font = rendererOptions.font;

			const tickSize = (this._data.tickVisible || !this._data.moveTextToInvisibleTick) ? rendererOptions.tickLength : 0;
			const horzBorder = rendererOptions.borderSize;
			const paddingTop = rendererOptions.paddingTop;
			const paddingBottom = rendererOptions.paddingBottom;
			const paddingInner = rendererOptions.paddingInner;
			const paddingOuter = rendererOptions.paddingOuter;
			const text = this._data.text;
			// Measure text width directly, scaling only if intermediate calculations require it
			const textWidth = Math.ceil(textWidthCache.measureText(ctx, text));
			const baselineOffset = rendererOptions.baselineOffset;
			const totalHeight = rendererOptions.fontSize + paddingTop + paddingBottom;
			const halfHeight = Math.ceil(totalHeight * 0.5);
			const totalWidth = horzBorder + textWidth + paddingInner + paddingOuter + tickSize;

			let yMid = this._commonData.coordinate;
			if (this._commonData.fixedCoordinate) {
				yMid = this._commonData.fixedCoordinate;
			}

			yMid = Math.round(yMid);

			const yTop = yMid - halfHeight;
			const yBottom = yTop + totalHeight;

			const alignRight = align === 'right';

			const xInside = alignRight ? width : 0;
			// No longer need rightScaled as we are in media coordinates

			let xOutside = xInside;
			let xTick: number;
			let xText: number;

			ctx.lineWidth = 1; // Always 1 for drawing thin lines
			ctx.lineCap = 'butt';

			if (text) {
				if (alignRight) {
					// 2               1
					//
					//              6  5
					//
					// 3               4
					xOutside = xInside - totalWidth;
					xTick = xInside - tickSize;
					xText = xOutside + paddingOuter;
				} else {
					// 1               2
					//
					// 6  5
					//
					// 4               3
					xOutside = xInside + totalWidth;
					xTick = xInside + tickSize;
					xText = xInside + horzBorder + tickSize + paddingInner;
				}

				const tickHeight = pixelRatio >= 1 ? 1 : 0.5; // Always 1 media pixel for tick height

				const horzBorderMedia = horzBorder; // No explicit scaling multiplication for drawing
				const xInsideMedia = alignRight ? width : 0;
				const yTopMedia = Math.round(yTop);
				const xOutsideMedia = Math.round(xOutside);
				const yMidMedia = Math.round(yMid);

				// Draw background
				ctx.save();
				ctx.fillStyle = this._commonData.background;
				ctx.beginPath();
				ctx.moveTo(xInsideMedia, yTopMedia);
				ctx.lineTo(xOutsideMedia, yTopMedia);
				ctx.lineTo(xOutsideMedia, yBottom);
				ctx.lineTo(xInsideMedia, yBottom);
				ctx.fill();
				ctx.restore();

				// Draw border
				ctx.fillStyle = this._data.borderColor;
				ctx.fillRect(alignRight ? xInsideMedia - horzBorderMedia : 0, yTopMedia, horzBorderMedia, yBottom - yTopMedia);

				if (this._data.tickVisible) {
					ctx.fillStyle = this._commonData.color;
					ctx.fillRect(xInsideMedia, yMidMedia, xTick - xInsideMedia, tickHeight);
				}

				ctx.textAlign = 'left';
				ctx.fillStyle = this._commonData.color;

				// fillText operates directly on current ctx settings in media coordinates
				ctx.fillText(text, xText, yBottom - paddingBottom - baselineOffset);
			}
		});
	}

	/**
	 * Calculates the total pixel height required to draw the label.
	 *
	 * This height includes font size and vertical padding defined in the options.
	 *
	 * @param rendererOptions - The {@link PriceAxisViewRendererOptions} for dimensions.
	 * @param useSecondLine - Flag to calculate height for a second line of text (not typically used for price labels).
	 * @returns The calculated height in pixels, or 0 if the label is invisible.
	 */	
	public height(rendererOptions: PriceAxisViewRendererOptions, useSecondLine: boolean): number {
		if (!this._data.visible) {
			return 0;
		}

		return rendererOptions.fontSize + rendererOptions.paddingTop + rendererOptions.paddingBottom;
	}
}