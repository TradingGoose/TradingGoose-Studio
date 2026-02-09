// src/index.ts

/**
 * Main entry point for the 'lightweight-charts-line-tools-parallel-channel' plugin.
 * This file registers the LineToolParallelChannel class with the core line tools plugin.
 */

import { ILineToolsPlugin } from '../../lightweight-charts-line-tools-core/src';
import { LineToolParallelChannel } from './model/LineToolParallelChannel';

// Define the name under which this specific tool will be registered
const PARALLEL_CHANNEL_NAME = 'ParallelChannel';

/**
 * Registers the Parallel Channel tool with the provided Core Plugin instance.
 *
 * This function serves as the entry point to enable the Parallel Channel functionality
 * within your Lightweight Charts application.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin (created via `createLineToolsPlugin`).
 * @returns void
 *
 */
export function registerParallelChannelPlugin<HorzScaleItem>(corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }): void {
	// 1. Register the ParallelChannel Tool
	corePlugin.registerLineTool(PARALLEL_CHANNEL_NAME, LineToolParallelChannel);

	console.log(`Registered Line Tool: ${PARALLEL_CHANNEL_NAME}`);
}

// Export the LineToolParallelChannel class for direct use/type referencing if necessary
export {
	LineToolParallelChannel,
};

// Export the registration function as the primary way to use the plugin
export default registerParallelChannelPlugin;