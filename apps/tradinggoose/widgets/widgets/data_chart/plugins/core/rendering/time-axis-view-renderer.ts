// /src/rendering/time-axis-view-renderer.ts

import {
	ITimeAxisViewRenderer,
	TimeAxisViewRendererOptions,
	TimeAxisViewRendererData,
	CanvasRenderingTarget2D,
	MediaCoordinatesRenderingScope,
	TextWidthCache as ITextWidthCache, // Import TextWidthCache interface
} from '../types';
import { clearRect } from '../utils/canvas-helpers';
import { TextWidthCache } from '../utils/text-width-cache'; // NEW: Import the concrete TextWidthCache class

// Regular expression to replace digits for optimized text width measurement, from v3.8
const optimizationReplacementRe = /[1-9]/g;


/**
 * The concrete implementation of a renderer responsible for drawing labels on the Time Axis.
 *
 * This class calculates the layout, performs necessary position adjustments (to prevent labels
 * from drawing outside the time scale boundary), and draws the background, tick mark, and text.
 */
export class TimeAxisViewRenderer implements ITimeAxisViewRenderer {
	private _data: TimeAxisViewRendererData | null = null;
	private _fallbackTextWidthCache: ITextWidthCache | null = null; // NEW: Fallback cache

	/**
	 * Initializes the renderer. Data is set later via `setData`.
	 */	
	public constructor() {
		// Data will be set via setData later
	}

	/**
	 * Updates the data payload required to draw the time axis label.
	 *
	 * @param data - The {@link TimeAxisViewRendererData} containing the text, coordinate, and style.
	 * @returns void
	 */	
	public setData(data: TimeAxisViewRendererData): void {
		this._data = data;
	}

	/**
	 * Draws the time axis label onto the chart's time scale area.
	 *
	 * This method calculates the label's required width, adjusts its final X-coordinate to ensure
	 * it stays within the visible time scale bounds, and then draws the background, tick mark, and text.
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @param rendererOptions - The {@link TimeAxisViewRendererOptions} for styling and dimensions.
	 * @returns void
	 */	
	public draw(
		target: CanvasRenderingTarget2D, // LWC v5 Primitive API signature
		rendererOptions: TimeAxisViewRendererOptions,
		// pixelRatio is now part of the MediaCoordinatesRenderingScope
	): void {
		if (this._data === null || this._data.visible === false || this._data.text.length === 0) {
			return;
		}

		target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaCoordinatesRenderingScope) => {
			// In media space, pixelRatio is typically 1.0 (CSS pixels = device pixels)
			// for drawing directly, but if derived values need re-scaling:
			const pixelRatio = 1; // Explicitly set to 1 for media coordinates

			ctx.font = rendererOptions.font;

			// NEW: Ensure a TextWidthCache is available
			const textWidthCacheToUse = rendererOptions.widthCache || this._ensureFallbackTextWidthCache();

			// Measure text width using our TextWidthCache in rendererOptions
			// MODIFIED: Use the determined textWidthCacheToUse
			const textWidth = Math.round(textWidthCacheToUse.measureText(ctx, this._data!.text, optimizationReplacementRe));
			if (textWidth <= 0) {
				return;
			}

			const horzMargin = rendererOptions.paddingHorizontal;
			const labelWidth = textWidth + 2 * horzMargin;
			const labelWidthHalf = labelWidth / 2;
			const timeScaleWidth = this._data!.width; // Chart body width

			let coordinate = this._data!.coordinate; // X-coordinate of the mark itself
			let x1 = Math.floor(coordinate - labelWidthHalf) + 0.5; // Start X of the label box

			// Adjust x1 to keep label within time scale bounds (v3.8 logic)
			if (x1 < 0) {
				coordinate = coordinate + Math.abs(0 - x1);
				x1 = Math.floor(coordinate - labelWidthHalf) + 0.5;
			} else if (x1 + labelWidth > timeScaleWidth) {
				coordinate = coordinate - Math.abs(timeScaleWidth - (x1 + labelWidth));
				x1 = Math.floor(coordinate - labelWidthHalf) + 0.5;
			}

			const x2 = x1 + labelWidth; // End X of the label box

			const y1 = 0; // Top of the time axis area
			const y2 = (
				y1 +
				rendererOptions.borderSize +
				rendererOptions.paddingTop +
				rendererOptions.fontSize +
				rendererOptions.paddingBottom
			); // Bottom of the label box

			// Draw background for the label box
			ctx.fillStyle = this._data!.background;
			ctx.fillRect(Math.round(x1), Math.round(y1), Math.round(x2 - x1), Math.round(y2 - y1));


			// Draw the tick mark line (small vertical line under the label)
			const tickX = Math.round(this._data!.coordinate); // Center of the mark
			const tickTop = Math.round(y1);
			const tickBottom = Math.round(y2 + rendererOptions.tickLength); // Extends below the label box

			ctx.fillStyle = this._data!.color; // Text color also usually for tick
			const tickWidth = 1; // 1 CSS pixel thick tick line
			const tickOffset = 0.5; // For pixel snapping, center the 1px line
			ctx.fillRect(tickX - tickOffset, tickTop, tickWidth, tickBottom - tickTop);

			// Draw the text
			const yText = y2 - rendererOptions.baselineOffset - rendererOptions.paddingBottom;
			ctx.textAlign = 'left';
			ctx.fillStyle = this._data!.color;

			// fillText operates directly in media coordinates
			ctx.fillText(this._data!.text, x1 + horzMargin, yText);
		});
	}

	/**
	 * Calculates the total pixel height required to draw the label.
	 *
	 * This height includes font size, vertical padding, and border size.
	 *
	 * @param rendererOptions - The {@link TimeAxisViewRendererOptions} for dimensions.
	 * @returns The calculated height in pixels.
	 */
	public height(rendererOptions: TimeAxisViewRendererOptions): number {
		// Calculate the height based on options, similar to how y2 is calculated in draw
		return rendererOptions.borderSize + rendererOptions.paddingTop + rendererOptions.fontSize + rendererOptions.paddingBottom;
	}

	/**
	 * Ensures a fallback {@link TextWidthCache} instance exists if one is not provided in `rendererOptions`.
	 *
	 * @returns The active {@link ITextWidthCache} instance.
	 * @private
	 */
	private _ensureFallbackTextWidthCache(): ITextWidthCache {
		if (this._fallbackTextWidthCache === null) {
			this._fallbackTextWidthCache = new TextWidthCache();
		}
		return this._fallbackTextWidthCache;
	}
}