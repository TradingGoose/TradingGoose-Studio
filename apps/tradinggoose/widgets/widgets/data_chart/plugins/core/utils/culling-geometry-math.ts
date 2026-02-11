// /src/utils/culling-geometry-math.ts

// NOTE: These primitives will be used internally by the Core Plugin
// to perform vector math. They are not intended for general public consumption.

/**
 * Represents a simple 2D vector or point with X and Y coordinates.
 * Used primarily for internal geometric calculations in the culling engine.
 */
export interface Vec2 {
    x: number;
    y: number;
}

/**
 * Represents the coefficients of a linear equation in the slope-intercept form: `y = ax + b`.
 */
export interface LineEquation {
    /** The slope of the line (m). */
    a: number;
    /** The y-intercept of the line (b). */
    b: number;
}

/**
 * Computes the linear equation passing through two points.
 * 
 * Derives the slope (`a`) and y-intercept (`b`) for the line passing through `p1` and `p2`.
 *
 * @param p1 - The first point.
 * @param p2 - The second point.
 * @returns A {@link LineEquation} object containing the slope and intercept, or `null` if the line is vertical (slope is undefined).
 */
export function createLineEquation(p1: Vec2, p2: Vec2): LineEquation | null {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    if (dx === 0) {
        // Vertical Line: No simple y = mx + b form.
        return null; 
    }

    const slope = dy / dx; // m = a
    const yIntercept = p1.y - slope * p1.x; // b = b

    return { a: slope, b: yIntercept };
}