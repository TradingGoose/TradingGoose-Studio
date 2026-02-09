// /src/utils/geometry.ts

import { Coordinate, ISeriesApi, SeriesType, Time, UTCTimestamp, IChartApiBase, Logical, BarPrice } from 'lightweight-charts';
import { BaseLineTool } from '../model/base-line-tool';



// --- Local Redefinitions of Geometric Primitives (from V3.8 model/point.ts) ---

/**
 * Represents a 2D point or vector in the chart's coordinate system.
 * 
 * This class provides standard vector arithmetic operations required for geometric calculations,
 * hit testing, and rendering logic.
 */
export class Point {
	/** The x-coordinate (pixel value). */
    public x!: Coordinate;
	/** The y-coordinate (pixel value). */
    public y!: Coordinate;

    /**
     * Creates a new Point instance.
     * @param x - The x-coordinate.
     * @param y - The y-coordinate.
     */	
    public constructor(x: number, y: number)
    public constructor(x: Coordinate, y: Coordinate) {
        (this.x as Coordinate) = x;
        (this.y as Coordinate) = y;
    }

	/**
     * Adds another point/vector to this one.
     * @param point - The point to add.
     * @returns A new Point representing the sum (`this + point`).
     */
    public add(point: Point): Point {
        return new Point(this.x + point.x, this.y + point.y);
    }

    /**
     * Adds a scaled version of another point/vector to this one.
     * Useful for linear interpolations or projections.
     * 
     * @param point - The direction vector to add.
     * @param scale - The scalar factor to multiply `point` by before adding.
     * @returns A new Point representing (`this + (point * scale)`).
     */	
    public addScaled(point: Point, scale: number): Point {
        return new Point(this.x + scale * point.x, this.y + scale * point.y);
    }

    /**
     * Subtracts another point/vector from this one.
     * @param point - The point to subtract.
     * @returns A new Point representing the difference (`this - point`).
     */	
    public subtract(point: Point): Point {
        return new Point(this.x - point.x, this.y - point.y);
    }

    /**
     * Calculates the dot product of this vector and another.
     * Formula: `x1*x2 + y1*y2`.
     * 
     * @param point - The other vector.
     * @returns The scalar dot product.
     */	
    public dotProduct(point: Point): number {
        return this.x * point.x + this.y * point.y;
    }

    /**
     * Calculates the 2D cross product (determinant) magnitude of this vector and another.
     * Formula: `x1*y2 - y1*x2`.
     * 
     * @param point - The other vector.
     * @returns The scalar cross product.
     */	
    public crossProduct(point: Point): number {
        return this.x * point.y - this.y * point.x;
    }

    /**
     * Calculates the signed angle between this vector and another.
     * 
     * @param point - The other vector.
     * @returns The angle in radians (range -π to π).
     */	
    public signedAngle(point: Point): number {
        return Math.atan2(this.crossProduct(point), this.dotProduct(point));
    }

    /**
     * Calculates the unsigned angle between this vector and another.
     * 
     * @param point - The other vector.
     * @returns The angle in radians (range 0 to π).
     */	
    public angle(point: Point): number {
        return Math.acos(this.dotProduct(point) / (this.length() * point.length()));
    }

    /**
     * Calculates the Euclidean length (magnitude) of the vector.
     * @returns The length of the vector.
     */	
    public length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    /**
     * Multiplies the vector by a scalar value.
     * @param scale - The scaling factor.
     * @returns A new scaled Point.
     */	
    public scaled(scale: number): Point {
        return new Point(this.x * scale, this.y * scale);
    }

   /**
     * Returns a normalized version of the vector (unit vector with length 1).
     * @returns A new Point with the same direction but length 1. Returns (0,0) if original length is 0.
     */	
    public normalized(): Point {
        const len = this.length();
        if (len === 0) return new Point(0 as Coordinate, 0 as Coordinate);
        return new Point(this.x / len as Coordinate, this.y / len as Coordinate);
    }

    /**
     * Returns a perpendicular vector rotated 90 degrees counter-clockwise.
     * Maps `(x, y)` to `(-y, x)`.
     * 
     * @returns A new transposed Point.
     */	
    public transposed(): Point {
        return new Point(-this.y, this.x);
    }

    /**
     * Creates a deep copy of this Point.
     * @returns A new Point instance with identical coordinates.
     */	
    public clone(): Point {
        return new Point(this.x, this.y);
    }
}

/**
 * Represents an Axis-Aligned Bounding Box (AABB) defined by two corner points.
 * 
 * The box is normalized upon construction so that `min` always contains the 
 * smallest x and y values, and `max` contains the largest.
 */
export class Box {
    public min: Point;
    public max: Point;

    public constructor(a: Point, b: Point) {
        this.min = new Point(Math.min(a.x, b.x) as Coordinate, Math.min(a.y, b.y) as Coordinate);
        this.max = new Point(Math.max(a.x, b.x) as Coordinate, Math.max(a.y, b.y) as Coordinate);
    }
}

/**
 * Represents a geometric half-plane, defined by a dividing line (edge) and a boolean 
 * indicating which side of the line is considered "inside" or positive.
 * 
 * Used primarily for polygon clipping algorithms (e.g., Sutherland-Hodgman).
 */
export class HalfPlane {
    public edge: Line;
    public isPositive: boolean;

    public constructor(edge: Line, isPositive: boolean) {
        this.edge = edge;
        this.isPositive = isPositive;
    }
}

/**
 * Interface representing a line in the general equation form: `ax + by + c = 0`.
 * 
 * This form is preferred over slope-intercept for geometric algorithms because it 
 * handles vertical lines natively without division by zero.
 */
export interface Line {
    a: number;
    b: number;
    c: number;
}

/**
 * A type alias representing a finite line segment defined by exactly two points: `[Start, End]`.
 */
export type Segment = [Point, Point];

// #region Point & Geometric Primitives (from V3.8 model/point.ts)
// Note: The Point class and related primitives are moved here as they are fundamental geometry utilities.

/**
 * Checks if two points are geometrically identical.
 * 
 * @param a - The first point.
 * @param b - The second point.
 * @returns `true` if both x and y coordinates match exactly, otherwise `false`.
 */
export function equalPoints(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

/**
 * Factory function to create a {@link Line} object from coefficients.
 * 
 * Creates a line object satisfying the equation `ax + by + c = 0`.
 * 
 * @param a - The 'a' coefficient (coefficient of x).
 * @param b - The 'b' coefficient (coefficient of y).
 * @param c - The 'c' constant term.
 * @returns A {@link Line} object.
 */
export function line(a: number, b: number, c: number): Line {
	return { a, b, c };
}

/**
 * Constructs a {@link Line} that passes through two distinct points.
 * 
 * Derives the general equation coefficients `a`, `b`, and `c` based on the coordinates
 * of the provided points.
 * 
 * @param a - The first point.
 * @param b - The second point.
 * @returns A {@link Line} object representing the infinite line through `a` and `b`.
 */
export function lineThroughPoints(a: Point, b: Point): Line {
	return line(a.y - b.y, b.x - a.x, a.x * b.y - b.x * a.y);
}

/**
 * Factory function to create a {@link Segment} tuple.
 * 
 * @param a - The start point.
 * @param b - The end point.
 * @returns A tuple `[a, b]`.
 * @throws Error if `a` and `b` are the same point (segments must be distinct).
 */
export function lineSegment(a: Point, b: Point): Segment {
	if (equalPoints(a, b)) { throw new Error('Points of a segment should be distinct'); }
	return [a, b];
}

/**
 * Constructs a {@link HalfPlane} defined by a boundary edge and a reference point.
 * 
 * The resulting half-plane includes the side of the `edge` line where `point` resides.
 * 
 * @param edge - The infinite line defining the boundary.
 * @param point - A point strictly inside the desired half-plane.
 * @returns A {@link HalfPlane} object.
 */
export function halfPlaneThroughPoint(edge: Line, point: Point): HalfPlane {
	return new HalfPlane(edge, edge.a * point.x + edge.b * point.y + edge.c > 0);
}

/**
 * Checks if a specific point lies within a defined {@link HalfPlane}.
 *
 * It evaluates the line equation `ax + by + c` at the point's coordinates and compares
 * the sign of the result against the half-plane's positive/negative orientation.
 *
 * @param point - The point to test.
 * @param halfPlane - The geometric half-plane definition.
 * @returns `true` if the point is strictly inside the half-plane, `false` otherwise.
 */
export function pointInHalfPlane(point: Point, halfPlane: HalfPlane): boolean {
	const edge = halfPlane.edge;
	return (edge.a * point.x + edge.b * point.y + edge.c > 0) === halfPlane.isPositive;
}

/**
 * Checks if two bounding boxes are geometrically identical.
 *
 * Equality requires that both the `min` and `max` points of the boxes match exactly.
 *
 * @param a - The first bounding box.
 * @param b - The second bounding box.
 * @returns `true` if the boxes occupy exactly the same space.
 */
export function equalBoxes(a: Box, b: Box): boolean {
	return equalPoints(a.min, b.min) && equalPoints(a.max, b.max);
}

// #endregion

// #region Intersection & Distance Functions (from V3.8 model/intersection.ts)

/**
 * Clips an arbitrary polygon against the rectangular viewport boundaries.
 *
 * This implementation uses the Sutherland-Hodgman algorithm to iteratively clip the polygon
 * against the four edges of the screen (0, 0, Width, Height).
 *
 * @param points - The array of vertices defining the polygon.
 * @param W - The width of the viewport in pixels.
 * @param H - The height of the viewport in pixels.
 * @returns An array of points representing the clipped polygon, or `null` if the polygon is fully outside.
 */
export function clipPolygonToViewport(points: Point[], W: number, H: number): Point[] | null {
    if (points.length < 3) return null;

    let clippedPoints: Point[] = points;
    const clipPlanes = [];

    // 1. Define the four clipping planes (HalfPlanes) based on the viewport boundaries.

    // Clip against X > 0 (Left Edge)
    // Edge: x = 0 (Line: a=1, b=0, c=0). Point (1, 1) is inside.
    clipPlanes.push(halfPlaneThroughPoint(line(1, 0, 0), new Point(1 as Coordinate, 1 as Coordinate)));

    // Clip against X < W (Right Edge)
    // Edge: x = W (Line: a=1, b=0, c=-W). Point (W-1, 1) is inside.
    clipPlanes.push(halfPlaneThroughPoint(line(1, 0, -W), new Point((W - 1) as Coordinate, 1 as Coordinate)));

    // Clip against Y > 0 (Top Edge)
    // Edge: y = 0 (Line: a=0, b=1, c=0). Point (1, 1) is inside.
    clipPlanes.push(halfPlaneThroughPoint(line(0, 1, 0), new Point(1 as Coordinate, 1 as Coordinate)));

    // Clip against Y < H (Bottom Edge)
    // Edge: y = H (Line: a=0, b=1, c=-H). Point (1, H-1) is inside.
    clipPlanes.push(halfPlaneThroughPoint(line(0, 1, -H), new Point(1 as Coordinate, (H - 1) as Coordinate)));


    // 2. Iteratively clip the polygon against each plane.
    for (const plane of clipPlanes) {
        const nextClipped = intersectPolygonAndHalfPlane(clippedPoints, plane);
        if (nextClipped === null || nextClipped.length < 3) {
            return null; // Fully clipped out
        }
        clippedPoints = nextClipped;
    }

    return clippedPoints;
}

/**
 * Internal helper to add a unique point to an array.
 * 
 * Checks if the `point` already exists in the `array` (using geometric equality).
 * If it does not exist, it pushes the point and returns `true`.
 * 
 * @param array - The target array of points.
 * @param point - The point to attempt to add.
 * @returns `true` if the point was added, `false` if it was a duplicate.
 */
function addPoint(array: Point[], point: Point): boolean {
	for (let i = 0; i < array.length; i++) {
		if (equalPoints(array[i], point)) {
			return false;
		}
	}

	array.push(point);
	return true;
}

/**
 * Calculates the intersection geometry between an infinite {@link Line} and an axis-aligned {@link Box}.
 *
 * @param line - The infinite line equation (`ax + by + c = 0`).
 * @param box - The bounding box.
 * @returns A {@link Segment} (if passing through), a single {@link Point} (if touching a corner/edge tangentially), or `null` (if no intersection).
 */
export function intersectLineAndBox(line: Line, box: Box): Segment | Point | null {
	if (line.a === 0) {
		const l = -line.c / line.b;
		return box.min.y <= l && l <= box.max.y ? lineSegment(new Point(box.min.x as Coordinate, l as Coordinate), new Point(box.max.x as Coordinate, l as Coordinate)) : null;
	}
	if (line.b === 0) {
		const h = -line.c / line.a;
		return box.min.x <= h && h <= box.max.x ? lineSegment(new Point(h as Coordinate, box.min.y as Coordinate), new Point(h as Coordinate, box.max.y as Coordinate)) : null;
	}

	const points: Point[] = [];
	const u = function(value: number): void {
		const i = -(line.c + line.a * value) / line.b;
		if (box.min.y <= i && i <= box.max.y) { addPoint(points, new Point(value as Coordinate, i as Coordinate)); }
	};
	const p = function(value: number): void {
		const s = -(line.c + line.b * value) / line.a;
		if (box.min.x <= s && s <= box.max.x) { addPoint(points, new Point(s as Coordinate, value as Coordinate)); }
	};

	u(box.min.x);
	p(box.min.y);
	u(box.max.x);
	p(box.max.y);

	switch (points.length) {
		case 0:
			return null;
		case 1:
			return points[0];
		case 2:
			return equalPoints(points[0], points[1]) ? points[0] : lineSegment(points[0], points[1]);
	}

	throw new Error('We should have at most two intersection points');
}

/**
 * Calculates the intersection point of a Ray (semi-infinite line) and a bounding box.
 *
 * A ray is defined by an origin (`point0`) and a through-point (`point1`). This function finds
 * the first point where the ray enters or touches the box.
 *
 * @param point0 - The origin of the ray.
 * @param point1 - A second point defining the ray's direction.
 * @param box - The bounding box to test against.
 * @returns The first intersection {@link Point}, or `null` if the ray misses the box.
 */
export function intersectRayAndBox(point0: Point, point1: Point, box: Box): Point | null {
	const s = intersectLineSegments(point0, point1, box.min, new Point(box.max.x, box.min.y));
	const n = intersectLineSegments(point0, point1, new Point(box.max.x, box.min.y), box.max);
	const a = intersectLineSegments(point0, point1, box.max, new Point(box.min.x, box.max.y));
	const c = intersectLineSegments(point0, point1, new Point(box.min.x, box.max.y), box.min);

	const h = [];
	if (s !== null && s >= 0) { h.push(s); }
	if (n !== null && n >= 0) { h.push(n); }
	if (a !== null && a >= 0) { h.push(a); }
	if (c !== null && c >= 0) { h.push(c); }

	if (h.length === 0) { return null; }
	h.sort((e: number, t: number) => e - t);

	const d = pointInBox(point0, box) ? h[0] : h[h.length - 1];
	return point0.addScaled(point1.subtract(point0), d);
}

/**
 * Calculates the intersection of two finite line segments.
 *
 * Segment A is defined by `point0` to `point1`.
 * Segment B is defined by `point2` to `point3`.
 *
 * @param point0 - Start of segment A.
 * @param point1 - End of segment A.
 * @param point2 - Start of segment B.
 * @param point3 - End of segment B.
 * @returns The scalar coefficient `t` (0 to 1) along segment A where the intersection occurs, or `null` if they do not intersect.
 */
export function intersectLineSegments(point0: Point, point1: Point, point2: Point, point3: Point): number | null {
	const z = (function(e: Point, t: Point, i: Point, s: Point): number | null {
		const r = t.subtract(e);
		const n = s.subtract(i);
		const o = r.x * n.y - r.y * n.x;
		if (Math.abs(o) < 1e-6) { return null; }
		const a = e.subtract(i);
		return (a.y * n.x - a.x * n.y) / o;
	})(point0, point1, point2, point3);

	if (z === null) { return null; }
	const o = point1.subtract(point0).scaled(z).add(point0);
	const a = distanceToSegment(point2, point3, o);
	return Math.abs(a.distance) < 1e-6 ? z : null;
}


/**
 * Clips a finite line segment to a bounding box using the Cohen-Sutherland algorithm.
 *
 * This determines which part of the segment `[p0, p1]` lies inside the box.
 *
 * @param segment - The input segment `[start, end]`.
 * @param box - The clipping boundary.
 * @returns A new {@link Segment} representing the visible portion, a single {@link Point} if clipped to a dot, or `null` if completely outside.
 */
export function intersectLineSegmentAndBox(segment: Segment, box: Box): Point | Segment | null {
	// Explicitly define types for x0, y0, x1, y1 as Coordinate
	let x0: Coordinate = segment[0].x;
	let y0: Coordinate = segment[0].y;
	let x1: Coordinate = segment[1].x;
	let y1: Coordinate = segment[1].y;
	const minX = box.min.x;
	const minY = box.min.y;
	const maxX = box.max.x;
	const maxY = box.max.y;

	// This helper function `outcode` will operate on numbers and return numbers
	function outcode(n1: number, n2: number): number {
		let z = 0; // 0000
		if (n1 < minX) z |= 1; // 0001
		else if (n1 > maxX) z |= 2; // 0010
		if (n2 < minY) z |= 4; // 0100
		else if (n2 > maxY) z |= 8; // 1000
		return z;
	}

	let accept = false; // Correctly track acceptance
	let outcode0 = outcode(x0, y0);
	let outcode1 = outcode(x1, y1);

	while (true) {
		if (!(outcode0 | outcode1)) {
			accept = true;
			break;
		} else if (outcode0 & outcode1) {
			break;
		} else {
			const currentOutcode = outcode0 || outcode1;
			let x: number = 0;
			let y: number = 0;

			if (currentOutcode & 8) { // Point is above the clip window
				x = x0 + (x1 - x0) * (maxY - y0) / (y1 - y0);
				y = maxY;
			} else if (currentOutcode & 4) { // Point is below the clip window
				x = x0 + (x1 - x0) * (minY - y0) / (y1 - y0);
				y = minY;
			} else if (currentOutcode & 2) { // Point is to the right of clip window
				y = y0 + (y1 - y0) * (maxX - x0) / (x1 - x0);
				x = maxX;
			} else if (currentOutcode & 1) { // Point is to the left of clip window
				y = y0 + (y1 - y0) * (minX - x0) / (x1 - x0);
				x = minX;
			}

			// Assigning back to Coordinate-typed variables requires an explicit cast
			if (currentOutcode === outcode0) {
				x0 = x as Coordinate;
				y0 = y as Coordinate;
				outcode0 = outcode(x0, y0);
			} else {
				x1 = x as Coordinate;
				y1 = y as Coordinate;
				outcode1 = outcode(x1, y1);
			}
		}
	}

	return accept ? (equalPoints(new Point(x0, y0), new Point(x1, y1)) ? new Point(x0, y0) : lineSegment(new Point(x0, y0), new Point(x1, y1))) : null;
}

/**
 * Calculates the shortest (perpendicular) distance from a point to an infinite line.
 *
 * The line is defined by two points, `point1` and `point2`. The target is `point0`.
 *
 * @param point0 - The target point to measure from.
 * @param point1 - First point on the line.
 * @param point2 - Second point on the line.
 * @returns An object containing the `distance` (pixels) and a `coeff` representing the projection of `point0` onto the line vector.
 */
export function distanceToLine(point0: Point, point1: Point, point2: Point): { distance: number; coeff: number } {
	const s = point1.subtract(point0);
	const r = point2.subtract(point0).dotProduct(s) / s.dotProduct(s);
	return { coeff: r, distance: point0.addScaled(s, r).subtract(point2).length() };
}

/**
 * Calculates the shortest distance from a point to a finite line segment.
 *
 * Unlike {@link distanceToLine}, this clamps the result to the segment endpoints.
 * If the perpendicular projection falls outside the segment, the distance to the closest endpoint is returned.
 *
 * @param point0 - The target point.
 * @param point1 - Start of the segment.
 * @param point2 - End of the segment.
 * @returns An object containing the `distance` and a `coeff` (0 to 1) indicating the position of the closest point on the segment.
 */
export function distanceToSegment(point0: Point, point1: Point, point2: Point): { distance: number; coeff: number } {
	const lineDist = distanceToLine(point0, point1, point2);
	if (lineDist.coeff >= 0 && lineDist.coeff <= 1) { return lineDist; }

	const n = point0.subtract(point2).length();
	const o = point1.subtract(point2).length();

	return n < o ? { coeff: 0, distance: n } : { coeff: 1, distance: o };
}

/**
 * Checks if a point lies strictly inside or on the edge of a bounding box.
 *
 * @param point - The point to test.
 * @param box - The axis-aligned bounding box.
 * @returns `true` if `min.x <= x <= max.x` and `min.y <= y <= max.y`.
 */
export function pointInBox(point: Point, box: Box): boolean {
	return point.x >= box.min.x && point.x <= box.max.x && point.y >= box.min.y && point.y <= box.max.y;
}

/**
 * Checks if a point lies inside a specific polygon.
 * 
 * This implements the **Ray Casting algorithm** (also known as the Even-Odd rule).
 * It shoots a horizontal ray from the test point and counts how many times it intersects
 * the polygon's edges. An odd number of intersections means the point is inside.
 *
 * @param point - The point to test.
 * @param polygon - An array of points defining the polygon vertices.
 * @returns `true` if the point is strictly inside the polygon.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
	const x = point.x;
	const y = point.y;
	let isInside = false;

	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i].x, yi = polygon[i].y;
		const xj = polygon[j].x, yj = polygon[j].y;

		const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
		if (intersect) isInside = !isInside;
	}

	return isInside;
}

/**
 * Checks if a point lies inside a triangle defined by three vertices.
 * 
 * It uses a barycentric coordinate approach or edge-check logic. Specifically, this implementation
 * checks if the point lies on the same side of all three edges relative to the centroid (or checks intersection against medians).
 *
 * @param point - The point to test.
 * @param end0 - The first vertex.
 * @param end1 - The second vertex.
 * @param end2 - The third vertex.
 * @returns `true` if the point is inside the triangle.
 */
export function pointInTriangle(point: Point, end0: Point, end1: Point, end2: Point): boolean {
	const middle = end0.add(end1).scaled(0.5).add(end2).scaled(0.5);
	return intersectLineSegments(end0, end1, middle, point) === null
		&& intersectLineSegments(end1, end2, middle, point) === null
		&& intersectLineSegments(end2, end0, middle, point) === null;
}

/**
 * Calculates the exact intersection point of two infinite lines.
 * 
 * Uses the general line equation (`Ax + By + C = 0`) determinant method.
 * 
 * @param line0 - The first infinite line.
 * @param line1 - The second infinite line.
 * @returns The intersection {@link Point}, or `null` if the lines are parallel (determinant is near zero).
 */
export function intersectLines(line0: Line, line1: Line): Point | null {
	const c = line0.a * line1.b - line1.a * line0.b;
	if (Math.abs(c) < 1e-6) { return null; }

	const x = (line0.b * line1.c - line1.b * line0.c) / c;
	const y = (line1.a * line0.c - line0.a * line1.c) / c;
	return new Point(x as Coordinate, y as Coordinate);
}

/**
 * Clips a polygon against a single half-plane using the Sutherland-Hodgman algorithm logic.
 * 
 * This is a fundamental step in polygon clipping. It iterates through the polygon edges
 * and outputs a new set of vertices that lie on the "positive" side of the half-plane.
 *
 * @param points - The vertices of the subject polygon.
 * @param halfPlane - The clipping plane.
 * @returns A new array of vertices representing the clipped polygon, or `null` if the result is invalid (fewer than 3 points).
 */
export function intersectPolygonAndHalfPlane(points: Point[], halfPlane: HalfPlane): Point[] | null {
	const intersectionPoints: Point[] = [];
	for (let i = 0; i < points.length; ++i) {
		const current = points[i];
		const next = points[(i + 1) % points.length];
		
		// --- Check for null return from lineThroughPoints ---
		const segmentLine = lineThroughPoints(current, next); 

        // If the segment is degenerate (current === next), skip this iteration as no line exists
        if (segmentLine === null) {
            continue; 
        }

		// Use a temporary variable 'line' for clarity, which now holds a non-null Line object
        const line: Line = segmentLine;


		if (pointInHalfPlane(current, halfPlane)) {
			addPointToPointsSet(intersectionPoints, current);
			if (!pointInHalfPlane(next, halfPlane)) {
				const lineIntersection = intersectLines(line, halfPlane.edge);
				if (lineIntersection !== null) {
					addPointToPointsSet(intersectionPoints, lineIntersection);
				}
			}
		} else if (pointInHalfPlane(next, halfPlane)) {
			const lineIntersection = intersectLines(line, halfPlane.edge);
			if (lineIntersection !== null) {
				addPointToPointsSet(intersectionPoints, lineIntersection);
			}
		}
	}
	return intersectionPoints.length >= 3 ? intersectionPoints : null;
}

/**
 * Internal helper for polygon operations to add a point to a path.
 * 
 * Similar to `addPoint`, but specialized for polygon paths. It prevents adding a point
 * if it is identical to the *last added point* or the *first point* (to avoid degenerate segments or premature closing).
 *
 * @param points - The current list of polygon vertices.
 * @param point - The next vertex to add.
 * @returns `true` if the point was added, `false` if it was skipped.
 */
function addPointToPointsSet(points: Point[], point: Point): boolean {
	if (points.length > 0 && equalPoints(points[points.length - 1], point)) {
		return false;
	}
	if (points.length > 1 && equalPoints(points[0], point)) { // Check first point only if there are enough points
		return false;
	}
	points.push(point);
	return true;
}

/**
 * Checks if a point lies inside or on the boundary of a circle.
 * 
 * @param point - The point to test.
 * @param center - The center point of the circle.
 * @param radius - The radius of the circle in pixels.
 * @returns `true` if the distance from the point to the center is less than or equal to the radius.
 */
export function pointInCircle(point: Point, center: Point, radius: number): boolean {
	return (point.x - center.x) * (point.x - center.x) + (point.y - center.y) * (point.y - center.y) <= radius * radius;
}

// #endregion

// #region Line Clipping & Extension (from V3.8 renderers/draw-line.ts)

/**
 * Extends a line segment infinitely in one or both directions and then clips it to a bounding box.
 * 
 * This is the core logic for drawing Rays, Extended Lines, and Horizontal/Vertical lines
 * that must span across the visible chart area.
 *
 * @param point0 - The first control point.
 * @param point1 - The second control point (defines direction).
 * @param width - The width of the clipping area (0 to width).
 * @param height - The height of the clipping area (0 to height).
 * @param extendLeft - If `true`, the line extends infinitely past `point0`.
 * @param extendRight - If `true`, the line extends infinitely past `point1`.
 * @returns A {@link Segment} clipped to the box, a single {@link Point} if clipped to the edge, or `null` if the line misses the box entirely.
 */
export function extendAndClipLineSegment(point0: Point, point1: Point, width: number, height: number, extendLeft: boolean, extendRight: boolean): Segment | Point | null {
	if (equalPoints(point0, point1)) {
		return null; // Degenerate segment
	}

	const topLeft = new Point(0 as Coordinate, 0 as Coordinate);
	const bottomRight = new Point(width as Coordinate, height as Coordinate);
	const clippingBox = new Box(topLeft, bottomRight);

	if (extendLeft) {
		if (extendRight) {
			// Extend infinitely in both directions and clip to box
			const lineThrough = lineThroughPoints(point0, point1);

			// --- Check for null return from lineThroughPoints ---
            if (lineThrough === null) {
                return null; // Fully degenerate line
            }

			const intersection = intersectLineAndBox(lineThrough, clippingBox);
			return intersection;
		} else {
			// Extend as a ray from point1 through point0 and clip to box
			const intersection = intersectRayAndBox(point1, point0, clippingBox);
			return intersection === null || equalPoints(point1, intersection) ? null : lineSegment(point1, intersection);
		}
	}

	if (extendRight) {
		// Extend as a ray from point0 through point1 and clip to box
		const intersection = intersectRayAndBox(point0, point1, clippingBox);
		return intersection === null || equalPoints(point0, intersection) ? null : lineSegment(point0, intersection);
	} else {
		// Just clip the segment itself to the box
		const intersection = intersectLineSegmentAndBox(lineSegment(point0, point1), clippingBox);
		return intersection;
	}
}

// #endregion

// #region Time/Logical Index Interpolation Utilities

/**
 * **Time Format Utility: String to Timestamp**
 * 
 * Converts a standard ISO Date string (e.g., "2023-01-01") into a UNIX Timestamp (seconds).
 * 
 * ### Context
 * Lightweight Charts supports data formats where time is a string (e.g., '2018-12-22'). 
 * However, the plugin's internal geometry and interpolation math ({@link interpolateTimeFromLogicalIndex}) 
 * strictly requires numeric values to calculate deltas and intervals.
 * 
 * This helper ensures that string-based series data can be consumed by the math engine.
 * 
 * @param dateString - The date string to convert.
 * @returns The timestamp in seconds (UTCTimestamp).
 */
export function convertDateStringToUTCTimestamp(dateString: string): UTCTimestamp {
	const date = new Date(dateString);
	return Math.floor(date.getTime() / 1000) as UTCTimestamp;
}

/**
 * **Time Format Utility: Timestamp to String**
 * 
 * Converts a numeric UNIX Timestamp back into a standard ISO Date string ("YYYY-MM-DD").
 * 
 * ### Context
 * This is the inverse of {@link convertDateStringToUTCTimestamp}. It is used when the plugin 
 * needs to return a time value that matches the format of the source series data. 
 * 
 * For example, if the chart is configured with string dates, {@link interpolateTimeFromLogicalIndex} 
 * uses this to format its numeric result back into a string so the resulting point matches 
 * the series' native data format.
 * 
 * @param timestamp - The timestamp in seconds.
 * @returns The formatted date string.
 */
export function convertUTCTimestampToDateString(timestamp: UTCTimestamp): string {
	const date = new Date(timestamp * 1000);
	return date.toISOString().split('T')[0];
}

/**
 * **Critical Core Utility: Time Extrapolation**
 * 
 * Interpolates (or extrapolates) a precise Time value for a specific Logical Index, primarily to handle 
 * coordinates in the chart's "blank space" (the future area where no data bars exist yet).
 * 
 * ### The Problem it Solves
 * Native Lightweight Charts APIs (like `coordinateToTime`) often return `null` or snap to the nearest existing bar 
 * when querying coordinates in the empty space to the right of the series. However, drawing tools (like Ray Lines 
 * or Fibonacci Retracements) often need to project strictly into this future space.
 * 
 * ### How it Works
 * 1. It samples the first two data points of the series to calculate the exact time interval (e.g., 1 day, 1 minute) between bars.
 * 2. It applies a linear extrapolation formula: `TargetTime = StartTime + (TargetLogicalIndex * TimeInterval)`.
 * 
 * ### Interplay & Importance
 * * **Interaction:** This is the engine behind `InteractionManager`. When you move your mouse into the empty space, 
 *   this function converts that screen position into a valid Timestamp, allowing the tool's "Ghost Point" to be drawn smoothly.
 * * **Inverse Operation:** Its counterpart is {@link interpolateLogicalIndexFromTime}, which maps these timestamps back to screen coordinates.
 * 
 * @typeParam HorzScaleItem - The type of the horizontal scale item (e.g., `UTCTimestamp`).
 * @param chart - The chart API instance.
 * @param series - The series API instance (required to sample data density/interval).
 * @param logicalIndex - The logical index (float) to convert into a time.
 * @returns The extrapolated `Time`, or `null` if the series has insufficient data ( < 2 bars) to determine an interval.
 */
export function interpolateTimeFromLogicalIndex<HorzScaleItem>(
	chart: IChartApiBase<HorzScaleItem>, // NEW: Now accepts chart instance
	series: ISeriesApi<SeriesType, HorzScaleItem>, // Keep series for data access
	logicalIndex: number
): Time | null {
	if (!chart || !series) { // Also check if chart is defined
		console.warn("[interpolateTimeFromLogicalIndex] chart or series is not defined.");
		return null;
	}

	const timeScale = chart.timeScale(); // Access timeScale directly from chart

	// Retrieve data for the first two points in the series to calculate the time interval.
	// This assumes that there are at least two data points to establish a reliable interval.
	// If the chart starts empty, this will need a fallback (e.g., using default bar spacing).
	const dataAtIndex0 = series.dataByIndex(0, 0);
	const dataAtIndex1 = series.dataByIndex(1, 0);

	if (!dataAtIndex0 || !dataAtIndex1) {
		// Fallback for very few data points: try to use visible logical range or timeScale options
		const visibleLogicalRange = timeScale.getVisibleLogicalRange();

		if (visibleLogicalRange && visibleLogicalRange.to - visibleLogicalRange.from > 0) {
			const logicalSpan = visibleLogicalRange.to - visibleLogicalRange.from;
			// Use coordinateToTime on the chart's time scale directly
			const timeFrom = timeScale.coordinateToTime(timeScale.logicalToCoordinate(visibleLogicalRange.from) as Coordinate) as number;
			const timeTo = timeScale.coordinateToTime(timeScale.logicalToCoordinate(visibleLogicalRange.to) as Coordinate) as number;


			if (timeFrom !== null && timeTo !== null && logicalSpan > 0) {
				const timeSpan = timeTo - timeFrom;
				const timePerLogicalUnit = timeSpan / logicalSpan;
				const logicalOffset = logicalIndex - visibleLogicalRange.from;
				return (timeFrom + logicalOffset * timePerLogicalUnit) as UTCTimestamp;
			}
		}

		console.warn("[interpolateTimeFromLogicalIndex] Not enough data points or visible range for interpolation. Cannot determine time.");
		// If we can't get a reliable interval, return null.
		return null;
	}

	const startTime = typeof dataAtIndex0.time === 'string'
		? convertDateStringToUTCTimestamp(dataAtIndex0.time)
		: dataAtIndex0.time;
	const endTime = typeof dataAtIndex1.time === 'string'
		? convertDateStringToUTCTimestamp(dataAtIndex1.time)
		: dataAtIndex1.time;

	// Calculate the time interval between the two data points (e.g., 86400 for daily bars).
	const interval = (Number(endTime) - Number(startTime));

	// Calculate the difference in logical units from the first data point.
	// We assume that `logicalIndex` relates linearly to `time`.
	const logicalDelta = logicalIndex - 0; // Assuming the first data point (index 0) corresponds to logical 0.

	// Interpolate the time for the given logical index.
	const interpolatedTime = Number(startTime) + logicalDelta * interval;

	// Return the interpolated time in the correct format (UTCTimestamp or string).
	if (typeof dataAtIndex0.time === 'string') {
		return convertUTCTimestampToDateString(interpolatedTime as UTCTimestamp) as string;
	} else {
		return interpolatedTime as UTCTimestamp;
	}
}

/**
 * **Critical Core Utility: Viewport & Culling Bounds**
 * 
 * Calculates the *absolute* visible price range of the chart pane, mapping the physical top and bottom pixel 
 * edges directly to price values.
 * 
 * ### The Problem it Solves
 * The standard `priceScale.getVisiblePriceRange()` method often accounts for margins or auto-scaling logic, 
 * which might imply the visible area is smaller than the actual canvas. For **Culling** (determining if a tool is off-screen) 
 * and **Infinite Geometries** (drawing Vertical Lines or Rays), we need to know the exact price at pixel `0` (top) 
 * and pixel `height` (bottom).
 * 
 * ### Interplay & Importance
 * * **Culling:** This function provides the `minPrice` and `maxPrice` for the {@link ToolBoundingBox} used in `src/utils/culling-helpers.ts`. 
 *   Without this, tools might disappear prematurely when scrolling.
 * * **Rendering:** It ensures that infinite lines are drawn strictly to the edge of the canvas, preventing visual artifacts or gaps.
 * 
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 * @param tool - The tool instance (provides access to the Chart, Series, and Pane dimensions).
 * @returns An object containing `from` (bottom price) and `to` (top price), or `null` if the chart isn't ready.
 */
export function getExtendedVisiblePriceRange<HorzScaleItem>(tool: BaseLineTool<HorzScaleItem>): { from: BarPrice | null; to: BarPrice | null; } | null {
    
    const chart = tool.getChart();
    const series = tool.getSeries();

    // 1. Get total widget height from the root element
    const totalHeight = chart.chartElement().clientHeight;

    // 2. Get the time scale height (this is the height of the whole time axis widget)
    // NOTE: We rely on the internal height property for the Time Scale widget.
    const timeScaleHeight = chart.timeScale().height() || 0; 

    // 3. Calculate the Pane Drawing Height: Total Height - Time Axis Height
    // This value is what the coordinate system is based on (0 to PaneHeight).
    const paneHeight = totalHeight - timeScaleHeight;

    // 4. Calculate price range using the calculated pane height
    return {
        from: series.coordinateToPrice(paneHeight as Coordinate), // Price at bottom
        to: series.coordinateToPrice(0 as Coordinate),           // Price at top
    };
}


/**
 * **Critical Core Utility: Logical Index Recovery**
 * 
 * Calculates the Logical Index for a specific Timestamp using linear extrapolation. This is the mathematical 
 * inverse of {@link interpolateTimeFromLogicalIndex}.
 * 
 * ### The Problem it Solves
 * When a drawing tool is saved and later reloaded, its definition contains raw Timestamps (e.g., "2025-01-01"). 
 * If that date is in the future (the "blank space"), the chart has no internal record of it. 
 * The standard `timeScale.timeToCoordinate()` may fail or return `null` for these future dates.
 * 
 * ### How it Works
 * It calculates the series' time interval (delta between bars) and determines how many "steps" (logical indices) 
 * the target timestamp is away from a known anchor point (the first bar).
 * 
 * ### Interplay & Importance
 * * **Rendering:** This is the backbone of `BaseLineTool.pointToScreenPoint()`. It allows the renderers to figure out 
 *   exactly where on the X-axis (in pixels) a saved future timestamp should be drawn.
 * * **Accuracy:** By using the calculated interval, it ensures that tools drawn in the future align perfectly 
 *   with the grid, preserving the visual continuity of the time scale.
 * 
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 * @param chart - The chart API instance.
 * @param series - The series API instance (used to determine the time interval between bars).
 * @param timestamp - The target timestamp to convert.
 * @returns The calculated `Logical` index, or `null` if the series has insufficient data.
 */
export function interpolateLogicalIndexFromTime<HorzScaleItem>(
	chart: IChartApiBase<HorzScaleItem>, // Chart is passed but mainly for context/consistency, not used here directly after removing timeToLogical
	series: ISeriesApi<SeriesType, HorzScaleItem>,
	timestamp: Time
): Logical | null {
	if (!series) {
		console.warn("[interpolateLogicalIndexFromTime] series is not defined.");
		return null;
	}

	// Retrieve data for the first two points in the series to calculate the time interval.
	// This approach avoids reliance on `timeScale.timeToLogical`.
	const dataAtIndex0 = series.dataByIndex(0, 0);
	const dataAtIndex1 = series.dataByIndex(1, 0);

	if (!dataAtIndex0 || !dataAtIndex1) {
		console.warn("[interpolateLogicalIndexFromTime] Not enough data points to reliably interpolate logical index.");
		return null; // Cannot interpolate without at least two data points
	}

	const time0 = typeof dataAtIndex0.time === 'string'
		? convertDateStringToUTCTimestamp(dataAtIndex0.time)
		: dataAtIndex0.time;
	const time1 = typeof dataAtIndex1.time === 'string'
		? convertDateStringToUTCTimestamp(dataAtIndex1.time)
		: dataAtIndex1.time;

	const interval = (Number(time1) - Number(time0));
	if (interval === 0) {
		console.warn("[interpolateLogicalIndexFromTime] Series data points have zero time interval, cannot interpolate logical index.");
		return null; // Avoid division by zero
	}

	// Convert the given timestamp to a number (UTCTimestamp) for calculations
	const givenTimeNum = typeof timestamp === 'string'
		? convertDateStringToUTCTimestamp(timestamp)
		: Number(timestamp);

	// Calculate the difference in time from the given timestamp to the starting point
	const timeDiff = givenTimeNum - Number(time0);

	// Calculate the logical index based on the time difference and interval
	// Assuming logical index 0 corresponds to dataAtIndex0
	const logicalIndex = timeDiff / interval;

	return logicalIndex as Logical;
}


// NOTE: The `interpolateLogicalIndexFromTime` function might also be useful for complex scenarios
// but is not strictly required for the immediate goal of "drawing in blank space" for creation.
// It could be added later if you need to convert an arbitrary timestamp (e.g., from a saved tool in blank space)
// back into a logical index for rendering purposes.

// #endregion Time/Logical Index Interpolation Utilities


// #region Text-related Geometry Helpers (from V3.8)

/**
 * Rotates a point around a specific pivot by a given angle.
 * 
 * This is essential for rendering rotated text boxes and shapes.
 * 
 * @param point - The point to rotate.
 * @param pivot - The center point of rotation.
 * @param angle - The rotation angle in radians (positive values rotate clockwise in canvas coordinates).
 * @returns A new {@link Point} representing the rotated position.
 */
export function rotatePoint(point: Point, pivot: Point, angle: number): Point {
	if (angle === 0) { return point.clone(); } // No rotation needed
	const x = (point.x - pivot.x) * Math.cos(angle) - (point.y - pivot.y) * Math.sin(angle) + pivot.x;
	const y = (point.x - pivot.x) * Math.sin(angle) + (point.y - pivot.y) * Math.cos(angle) + pivot.y;
	return new Point(x, y);
}

// #endregion Text-related Geometry Helpers