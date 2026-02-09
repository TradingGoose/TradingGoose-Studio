// /src/index.ts

/**
 * This is the main entry point for the 'lightweight-charts-line-tool-rectangle' plugin.
 * It exports the LineToolRectangle class for registration with the core line tools plugin.
 */

// Import the main LineToolRectangle class
import { LineToolRectangle } from './model/LineToolRectangle';
import { LineToolRectanglePaneView } from './views/LineToolRectanglePaneView';

// Re-export the LineToolRectangle class to make it available
// for external modules (like the core line tools plugin)
export { LineToolRectangle, LineToolRectanglePaneView };

// Optionally, if you wanted to provide a factory function for this specific tool,
// you might do it here. But for registration with the core plugin, exporting the class is sufficient.
// export function createLineToolRectangle(chart: any, series: any, options?: any): LineToolRectangle {
//     // This would be if you wanted to create it directly without the core's add method
//     // For our current design, the core plugin's add method handles instantiation.
//     return new LineToolRectangle(chart, series, options);
// }
