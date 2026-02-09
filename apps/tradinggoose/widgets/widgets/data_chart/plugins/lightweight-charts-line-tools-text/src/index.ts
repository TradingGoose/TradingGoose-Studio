// /src/index.ts

/**
 * Main entry point for the 'lightweight-charts-line-tools-text' plugin.
 * This file registers the Text line tool
 * with the core line tools plugin.
 */

import { ILineToolsPlugin } from '../../lightweight-charts-line-tools-core/src';
import { LineToolText } from './model/LineToolText';

// Define the name under which this specific tool will be registered
const TEXT_LINE_NAME = 'Text';

/**
 * Registers the Text tool with the provided Core Plugin instance.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin.
 * @returns void
 */
export function registerTextPlugin<HorzScaleItem>(corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }): void {
	
	// Register the Text Tool
	// We pass the specific name and the class constructor.
	corePlugin.registerLineTool(TEXT_LINE_NAME, LineToolText);

	console.log(`Registered Line Tool: ${TEXT_LINE_NAME}`);
}

// Export the class itself for direct use/type referencing if necessary
export {
	LineToolText
};

// Export the registration function as the primary way to use the plugin
export default registerTextPlugin;