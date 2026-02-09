// /src/index.ts

/**
 * This is the main entry point for the 'lightweight-charts-line-tool-circle' plugin.
 * It exports the LineToolCircle class for registration with the core line tools plugin.
 */

// Import the main LineToolCircle class
import { LineToolCircle } from './model/LineToolCircle';

// Re-export the LineToolCircle class to make it available
// for external modules (like the core line tools plugin)
export { LineToolCircle };