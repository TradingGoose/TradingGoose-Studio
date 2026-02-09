// /src/utils/text-helpers.ts

/**
 * This file contains helper functions specifically for text rendering and layout,
 * adapted from the V3.8 line tools build. These utilities are used by the
 * enhanced TextRenderer to provide advanced text formatting capabilities.
 */

import { LineStyle } from 'lightweight-charts';
import { TextRendererData, BoxHorizontalAlignment, BoxVerticalAlignment, TextAlignment } from '../types';
import { ensureNotNull, ensureDefined, isNumber } from './helpers';


/**
 * Internal constant defining a hard-coded minimum padding in pixels.
 * 
 * This ensures that text does not bleed into the border or background edges, 
 * providing a baseline "breathing room" regardless of user configuration.
 */
export const MINIMUM_PADDING_PIXELS = 5; 

/**
 * A shared, off-screen canvas context used strictly for text measurement operations.
 * 
 * This prevents the overhead of creating a new canvas element every time text needs 
 * to be measured or wrapped. It is initialized lazily via {@link createCacheCanvas}.
 */
export let cacheCanvas: CanvasRenderingContext2D | null = null; // Changed to null initially

/**
 * Lazily initializes the shared {@link cacheCanvas} if it does not already exist.
 * 
 * It creates a 0x0 pixel canvas element (to minimize memory footprint) and retrieves 
 * its 2D context. This function should be called before any operation requiring 
 * `measureText`.
 */
export function createCacheCanvas(): void {
	if (cacheCanvas === null) { // Only create if it doesn't exist
		const canvas = document.createElement('canvas');
		// Set width/height to 0 to minimize memory footprint for a purely offscreen canvas
		canvas.width = 0;
		canvas.height = 0;
		cacheCanvas = ensureNotNull(canvas.getContext('2d'));
	}
}

/**
 * Calculates the total width of the text box container.
 * 
 * The width includes the widest line of text, plus scaled horizontal padding and 
 * background inflation.
 *
 * @param data - The text renderer data containing box styling options.
 * @param maxLineWidth - The pixel width of the longest line of text.
 * @returns The total calculated width in pixels.
 */
export function getBoxWidth(data: TextRendererData, maxLineWidth: number): number {
	return maxLineWidth + 2 * getScaledBackgroundInflationX(data) + 2 * getScaledBoxPaddingX(data);
}

/**
 * Calculates the total height of the text box container.
 * 
 * The height accounts for the number of lines, font size, line spacing (padding between lines), 
 * vertical box padding, and background inflation.
 *
 * @param data - The text renderer data containing box styling options.
 * @param linesCount - The number of text lines to render.
 * @returns The total calculated height in pixels.
 */
export function getBoxHeight(data: TextRendererData, linesCount: number): number {
	const scaledFontSize = getScaledFontSize(data);
	const scaledPadding = getScaledPadding(data);
	// V3.8 computation for box height.
	// `scaledReading` (from v3.8 `text-renderer.ts`) corresponds to `scaledFontSize` here if reading is fontSize.
	// Total height = (numLines * effectiveLineHeight) + 2 * verticalPadding.
	// effectiveLineHeight = scaledFontSize + scaledPadding
	return scaledFontSize * linesCount + scaledPadding * (linesCount - 1) + 2 * getScaledBackgroundInflationY(data) + 2 * getScaledBoxPaddingY(data);
}

/**
 * Calculates the effective vertical padding for the text box.
 * 
 * This combines the user-defined `text.box.padding.y` with the internal {@link MINIMUM_PADDING_PIXELS},
 * scaling the result based on the font-aware scale factor.
 *
 * @param data - The text renderer data.
 * @returns The final vertical padding in pixels.
 */
export function getScaledBoxPaddingY(data: TextRendererData): number {
	// Read the user-defined value, defaulting to 0 if unset
	const userDefinedPadding = data.text?.box?.padding?.y || 0;
	
	// Calculate user's scaled padding
	// Note: If data.text?.box?.padding?.y was explicitly set to 0 in options, it will be 0.
	const scaledUserPadding = userDefinedPadding * getFontAwareScale(data);
	
	// Add the scaled user padding to the MINIMUM_PADDING_PIXELS
	// This ensures the minimum is always present, and the user's padding is additive.
	return scaledUserPadding + MINIMUM_PADDING_PIXELS;
}

/**
 * Calculates the effective horizontal padding for the text box.
 * 
 * This combines the user-defined `text.box.padding.x` with the internal {@link MINIMUM_PADDING_PIXELS},
 * scaling the result based on the font-aware scale factor.
 *
 * @param data - The text renderer data.
 * @returns The final horizontal padding in pixels.
 */
export function getScaledBoxPaddingX(data: TextRendererData): number {
	// Read the user-defined value, defaulting to 0 if unset
	const userDefinedPadding = data.text?.box?.padding?.x || 0;
	
	// Calculate user's scaled padding
	const scaledUserPadding = userDefinedPadding * getFontAwareScale(data);
	
	// Add the scaled user padding to the MINIMUM_PADDING_PIXELS
	return scaledUserPadding + MINIMUM_PADDING_PIXELS;
}

/**
 * Calculates the vertical inflation (expansion) of the background rectangle.
 * 
 * Inflation allows the background color to extend beyond the logical bounds of the text box 
 * without affecting layout positioning.
 *
 * @param data - The text renderer data.
 * @returns The scaled vertical inflation in pixels.
 */
export function getScaledBackgroundInflationY(data: TextRendererData): number {
	return (data.text?.box?.background?.inflation?.y || 0) * getFontAwareScale(data);
}

/**
 * Calculates the horizontal inflation (expansion) of the background rectangle.
 * 
 * @param data - The text renderer data.
 * @returns The scaled horizontal inflation in pixels.
 */
export function getScaledBackgroundInflationX(data: TextRendererData): number {
	return (data.text?.box?.background?.inflation?.x || 0) * getFontAwareScale(data);
}

/**
 * Calculates the scaled padding value used for line spacing.
 * 
 * This value determines the gap between multiple lines of text.
 *
 * @param data - The text renderer data.
 * @returns The scaled padding in pixels.
 */
export function getScaledPadding(data: TextRendererData): number {
	return (data.text?.padding || 0) * getFontAwareScale(data);
}

/**
 * Calculates the final font size in pixels to use for rendering.
 * 
 * This takes the base font size and multiplies it by the calculated font-aware scale factor.
 *
 * @param data - The text renderer data.
 * @returns The scaled font size, rounded up to the nearest integer.
 */
export function getScaledFontSize(data: TextRendererData): number {
	return Math.ceil(getFontSize(data) * getFontAwareScale(data));
}

/**
 * Retrieves the base font size from the renderer options.
 * 
 * If no font size is specified in `data.text.font.size`, it defaults to 30 pixels.
 *
 * @param data - The text renderer data.
 * @returns The base font size in pixels.
 */
export function getFontSize(data: TextRendererData): number {
	return data.text?.font?.size || 30; // Default font size from V3.8
}

/**
 * Calculates a normalization scale factor.
 * 
 * This combines the user-defined `text.box.scale` with an adjustment based on the font size
 * to ensure consistent rendering across different resolutions or zoom levels.
 * It enforces a minimum scale of 0.01 to prevent mathematical errors.
 *
 * @param data - The text renderer data.
 * @returns The effective scale factor.
 */
export function getFontAwareScale(data: TextRendererData): number {

    // Note: We keep a lower clamp like 0.01 to prevent division by zero or negative/zero scale.
	const scale = Math.max(0.01, data.text?.box?.scale || 1); 
    
    // If the effective scale is 1, return it early to prevent unnecessary calculations.
	if (scale === 1) {return scale;} 
    
    // The rest of the calculation is sound:
	const fontSize = getFontSize(data);
	return Math.ceil(scale * fontSize) / fontSize;
}

/**
 * Detects if the current document is in Right-to-Left (RTL) mode.
 * 
 * It checks `window.document.dir` for the value `'rtl'`. This is used to adjust 
 * text alignment defaults (e.g., aligning text to the right by default in RTL contexts).
 *
 * @returns `true` if the document direction is RTL, `false` otherwise.
 */
export function isRtl(): boolean {
	// Uses DOM property to detect right-to-left language direction
	return typeof window !== 'undefined' && 'rtl' === window.document.dir;
}

/**
 * Performs sophisticated word wrapping on a string based on a maximum pixel width.
 * 
 * This function:
 * 1. Respects existing newlines (`\n`).
 * 2. Measures text using an off-screen canvas.
 * 3. Wraps lines that exceed `lineWrapWidth`.
 * 4. Breaks individual words if they are wider than the wrap width.
 *
 * @param text - The input text string.
 * @param font - The CSS font string used for measurement.
 * @param lineWrapWidth - The maximum width in pixels for a single line.
 * @returns An array of strings, where each element is a single visual line.
 */
export function textWrap(text: string, font: string, lineWrapWidth: number | string | undefined): string[] {
	createCacheCanvas(); // Ensure canvas is created before measuring text
	const ctx = ensureNotNull(cacheCanvas); // Get the context

	// Convert lineWrapWidth to a number if it's a string, or handle undefined/null
	let wrapWidthNum: number;
	if (typeof lineWrapWidth === 'string') {
		wrapWidthNum = parseInt(lineWrapWidth);
	} else if (typeof lineWrapWidth === 'number') {
		wrapWidthNum = lineWrapWidth;
	} else {
		wrapWidthNum = 0; // Default to no wrapping if not specified
	}

	// Split text by newlines first
	text += ''; // Ensure text is a string
	const lines = !Number.isInteger(wrapWidthNum) || !isFinite(wrapWidthNum) || wrapWidthNum <= 0
		? text.split(/\r\n|\r|\n|$/) // Split only by newlines if no wrap width
		: text.split(/[^\S\r\n]*(?:\r\n|\r|\n|$)/); // Split by newlines and spaces for wrapping

	if (lines.length > 0 && !lines[lines.length - 1]) { lines.pop(); } // Remove empty last line if exists

	// If no valid wrapWidth, return lines as-is
	if (!Number.isInteger(wrapWidthNum) || !isFinite(wrapWidthNum) || wrapWidthNum <= 0) { return lines; }

	ctx.font = font; // Set font for accurate measurement
	const wrappedLines: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineWidth = ctx.measureText(line).width;

		if (lineWidth <= wrapWidthNum) {
			wrappedLines.push(line);
			continue;
		}

		// Complex word-splitting logic (as per V3.8)
		const splitWordsAndSeparators = line.split(/([-)\]},.!?:;])|(\s+)/); // Split by punctuation and spaces
		const currentLineWords: string[] = [];
		let currentLineWidth = 0;

		for (let j = 0; j < splitWordsAndSeparators.length; j++) {
			const segment = splitWordsAndSeparators[j];
			if (segment === undefined || segment === '') continue;

			const segmentWidth = ctx.measureText(segment).width;

			if (currentLineWidth + segmentWidth <= wrapWidthNum) {
				currentLineWords.push(segment);
				currentLineWidth += segmentWidth;
			} else {
				if (currentLineWords.length > 0) {
					wrappedLines.push(currentLineWords.join(''));
					currentLineWords.length = 0;
					currentLineWidth = 0;
				}
				// If a single word is too long, or it's the start of a new line
				// we need to break the word itself (character by character)
				if (segmentWidth > wrapWidthNum) {
					let tempWord = '';
					for (let k = 0; k < segment.length; k++) {
						const char = segment[k];
						const charWidth = ctx.measureText(char).width;
						if (currentLineWidth + charWidth <= wrapWidthNum) {
							tempWord += char;
							currentLineWidth += charWidth;
						} else {
							if (tempWord.length > 0) {
								wrappedLines.push(tempWord);
							}
							tempWord = char;
							currentLineWidth = charWidth;
						}
					}
					if (tempWord.length > 0) {
						currentLineWords.push(tempWord);
						currentLineWidth = ctx.measureText(tempWord).width; // Recalculate width for the part of word pushed
					}
				} else {
					currentLineWords.push(segment);
					currentLineWidth += segmentWidth;
				}
			}
		}

		if (currentLineWords.length > 0) {
			wrappedLines.push(currentLineWords.join(''));
		}
	}
	return wrappedLines;
}

/**
 * Checks if a CSS color string represents a completely transparent color.
 * 
 * It detects:
 * - The keyword `'transparent'`.
 * - `rgba(...)` strings where alpha is 0.
 * - `hsla(...)` strings where alpha is 0.
 * 
 * @param color - The CSS color string to test.
 * @returns `true` if the color is fully transparent, `false` if opaque or translucent.
 */
export function isFullyTransparent(color: string): boolean {
	// Add defensive check for undefined/null input before operating on the string.
    if (typeof color !== 'string') {
        return false; // Treat non-strings (undefined/null) as non-transparent (or skip the check)
    }

    color = color.toLowerCase().trim();

    if (color === 'transparent') {
        return true;
    }

    // Regex to extract the alpha value from rgba(r,g,b,a) or hsla(h,s,l,a)
    // Matches numbers after the last comma inside rgba()/hsla()
    const alphaRegex = /(?:rgba|hsla)\((?:\s*\d+\s*,){3}\s*(\d*\.?\d+)\s*\)/;
    const match = color.match(alphaRegex);

    if (match && match[1]) {
        const alpha = parseFloat(match[1]);
        return alpha === 0;
    }

    // If it's a hex, rgb, hsl, or named color without alpha, it's considered opaque (not transparent)
    return false;
}