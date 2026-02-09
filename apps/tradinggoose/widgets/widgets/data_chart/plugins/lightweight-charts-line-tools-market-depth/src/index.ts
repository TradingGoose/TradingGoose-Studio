// lightweight-charts-line-tools-market-depth/src/index.ts

/**
 * Main entry point for the 'lightweight-charts-line-tools-market-depth' plugin.
 * This file registers the MarketDepth line tool with the core line tools plugin.
 */

import { ILineToolsPlugin } from '../../lightweight-charts-line-tools-core/src';
import { LineToolMarketDepth } from './model/LineToolMarketDepth';

// Define the name under which this specific tool will be registered
const MARKET_DEPTH_NAME = 'MarketDepth';

/**
 * Registers the Market Depth tool with the provided Core Plugin instance.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin.
 * @returns void
 *
 * @example
 * ```ts
 * registerMarketDepthPlugin(corePlugin);
 * ```
 */
export function registerMarketDepthPlugin<HorzScaleItem>(corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }): void {
	
	// Register the MarketDepth Tool
	corePlugin.registerLineTool(MARKET_DEPTH_NAME, LineToolMarketDepth);

	console.log(`Registered Line Tool: ${MARKET_DEPTH_NAME}`);
}

// Export the class itself for direct use/type referencing if necessary
export {
	LineToolMarketDepth
};

// Export the registration function as the primary way to use the plugin
export default registerMarketDepthPlugin;