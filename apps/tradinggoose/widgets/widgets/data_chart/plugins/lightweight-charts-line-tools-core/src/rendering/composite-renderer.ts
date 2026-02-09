// /src/rendering/composite-renderer.ts

/**
 * CompositeRenderer combines multiple IPaneRenderer instances
 * into a single renderer. It does not draw itself but orchestrates
 * the drawing of its contained renderers.
 */

import {
    IPaneRenderer,
    CanvasRenderingTarget2D,
    LineToolHitTestData,
	HitTestResult
} from '../types';

import { Coordinate } from 'lightweight-charts';


/**
 * A composite renderer that combines multiple {@link IPaneRenderer} instances into a single object.
 *
 * It is responsible for orchestrating the drawing of its contained renderers in sequence
 * and performing hit tests on all of them in reverse order (top-most first) to simulate Z-order.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class CompositeRenderer<HorzScaleItem> implements IPaneRenderer {
	private _renderers: IPaneRenderer[] = [];

	/**
	 * Appends a renderer to the composite.
	 *
	 * Renderers are drawn in the order they are appended, from first to last.
	 *
	 * @param renderer - The {@link IPaneRenderer} to add.
	 * @returns void
	 */
	public append(renderer: IPaneRenderer): void {
		this._renderers.push(renderer);
	}

	/**
	 * Clears all contained renderers from the composite.
	 *
	 * This is typically used by views when updating, to rebuild the set of renderers
	 * needed for the current tool state.
	 *
	 * @returns void
	 */
	public clear(): void {
		this._renderers.length = 0;
	}

	/**
	 * Checks if the composite contains any renderers.
	 * @returns `true` if no renderers are present, `false` otherwise.
	 */
	public isEmpty(): boolean {
		return this._renderers.length === 0;
	}

	/**
	 * Draws all contained renderers in sequence using the provided rendering target.
	 *
	 * @param target - The {@link CanvasRenderingTarget2D} provided by Lightweight Charts.
	 * @returns void
	 */
	public draw(target: CanvasRenderingTarget2D): void {
		if (this.isEmpty()) {
			return;
		}
		this._renderers.forEach((renderer: IPaneRenderer) => {
			renderer.draw(target);
		});
	}

	/**
	 * Performs a hit test by querying all contained renderers in reverse order (topmost first).
	 *
	 * This simulates the Z-order stack. If multiple renderers are hit, the result from the
	 * one closest to the top of the stack will be returned.
	 *
	 * @param x - The X coordinate for the hit test.
	 * @param y - The Y coordinate for the hit test.
	 * @returns The {@link HitTestResult} of the topmost hit renderer, or `null` if nothing is hit.
	 */
	public hitTest(x: Coordinate, y: Coordinate): HitTestResult<LineToolHitTestData> | null {
		//console.log(`[CompositeRenderer] hitTest called at X:${x}, Y:${y}`);

		// Iterate in reverse order to simulate Z-order hit testing (topmost element first)
		for (let i = this._renderers.length - 1; i >= 0; i--) {
			const renderer = this._renderers[i];
			//console.log(`[CompositeRenderer]   Testing renderer: ${renderer.constructor.name}`);

			if (renderer.hitTest) { // Check if the renderer implements hitTest
				const hitResult = renderer.hitTest(x, y);
				if (hitResult !== null) {
					//console.log(`[CompositeRenderer] --- HIT FOUND by ${renderer.constructor.name}! Cursor: ${hitResult.data()?.suggestedCursor || 'undefined'}`);

					// We found a hit, return it immediately
					return hitResult;
				}
			}
		}
		//console.log(`[CompositeRenderer] No renderer hit. Returning null.`);

		return null; // No hit found
	}
}