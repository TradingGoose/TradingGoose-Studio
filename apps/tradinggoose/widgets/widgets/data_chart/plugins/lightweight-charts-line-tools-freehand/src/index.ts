// /src/index.ts

/**
 * Main entry point for the 'lightweight-charts-line-tools-freehand' plugin.
 * This file registers all contained line tools (starting with Brush)
 * with the core line tools plugin.
 */

import { ILineToolsPlugin } from '../../lightweight-charts-line-tools-core/src';
import { LineToolBrush } from './model/LineToolBrush';
import { LineToolHighlighter } from './model/LineToolHighlighter';

// Define the name under which this specific tool will be registered
const BRUSH_NAME = 'Brush';
const HIGHLIGHTER_NAME = 'Highlighter'; 


/**
 * Registers the Freehand tools (Brush and Highlighter) with the provided Core Plugin instance.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin.
 * @returns void
 *
 * @example
 * ```ts
 * registerFreehandPlugin(corePlugin);
 * ```
 */
export function registerFreehandPlugin<HorzScaleItem>(corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }): void {
	// 1. Register the Brush Tool
	corePlugin.registerLineTool(BRUSH_NAME, LineToolBrush);
	console.log(`Registered Line Tool: ${BRUSH_NAME}`);

	corePlugin.registerLineTool(HIGHLIGHTER_NAME, LineToolHighlighter);
	console.log(`Registered Line Tool: ${HIGHLIGHTER_NAME}`)
}

// Export the class itself for direct use/type referencing if necessary
export { LineToolBrush };
export { LineToolHighlighter };

// Export the registration function as the primary way to use the plugin
export default registerFreehandPlugin;