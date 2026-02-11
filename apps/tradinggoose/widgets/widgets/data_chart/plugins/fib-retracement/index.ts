// /lightweight-charts-line-tools-fib-retracement/src/index.ts

/**
 * This is the main entry point for the 'lightweight-charts-line-tools-fib-retracement' plugin.
 * It exports the LineToolFibRetracement class and a registration function for the core plugin.
 */

// Import the main LineToolFibRetracement class
import { LineToolFibRetracement } from './model/LineToolFibRetracement';
import { ILineToolsPlugin } from '../core';

// Define the name under which this specific tool will be registered
const FIB_RETRACEMENT_NAME = 'FibRetracement';

/**
 * Registers the Fibonacci Retracement tool with the provided Core Plugin instance.
 *
 * @param corePlugin - The instance of the Core Line Tools Plugin.
 * @returns void
 *
 * @example
 * ```ts
 * registerFibRetracementPlugin(corePlugin);
 * ```
 */
export function registerFibRetracementPlugin<HorzScaleItem>(corePlugin: ILineToolsPlugin & { registerLineTool: <H>(type: string, toolClass: new (...args: any[]) => any) => void }): void {
	
	// Register the LineToolFibRetracement Class
	corePlugin.registerLineTool(FIB_RETRACEMENT_NAME, LineToolFibRetracement);

}

// Export the class itself for direct use/type referencing if necessary
export {
	LineToolFibRetracement,
};

// Export the registration function as the primary way to use the plugin
export default registerFibRetracementPlugin;