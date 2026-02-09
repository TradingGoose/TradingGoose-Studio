// /src/index.ts

/**
 * Main entry point for the 'lightweight-charts-line-tool-lines' plugin.
 * This file registers all contained line tools (starting with TrendLine)
 * with the core line tools plugin.
 */

import { ILineToolsPlugin } from '../core';
import { LineToolTrendLine } from './model/LineToolTrendLine';
import { LineToolExtendedLine } from './model/LineToolExtendedLine';
import { LineToolArrow } from './model/LineToolArrow';
import { LineToolRay } from './model/LineToolRay';
import { LineToolHorizontalLine } from './model/LineToolHorizontalLine';
import { LineToolHorizontalRay } from './model/LineToolHorizontalRay';
import { LineToolVerticalLine } from './model/LineToolVerticalLine';
import { LineToolCrossLine } from './model/LineToolCrossLine';
import { LineToolCallout } from './model/LineToolCallout';

// Define the name under which this specific tool will be registered
const TREND_LINE_NAME = 'TrendLine';
const EXTENDED_LINE_NAME = 'ExtendedLine';
const ARROW_LINE_NAME = 'Arrow';
const RAY_LINE_NAME = 'Ray';
const HORIZONTAL_LINE_NAME = 'HorizontalLine';
const HORIZONTAL_RAY_NAME = 'HorizontalRay';
const VERTICAL_LINE_NAME = 'VerticalLine';
const CROSS_LINE_NAME = 'CrossLine';
const CALLOUT_LINE_NAME = 'Callout'; 

/**
 * Registers all standard line tools (Trend Line, Ray, Arrow, Extended Line, Horizontal Line,
 * Horizontal Ray, Vertical Line, Cross Line, and Callout) with the provided Core Plugin instance.
 *
 * This is the primary entry point for enabling the standard suite of drawing tools.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin (created via `createLineToolsPlugin`).
 * @returns void
 *
 * @example
 * ```ts
 * import { createLineToolsPlugin } from '../core';
 * import { registerLinesPlugin } from 'lightweight-charts-line-tools-lines';
 *
 * const corePlugin = createLineToolsPlugin(chart, series);
 * registerLinesPlugin(corePlugin);
 * ```
 */
export function registerLinesPlugin<HorzScaleItem>(corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }): void {
	// 1. Register the TrendLine Tool
	// We pass the specific name and the class constructor.
	corePlugin.registerLineTool(TREND_LINE_NAME, LineToolTrendLine);
	corePlugin.registerLineTool(EXTENDED_LINE_NAME, LineToolExtendedLine);
	corePlugin.registerLineTool(ARROW_LINE_NAME, LineToolArrow);
	corePlugin.registerLineTool(RAY_LINE_NAME, LineToolRay);
	corePlugin.registerLineTool(HORIZONTAL_LINE_NAME, LineToolHorizontalLine);
	corePlugin.registerLineTool(HORIZONTAL_RAY_NAME, LineToolHorizontalRay);
	corePlugin.registerLineTool(VERTICAL_LINE_NAME, LineToolVerticalLine);
	corePlugin.registerLineTool(CROSS_LINE_NAME, LineToolCrossLine);
	corePlugin.registerLineTool(CALLOUT_LINE_NAME, LineToolCallout);


	// For the full plugin, the other tools would be registered here:
	// corePlugin.registerLineTool('Ray', LineToolRay);
	// corePlugin.registerLineTool('ExtendedLine', LineToolExtendedLine);
	// ... etc.

	console.log(`Registered Line Tool: ${TREND_LINE_NAME}`);
	console.log(`Registered Line Tool: ${EXTENDED_LINE_NAME}`);
	console.log(`Registered Line Tool: ${ARROW_LINE_NAME}`);
	console.log(`Registered Line Tool: ${RAY_LINE_NAME}`);
	console.log(`Registered Line Tool: ${HORIZONTAL_LINE_NAME}`);
	console.log(`Registered Line Tool: ${HORIZONTAL_RAY_NAME}`);
	console.log(`Registered Line Tool: ${VERTICAL_LINE_NAME}`);
	console.log(`Registered Line Tool: ${CROSS_LINE_NAME}`);
	console.log(`Registered Line Tool: ${CALLOUT_LINE_NAME}`);
}

// Export the class itself for direct use/type referencing if necessary
export {
	LineToolTrendLine,
	LineToolExtendedLine,
	LineToolArrow,
	LineToolRay,
	LineToolHorizontalLine,
	LineToolHorizontalRay,
	LineToolVerticalLine,
	LineToolCrossLine,
	LineToolCallout,
};

// Export the registration function as the primary way to use the plugin
export default registerLinesPlugin;