// /src/utils/helpers.ts

/**
 * This file contains a collection of general-purpose utility functions
 * consolidated from the original v3.8 build. These helpers are used across
 * the core plugin and are essential for state management, configuration, and
 * unique ID generation.
 */

// #region Color Utilities (Ported from v3.8 helpers/color.ts)

// Internal types needed for generateContrastColors
type RedComponent = number;   // Simplified for our purpose
type GreenComponent = number; // Simplified for our purpose
type BlueComponent = number;  // Simplified for our purpose
type AlphaComponent = number; // Simplified for our purpose
type Rgba = [RedComponent, GreenComponent, BlueComponent, AlphaComponent];

/**
 * Internal helper to parse a CSS color string into its RGBA components.
 * 
 * Supports various formats:
 * - Hex: `#RGB`, `#RRGGBB`
 * - Functional: `rgb(r, g, b)`, `rgba(r, g, b, a)`
 * - Keywords: `transparent`, `white`
 * 
 * @param colorString - The input color string.
 * @returns A tuple `[r, g, b, a]` where components are integers 0-255 (alpha is 0-1).
 */
function colorStringToRgba(colorString: string): Rgba {
	colorString = colorString.toLowerCase();

    // Handle 'transparent' keyword
    if (colorString === 'transparent') {
        return [0, 0, 0, 0];
    }

	// Regex for rgba(r, g, b, a)
	const rgbaRe = /^rgba\(\s*(-?\d{1,10})\s*,\s*(-?\d{1,10})\s*,\s*(-?\d{1,10})\s*,\s*(-?[\d]{0,10}(?:\.\d+)?)\s*\)$/;
    let matches = rgbaRe.exec(colorString);
    if (matches) {
        return [
            parseInt(matches[1], 10) as RedComponent,
            parseInt(matches[2], 10) as GreenComponent,
            parseInt(matches[3], 10) as BlueComponent,
            parseFloat(matches[4]) as AlphaComponent,
        ];
    }
    
    // Regex for rgb(r, g, b) - with default alpha 1
    const rgbRe = /^rgb\(\s*(-?\d{1,10})\s*,\s*(-?\d{1,10})\s*,\s*(-?\d{1,10})\s*\)$/;
    matches = rgbRe.exec(colorString);
    if (matches) {
        return [
            parseInt(matches[1], 10) as RedComponent,
            parseInt(matches[2], 10) as GreenComponent,
            parseInt(matches[3], 10) as BlueComponent,
            1 as AlphaComponent,
        ];
    }

    // Regex for #RRGGBB or #RGB - with default alpha 1
	const hexRe = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
    matches = hexRe.exec(colorString);
    if (matches) {
        return [
            parseInt(matches[1], 16) as RedComponent,
            parseInt(matches[2], 16) as GreenComponent,
            parseInt(matches[3], 16) as BlueComponent,
            1 as AlphaComponent,
        ];
    }
    const shortHexRe = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
    matches = shortHexRe.exec(colorString);
    if (matches) {
        return [
            parseInt(matches[1] + matches[1], 16) as RedComponent,
            parseInt(matches[2] + matches[2], 16) as GreenComponent,
            parseInt(matches[3] + matches[3], 16) as BlueComponent,
            1 as AlphaComponent,
        ];
    }

    // Fallback for named colors or other formats -
    // for simplicity in this port, we'll assume white or transparent if not directly parseable.
    // In v3.8, it had a large map of named colors. We'll simplify.
    if (colorString.includes('white') || colorString === '#fff') {
        return [255, 255, 255, 1];
    }

	// Default to transparent if parsing fails. This is a simplification.
	console.warn(`[helpers.ts]Could not parse color: ${colorString}. Defaulting to transparent.`);
	return [0, 0, 0, 0];
}

/**
 * Internal helper to calculate the luminance (grayscale value) of an RGB color.
 * 
 * Uses a weighted formula based on human perception (NTSC standard weights modified for this specific implementation) 
 * to determine how "bright" the color is.
 * 
 * @param rgbValue - The `[r, g, b, a]` tuple.
 * @returns A number representing luminance (0-255).
 */
function rgbaToGrayscale(rgbValue: Rgba): number {
	// Originally, the NTSC RGB to YUV formula
	const redComponentGrayscaleWeight = 0.199;
	const greenComponentGrayscaleWeight = 0.687;
	const blueComponentGrayscaleWeight = 0.114;

	return (
		redComponentGrayscaleWeight * rgbValue[0] +
		greenComponentGrayscaleWeight * rgbValue[1] +
		blueComponentGrayscaleWeight * rgbValue[2]
	);
}

/**
 * Represents a pair of colors designed to ensure text readability.
 * 
 * Used primarily by axis views to determine the best text color (foreground) 
 * to display on top of a specific label background color.
 */
export interface ContrastColors {
	foreground: string;
	background: string;
}

/**
 * Generates a high-contrast color pair based on a given background color string.
 * 
 * This utility parses CSS color strings (RGBA, RGB, Hex, or named colors) to calculate
 * the background's luminance. It then returns 'black' or 'white' as the foreground color
 * to ensure maximum readability.
 *
 * @param backgroundColor - A CSS color string (e.g., `'#FF0000'`, `'rgba(0, 0, 0, 0.5)'`).
 * @returns A {@link ContrastColors} object containing the background and the optimal foreground color.
 */
export function generateContrastColors(backgroundColor: string): ContrastColors {
	const rgb = colorStringToRgba(backgroundColor);
     // If alpha is 0, foreground could be anything, but 'white' is a safe default.
    if (rgb[3] === 0) {
        return {
            background: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${rgb[3]})`,
            foreground: 'white',
        };
    }
	return {
		background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
		foreground: rgbaToGrayscale(rgb) > 160 ? 'black' : 'white',
	};
}

// #endregion Color Utilities


// #region Type Checking and Assertion Utilities

/**
 * Type guard to check if a value is a finite number.
 * 
 * @param value - The value to check.
 * @returns `true` if the value is of type 'number' and is not `Infinity` or `NaN`.
 */
export function isNumber(value: unknown): value is number {
	return (typeof value === 'number') && (isFinite(value));
}

/**
 * Checks if a value is an integer number.
 * 
 * @param value - The value to check.
 * @returns `true` if the value is a number with no fractional part.
 */
export function isInteger(value: unknown): boolean {
	return (typeof value === 'number') && ((value % 1) === 0);
}

/**
 * Type guard to check if a value is a string.
 * 
 * @param value - The value to check.
 * @returns `true` if the value is of type 'string'.
 */
export function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/**
 * Type guard to check if a value is a boolean.
 * 
 * @param value - The value to check.
 * @returns `true` if the value is of type 'boolean'.
 */
export function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

/**
 * asserts that a condition is true.
 * 
 * If the condition is false, this function throws an Error. This is useful for 
 * invariant checking and narrowing types in TypeScript flow analysis.
 *
 * @param condition - The boolean condition to verify.
 * @param message - Optional text to include in the Error message if the assertion fails.
 * @throws Error if `condition` is `false`.
 */
export function assert(condition: boolean, message?: string): asserts condition {
	if (!condition) {
		throw new Error('Assertion failed' + (message ? ': ' + message : ''));
	}
}

/**
 * Ensures a value is not `null`.
 * 
 * This is a utility for runtime checks where TypeScript might allow `null` but the 
 * logic strictly requires a value.
 *
 * @typeParam T - The type of the value.
 * @param value - The value to check.
 * @returns The value `T` (guaranteed not to be null).
 * @throws Error if `value` is `null`.
 */
export function ensureNotNull<T>(value: T | null): T {
	if (value === null) {
		throw new Error('Value is null');
	}
	return value;
}

/**
 * Ensures a value is not `undefined`.
 * 
 * Similar to {@link ensureNotNull}, this guarantees existence at runtime.
 *
 * @typeParam T - The type of the value.
 * @param value - The value to check.
 * @returns The value `T` (guaranteed not to be undefined).
 * @throws Error if `value` is `undefined`.
 */
export function ensureDefined<T>(value: T | undefined): T {
	if (value === undefined) {
		throw new Error('Value is undefined');
	}
	return value;
}

// #endregion

// #region Object Manipulation Utilities

/**
 * Creates a deep copy of an object, array, or Date.
 * 
 * This recursive function ensures that nested structures are duplicated rather than 
 * referenced, preventing side effects when modifying configuration objects or state.
 *
 * @typeParam T - The type of the object being copied.
 * @param object - The source object to copy.
 * @returns A strictly typed deep copy of the input.
 */
export function deepCopy<T>(object: T): T {
	// If not an object or null, return the value as is (base case)
	if (typeof object !== 'object' || object === null) {
		return object;
	}

	// Handle Date objects
	if (object instanceof Date) {
		return new Date(object.getTime()) as any;
	}

	// Handle Arrays
	if (Array.isArray(object)) {
		// Recursively deep copy each element in the array
		return object.map(item => deepCopy(item)) as any;
	}

	// Handle plain objects
	const copy: { [key: string]: any } = {};
	for (const key in object) {
		// Ensure we only copy own properties and not inherited ones
		if (Object.prototype.hasOwnProperty.call(object, key)) {
			// Recursively deep copy the value of the property
			copy[key] = deepCopy(object[key]);
		}
	}

	return copy as T;
}

/**
 * Deeply merges multiple source objects into a destination object.
 * 
 * **Special Behavior for Arrays:** 
 * Unlike standard merges, if a source array is shorter than the destination array, 
 * the destination array is truncated to match the length of the source. This prevents 
 * stale data (e.g., old points) from lingering when a tool is updated with fewer points.
 *
 * @param dst - The target object to modify.
 * @param sources - One or more source objects to merge properties from.
 * @returns The modified `dst` object.
 */
export function merge(dst: Record<string, any>, ...sources: Record<string, any>[]): Record<string, any> {
	for (const src of sources) {
		for (const key in src) {
			if (src[key] === undefined) {
				continue;
			}

			const srcValue = src[key];
			const dstValue = dst[key];

			if (Array.isArray(srcValue) && Array.isArray(dstValue)) {
				// Trim destination array if source is shorter
				if (srcValue.length < dstValue.length) {
					dstValue.length = srcValue.length;
				}

				for (let i = 0; i < srcValue.length; i++) {
					const srcElement = srcValue[i];
					const dstElement = dstValue[i];

					if (typeof srcElement !== 'object' || srcElement === null || dstElement === undefined) {
						dstValue[i] = srcElement;
					} else if (typeof dstElement === 'object' && dstElement !== null) {
						// Recursively merge nested object properties
						merge(dstValue[i], srcValue[i]);
					} else {
						// Overwrite non-object or non-existing properties
						dstValue[i] = srcElement;
					}
				}
			} else if (typeof srcValue === 'object' && srcValue !== null && typeof dstValue === 'object' && dstValue !== null) {
				// Recursively merge nested object properties
				merge(dstValue, srcValue);
			} else {
				// Overwrite non-object or non-existing properties
				dst[key] = srcValue;
			}
		}
	}
	return dst;
}

// #endregion

// #region Unique ID Generation

const HASH_SOURCE = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generates a random alphanumeric hash string.
 * 
 * Used primarily for generating unique identifiers (`id`) for new line tools 
 * if one is not provided by the user.
 *
 * @param count - The length of the hash to generate (default is 12).
 * @returns A random string.
 */
export function randomHash(count: number = 12): string {
	let hash = '';
	for (let i = 0; i < count; ++i) {
		const index = Math.floor(Math.random() * HASH_SOURCE.length);
		hash += HASH_SOURCE[index];
	}
	return hash;
}

// #endregion

// #region Font and Canvas Helpers

/**
 * The default font stack used by the plugin for text rendering.
 * Value: `'Trebuchet MS', Roboto, Ubuntu, sans-serif`
 */
export const defaultFontFamily = `'Trebuchet MS', Roboto, Ubuntu, sans-serif`;

/**
 * Constructs a valid CSS font string for the HTML5 Canvas context.
 * 
 * @param size - The font size in pixels.
 * @param family - The font family (defaults to {@link defaultFontFamily}).
 * @param style - Optional style (e.g., `'bold'`, `'italic'`).
 * @returns A string like `"bold 14px 'Trebuchet MS'"`.
 */
export function makeFont(size: number, family?: string, style?: string): string {
	if (style) {
		style = `${style} `;
	} else {
		style = '';
	}

	if (!family) {
		family = defaultFontFamily;
	}

	return `${style}${size}px ${family}`;
}

// #endregion



/**
 * A generic function signature for event callbacks.
 * 
 * Supports up to three typed parameters.
 * @typeParam T1 - Type of the first parameter.
 * @typeParam T2 - Type of the second parameter.
 * @typeParam T3 - Type of the third parameter.
 */
export type Callback<T1 = void, T2 = void, T3 = void> = (param1: T1, param2: T2, param3: T3) => void;

/**
 * Interface representing a subscription management object.
 * 
 * Mirrors the internal `ISubscription` from Lightweight Charts, allowing consumers to
 * add or remove event listeners.
 */
export interface ISubscription<T1 = void, T2 = void, T3 = void> {
	subscribe(callback: Callback<T1, T2, T3>, linkedObject?: unknown, singleshot?: boolean): void;
	unsubscribe(callback: Callback<T1, T2, T3>): void;
	unsubscribeAll(linkedObject: unknown): void;
}

/**
 * A robust event dispatcher implementation.
 * 
 * This class mimics the internal `Delegate` used by Lightweight Charts. It maintains a list
 * of subscribers and broadcasts events to them. It supports linking subscriptions to specific
 * objects for bulk-unsubscribe and "singleshot" (one-time) listeners.
 */
export class Delegate<T1 = void, T2 = void, T3 = void> implements ISubscription<T1, T2, T3> {
	/**
     * Internal list of active subscribers.
     * @private
     */
	private _listeners: {
		callback: Callback<T1, T2, T3>;
		linkedObject?: unknown;
		singleshot: boolean;
	}[] = [];

	/**
	 * Subscribes a callback function to the delegate.
     * 
     * When the event is fired, this callback will be executed with the provided arguments.
	 * 
	 * @param callback - The function to call when the event fires.
	 * @param linkedObject - An optional object to link the subscription to. This allows removing multiple unrelated subscriptions at once via {@link unsubscribeAll}.
	 * @param singleshot - If `true`, the subscription is automatically removed after the first time it is called.
	 */
	public subscribe(callback: Callback<T1, T2, T3>, linkedObject?: unknown, singleshot?: boolean): void {
		const listener = {
			callback,
			linkedObject,
			singleshot: singleshot === true,
		};
		this._listeners.push(listener);
	}

	/**
	 * Unsubscribes a specific callback function from the delegate.
     * 
     * If the callback was added multiple times, this typically removes the first occurrence 
     * depending on implementation, though delegates usually enforce unique callback references per subscription context.
	 * 
	 * @param callback - The specific function reference to remove.
	 */
	public unsubscribe(callback: Callback<T1, T2, T3>): void {
		const index = this._listeners.findIndex(listener => callback === listener.callback);
		if (index > -1) {
			this._listeners.splice(index, 1);
		}
	}

	/**
	 * Unsubscribes all callbacks that were registered with a specific `linkedObject`.
     * 
     * This is useful for cleaning up all event listeners associated with a specific UI component 
     * or tool instance when it is destroyed.
	 * 
	 * @param linkedObject - The object key used during subscription.
	 */
	public unsubscribeAll(linkedObject: unknown): void {
		this._listeners = this._listeners.filter(listener => listener.linkedObject !== linkedObject);
	}

	/**
	 * Fires the event, calling all subscribed callbacks with the provided arguments.
     * 
     * This method takes a snapshot of the listeners array before iterating to ensure that 
     * if a listener unsubscribes itself during execution, the iteration remains stable.
     * 
     * @param param1 - The first event argument.
     * @param param2 - The second event argument.
     * @param param3 - The third event argument.
	 */
	public fire(param1: T1, param2: T2, param3: T3): void {
		// Create a snapshot of listeners to prevent issues if listeners modify the array during firing
		const listenersSnapshot = [...this._listeners];
		// Filter out singleshot listeners if they were not removed by their own callback
		this._listeners = this._listeners.filter(listener => !listener.singleshot);
		listenersSnapshot.forEach(listener => listener.callback(param1, param2, param3));
	}

	/**
	 * Checks if the delegate has any active listeners.
     * 
     * This is useful for avoiding expensive calculations if no one is listening to the event.
     * 
	 * @returns `true` if there is at least one active subscriber, `false` otherwise.
	 */
	public hasListeners(): boolean {
		return this._listeners.length > 0;
	}

	/**
	 * Clears all listeners and frees up resources.
     * 
     * This should be called when the owner of the Delegate (e.g., the Plugin or a Tool) 
     * is being destroyed to prevent memory leaks.
	 */
	public destroy(): void {
		this._listeners = [];
	}
}

// #region DeepPartial and OmitRecursively Type Definitions (self-contained)

/**
 * Internal utility type used to flatten complex intersection types into a single object type.
 * 
 * This helps improve the readability of type hints in IDEs (like VS Code) when inspecting 
 * types generated by `OmitRecursively` or `DeepPartial`. without this, tooltips often show 
 * raw intersection logic (e.g., `A & B`) instead of the resulting properties.
 * 
 * @typeParam T - The type to flatten.
 */
export type Id<T> = {} & { [P in keyof T]: T[P] }; // Ensure this is present

/**
 * Internal utility to apply `Omit` distributively across union types.
 * 
 * Standard `Omit` can behave unexpectedly with unions. This helper ensures that the 
 * omission logic is applied to each member of a union individually before recombining them.
 * 
 * @typeParam T - The union type.
 * @typeParam K - The keys to omit.
 */
export type OmitDistributive<T, K extends PropertyKey> = T extends any ? (T extends object ? Id<OmitRecursively<T, K>> : T) : never;

/**
 * A utility type that recursively marks all properties of type `T` as optional.
 * 
 * This is essential for configuration objects where the user might only provide 
 * a few specific overrides (e.g., changing just the line color inside a complex style object).
 */
export type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends (infer U)[]
		? DeepPartial<U>[]
		: T[P] extends readonly (infer X)[]
			? readonly DeepPartial<X>[]
			: DeepPartial<T[P]>
};

/**
 * A utility type that recursively removes a specific key `K` from type `T` and all its nested objects.
 * 
 * Useful for sanitizing configuration objects or removing internal flags from public interfaces.
 */
export type OmitRecursively<T extends any, K extends PropertyKey> = Omit<
    { [P in keyof T]: OmitDistributive<T[P], K> },
    K
>;

// #endregion DeepPartial and OmitRecursively Type Definitions