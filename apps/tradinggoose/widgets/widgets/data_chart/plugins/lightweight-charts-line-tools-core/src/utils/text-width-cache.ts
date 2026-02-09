// /src/utils/text-width-cache.ts

import { ensureDefined } from './helpers'; // Assuming ensureDefined is available in helpers.ts
import { TextWidthCache as ITextWidthCache } from '../types'; // Import the interface

/**
 * A subset of the `CanvasRenderingContext2D` interface required for text measurement.
 * 
 * This type definition allows the cache to work with any object that provides
 * basic text measurement capabilities, facilitating testing or mocking.
 */
export type CanvasCtxLike = Pick<CanvasRenderingContext2D, 'measureText' | 'save' | 'restore' | 'textBaseline'>;

/**
 * Default Regular Expression used to optimize text measurement.
 * 
 * It replaces digits 2 through 9 with '0'. This assumes that all digits have the 
 * same width in tabular numbers (which is standard for many UI fonts). 
 * This increases cache hit rates by treating strings like "123.45" and "123.46" as identical ("100.00") 
 * for measurement purposes.
 */
const defaultReplacementRe = /[2-9]/g;

/**
 * A Least Recently Used (LRU) cache for text width measurements.
 * 
 * Measuring text on an HTML5 Canvas is an expensive operation. This class caches the
 * results of `measureText` calls to significantly improve rendering performance, especially
 * for axis labels and crosshair values that change frequently but repeat values.
 */
export class TextWidthCache implements ITextWidthCache {
	private readonly _maxSize: number;
	private _actualSize: number = 0;
	private _usageTick: number = 1;
	private _oldestTick: number = 1;
	private _tick2Labels: Record<number, string> = {}; // Maps usage tick to cacheString
	private _cache: Map<string, { metrics: TextMetrics; tick: number }> = new Map(); // Maps cacheString to metrics and usage tick

	/**
     * Initializes the cache with a specific capacity.
     * 
     * @param size - The maximum number of text metrics to store before evicting the oldest entries. Default is 50.
     */
	public constructor(size: number = 50) {
		this._maxSize = size;
	}

	/**
     * Clears all cached entries and resets the usage tracking.
     * 
     * This should be called when font settings change (e.g., font size or family updates),
     * as previous measurements would be invalid.
     */
	public reset(): void {
		this._actualSize = 0;
		this._cache.clear();
		this._usageTick = 1;
		this._oldestTick = 1;
		this._tick2Labels = {};
	}

	/**
     * Measures the width of the provided text, using the cache if available.
     * 
     * If the text (after optimization replacement) is in the cache, the stored width is returned.
     * Otherwise, the text is measured using the provided context, stored in the cache, and returned.
     * 
     * @param ctx - The canvas context to use for measurement if the cache misses.
     * @param text - The text string to measure.
     * @param optimizationReplacementRe - Optional regex to normalize the text (e.g., replacing digits with '0') to increase cache hits.
     * @returns The width of the text in pixels.
     */
	public measureText(ctx: CanvasCtxLike, text: string, optimizationReplacementRe?: RegExp): number {
		return this._getMetrics(ctx, text, optimizationReplacementRe).width;
	}

	/**
     * Calculates the vertical offset required to center text accurately.
     * 
     * Canvas `textBaseline = 'middle'` often results in slight visual misalignment depending on the font.
     * This method uses `actualBoundingBoxAscent` and `actualBoundingBoxDescent` (if supported) 
     * to calculate a pixel-perfect vertical correction.
     * 
     * @param ctx - The canvas context.
     * @param text - The text string to measure.
     * @param optimizationReplacementRe - Optional optimization regex.
     * @returns The y-axis offset in pixels.
     */
	public yMidCorrection(ctx: CanvasCtxLike, text: string, optimizationReplacementRe?: RegExp): number {
		const metrics = this._getMetrics(ctx, text, optimizationReplacementRe);
		// if actualBoundingBoxAscent/actualBoundingBoxDescent are not supported we use 0 as a fallback
		return ((metrics.actualBoundingBoxAscent || 0) - (metrics.actualBoundingBoxDescent || 0)) / 2;
	}

	/**
     * Internal method to retrieve or compute `TextMetrics` for a string.
     * 
     * Handles the core LRU logic:
     * 1. Applies the optimization regex to the input text key.
     * 2. Checks the cache. If found, updates the usage tick and returns.
     * 3. If missing, evicts the oldest entry if the cache is full.
     * 4. Measures the text and stores the result.
     * 
     * @param ctx - The canvas context.
     * @param text - The text to measure.
     * @param optimizationReplacementRe - Regex for digit normalization.
     * @returns The standard `TextMetrics` object.
     * @private
     */
	private _getMetrics(ctx: CanvasCtxLike, text: string, optimizationReplacementRe?: RegExp): TextMetrics {
		const re = optimizationReplacementRe || defaultReplacementRe;
		const cacheString = String(text).replace(re, '0');

		// Check if the string is already in the cache
		if (this._cache.has(cacheString)) {
			// Update usage tick to mark it as recently used
			const cacheEntry = ensureDefined(this._cache.get(cacheString));
			cacheEntry.tick = this._usageTick++;
			return cacheEntry.metrics;
		}

		// If cache is full, remove the oldest item
		if (this._actualSize === this._maxSize) {
			const oldestValueString = this._tick2Labels[this._oldestTick];
			delete this._tick2Labels[this._oldestTick];
			this._cache.delete(oldestValueString);
			this._oldestTick++;
			this._actualSize--;
		}

		// Measure text and add to cache
		ctx.save();
		ctx.textBaseline = 'middle'; // Ensure consistent baseline for measurement
		const metrics = ctx.measureText(cacheString);
		ctx.restore();

		if (metrics.width === 0 && !!text.length) {
			// measureText can return 0 in FF depending on a canvas size, don't cache it
			return metrics;
		}

		this._cache.set(cacheString, { metrics: metrics, tick: this._usageTick });
		this._tick2Labels[this._usageTick] = cacheString;
		this._actualSize++;
		this._usageTick++;
		return metrics;
	}
}