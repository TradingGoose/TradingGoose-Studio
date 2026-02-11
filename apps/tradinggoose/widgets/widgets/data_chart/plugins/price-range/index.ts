// lightweight-charts-line-tools-price-range/src/index.ts

/**
 * This is the main entry point for the 'lightweight-charts-line-tools-price-range' plugin.
 * It exports the LineToolPriceRange class for registration with the core line tools plugin.
 */

import { ILineToolsPlugin } from '../core';
import { LineToolPriceRange } from './model/LineToolPriceRange';

// Define the name under which this specific tool will be registered
const PRICE_RANGE_LINE_NAME = 'PriceRange';

/**
 * Registers the Price Range tool with the provided Core Plugin instance.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin.
 * @returns void
 *
 * @example
 * ```ts
 * registerPriceRangePlugin(corePlugin);
 * ```
 */
export function registerPriceRangePlugin<HorzScaleItem>(corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }): void {
	
	// Register the PriceRange Tool
	// We pass the specific name and the class constructor.
	corePlugin.registerLineTool(PRICE_RANGE_LINE_NAME, LineToolPriceRange);

}

// Export the class itself for direct use/type referencing if necessary
export {
	LineToolPriceRange
};

// Export the registration function as the primary way to use the plugin
export default registerPriceRangePlugin;