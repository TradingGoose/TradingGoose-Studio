// /src/index.ts

/**
 * Main entry point for the 'lightweight-charts-line-tools-triangle' plugin.
 * This file registers the LineToolTriangle with the core line tools plugin.
 */

import { ILineToolsPlugin } from '../core';
import { LineToolTriangle } from './model/LineToolTriangle';

// Define the name under which this specific tool will be registered
const TRIANGLE_NAME = 'Triangle';


/**
 * Registers the Triangle tool with the provided Core Plugin instance.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin.
 * @returns void
 *
 * @example
 * ```ts
 * registerTrianglePlugin(corePlugin);
 * ```
 */
export function registerTrianglePlugin<HorzScaleItem>(corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }): void {
	// 1. Register the Triangle Tool
	corePlugin.registerLineTool(TRIANGLE_NAME, LineToolTriangle);
}

// Export the class itself for direct use/type referencing if necessary
export { LineToolTriangle };

// Export the registration function as the primary way to use the plugin
export default registerTrianglePlugin;
