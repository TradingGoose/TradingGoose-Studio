// lightweight-charts-line-tools-freehand/src/views/LineToolBrushPaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
	Coordinate
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPaneView,
	CompositeRenderer,
	PolygonRenderer,
	PolygonRendererData,
	AnchorPoint,
	Point,
	LineToolOptionsInternal,
	DeepPartial,
	PaneCursorType,
	deepCopy,
	LineOptions,
	BackgroundOptions,
	merge,
	getToolBoundingBox,
	getToolCullingState,
	LineToolPoint,
	OffScreenState,
} from '../../core';

import { LineToolBrush } from '../model/LineToolBrush';



/**
 * Pane View for the Brush tool.
 *
 * **Tutorial Note on View Logic:**
 * The Brush View is responsible for two critical transformations:
 * 1. **Data Conversion:** Converting the unbounded stream of logical points into screen coordinates.
 * 2. **Path Smoothing:** Applying a post-processing algorithm (`_smoothArray`) to the raw screen points
 *    to create a fluid, natural-looking curve instead of a jagged polyline.
 * 3. **Rendering:** Using the `PolygonRenderer` to draw the final smoothed path.
 */
export class LineToolBrushPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	/**
	 * Internal renderer responsible for drawing the continuous freehand line.
	 * @protected
	 */
	protected _polygonRenderer: PolygonRenderer<HorzScaleItem> = new PolygonRenderer();
	
	/**
	 * Initializes the Brush View.
	 *
	 * @param source - The specific Brush model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolBrush<HorzScaleItem>,
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<any>, chart, series);
	}

	/**
	 * Smooths the raw path points using an iterative moving average algorithm.
	 *
	 * **Algorithm Details:**
	 * It uses a simple box blur kernel (window size 3: [prev, current, next]).
	 * The smoothing is applied iteratively (default 2 passes) to progressively reduce high-frequency
	 * jitter from the mouse input without significantly distorting the original shape.
	 *
	 * @param points - The raw screen points captured from mouse movements.
	 * @param iterations - The number of smoothing passes to apply (default: 2).
	 * @returns A new array of smoothed {@link AnchorPoint}s.
	 * @protected
	 */
	protected _smoothArray(points: AnchorPoint[], iterations: number = 2): AnchorPoint[] {
		if (points.length <= 2 || iterations === 0) {
			return points;
		}

		// Use a simple, iterative moving average (box blur kernel)
		let smoothedPoints = points.map(p => p.clone());
		const windowSize = 3; // Window of [previous, current, next]

		for (let i = 0; i < iterations; i++) {
			const currentIterationPoints = smoothedPoints.map(p => p.clone());

			for (let j = 1; j < smoothedPoints.length - 1; j++) {
				const prev = smoothedPoints[j - 1];
				const current = smoothedPoints[j];
				const next = smoothedPoints[j + 1];

				// Calculate new position as the average of the window
				const avgX = (prev.x + current.x + next.x) / windowSize;
				const avgY = (prev.y + current.y + next.y) / windowSize;

				currentIterationPoints[j].x = avgX as Coordinate;
				currentIterationPoints[j].y = avgY as Coordinate;
			}
			smoothedPoints = currentIterationPoints;
		}

		return smoothedPoints;
	}

	/**
	 * The core update logic.
	 *
	 * It orchestrates the pipeline: Culling -> Coordinate Conversion -> Smoothing -> Rendering.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'Brush'>;
		const permanentPoints = this._tool.getPermanentPointsForTranslation();
		
		// 1. Convert logical points to raw screen coordinates
		const hasScreenPoints = this._updatePoints(); // Populates this._points (raw screen points)

		if (!options.visible || !hasScreenPoints || this._points.length === 0) {
			return;
		}

		// --- CULLING IMPLEMENTATION START (For Unbounded Brush Tool) ---
		// We only cull the final, completed tool. We must show the tool during creation/editing.
		if (!this._tool.isCreating() && !this._tool.isEditing() && permanentPoints.length > 1) {
			
			// Get the AABB (Axis-Aligned Bounding Box) of ALL points in Logical Space
			const toolAABB = getToolBoundingBox(permanentPoints);

			if (toolAABB) {
				// Synthesize the two AABB corners in Logical Space
				const boundingPointsLogical: LineToolPoint[] = [
					// Point 1: Top-Left Corner (Min Time, Max Price)
					{ timestamp: toolAABB.minTime, price: toolAABB.maxPrice },
					// Point 2: Bottom-Right Corner (Max Time, Min Price)
					{ timestamp: toolAABB.maxTime, price: toolAABB.minPrice }
				];

				// Culling Check: Get culling state and skip rendering if not visible

				/**
				 * CULLING & VISIBILITY CHECK
				 *
				 * For an unbounded tool like the Brush, we cannot check a simple fixed box.
				 * 1. We calculate the AABB (Axis-Aligned Bounding Box) of *all* points in logical space.
				 * 2. We synthesize a logical box from these min/max values.
				 * 3. We check if this box intersects the viewport.
				 *
				 * Note: We only cull when the tool is *finished*. During creation/editing, we always render
				 * to ensure immediate feedback to the user.
				 */
				const cullingState = getToolCullingState(boundingPointsLogical, this._tool);

				if (cullingState !== OffScreenState.Visible) {
					// Clear the renderer and exit the update function
					this._renderer.clear();
					return;
				}
			}
		}
		// --- CULLING IMPLEMENTATION END ---

		// 2. Apply Smoothing (The V3.8 Step 2)

		/**
		 * PATH SMOOTHING
		 *
		 * We apply the smoothing algorithm to the raw screen points.
		 * This transforms the jagged raw input into the fluid stroke characteristic of a brush.
		 */
		const smoothedPoints = this._smoothArray(this._points, 2); 

		// 3. Configure Renderers (The V3.8 Step 3)
		
		// --- CRITICAL FIX: Ensure all required properties are non-optional (string/number) before passing to setData ---
		
		// The options object is already complete and type-safe thanks to the Model's constructor merge.
		const finalLineOptions = options.line as LineOptions;
		
		// The background property of PolygonRendererData is an object { color: string } | undefined.
		// We can safely create this object only if options.background exists and has a color.
		let finalBackgroundData: { color: string } | undefined = undefined;
		if (options.background && options.background.color) {
			finalBackgroundData = { color: options.background.color };
		}

		/**
		 * POLYGON RENDERER DATA SETUP
		 *
		 * We configure the `PolygonRenderer` with the **smoothed** points.
		 * - `line`: The visual styling (color, width, caps).
		 * - `hitTestBackground`: Set to `false` because we only want to hit-test the stroke itself,
		 *   not the area "inside" the open path.
		 */
		const polygonRendererData: PolygonRendererData = {
			points: smoothedPoints,
			line: finalLineOptions, // Guaranteed to be a complete LineOptions object
			background: finalBackgroundData, // Properly handled as optional
			hitTestBackground: false, // Allow dragging the stroke for movement
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		};
		
		this._polygonRenderer.setData(polygonRendererData);

		(this._renderer as CompositeRenderer<HorzScaleItem>).append(this._polygonRenderer);

		// 4. Add Anchors
		//if (this.areAnchorsVisible()) {
			this._addAnchors(this._renderer as CompositeRenderer<HorzScaleItem>);
		//}
	}

	/**
	 * Adds the interactive anchor point.
	 *
	 * **Tutorial Note on Anchors:**
	 * A freehand drawing has hundreds of points. Showing handles for all of them would be unusable.
	 * Instead, we calculate the **geometric center** of the drawing and place a single
	 * "Move Handle" there. This allows the user to grab and translate the entire drawing easily.
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length === 0) return;

		// Find the center of the bounding box of the drawn points
		const avgX = this._points.reduce((sum, p) => sum + p.x, 0) / this._points.length;
		const avgY = this._points.reduce((sum, p) => sum + p.y, 0) / this._points.length;

		// Create a single anchor point at the center (arbitrarily assign pointIndex 0)
		const centerAnchor = new AnchorPoint(avgX, avgY, 0, true); 

		const anchorData = {
			points: [centerAnchor],
			pointsCursorType: [PaneCursorType.Grabbing],
		};

		// Add the anchor renderer. It only uses the logic from the base LineToolPaneView's createLineAnchor
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}