// /lightweight-charts-line-tools-long-short-position/src/index.ts

/**
 * This is the main entry point for the 'lightweight-charts-line-tools-long-short-position' plugin.
 * It exports the LineToolLongShortPosition class for registration with the core line tools plugin.
 */

import { ILineToolsPlugin } from '../core';
import { LineToolLongShortPosition } from './model/LineToolLongShortPosition';

// Define the name under which this specific tool will be registered
const LONG_SHORT_POSITION_TOOL_NAME = 'LongShortPosition';

/**
 * Registers the Long/Short Position tool with the provided Core Plugin instance.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin.
 * @returns void
 *
 * @example
 * ```ts
 * registerLongShortPositionPlugin(corePlugin);
 * ```
 */
export function registerLongShortPositionPlugin<HorzScaleItem>(
	corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }
): void {
	
	// Register the LongShortPosition Tool
	// We pass the specific name and the class constructor.
	corePlugin.registerLineTool(LONG_SHORT_POSITION_TOOL_NAME, LineToolLongShortPosition);

}

// Export the class itself for direct use/type referencing if necessary
export {
	LineToolLongShortPosition
};

// Export the registration function as the primary way to use the plugin
export default registerLongShortPositionPlugin;