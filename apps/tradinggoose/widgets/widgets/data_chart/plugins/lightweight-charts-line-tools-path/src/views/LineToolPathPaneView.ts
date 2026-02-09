// /src/views/LineToolPathPaneView.ts

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
	LineToolOptionsInternal,
	deepCopy,
	LineOptions,
	BackgroundOptions,
	OffScreenState,
	getToolCullingState,
	LineToolPoint,
	BoxHorizontalAlignment,
	PaneCursorType,
	getToolBoundingBox,
} from '../../../lightweight-charts-line-tools-core/src';

import { LineToolPath } from '../model/LineToolPath';


/**
 * Pane View for the Path (Polyline) tool.
 *
 * **Tutorial Note on Logic:**
 * This view uses the generic `PolygonRenderer` to draw an open series of connected line segments.
 * Unlike the Triangle (which is closed and filled), the Path is typically an open "strip".
 *
 * Responsibilities:
 * 1. **Culling:** Using an Axis-Aligned Bounding Box (AABB) strategy to check if any part of the path is visible.
 * 2. **Anchors:** Generating a resize handle for *every* vertex in the path.
 */
export class LineToolPathPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	/**
	 * Internal renderer responsible for drawing the polyline segments.
	 * @protected
	 */
	protected _polygonRenderer: PolygonRenderer<HorzScaleItem> = new PolygonRenderer();

	/**
	 * Initializes the Path View.
	 *
	 * @param source - The specific Path model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolPath<HorzScaleItem>, // Accepts the specific Path Model type
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<any>, chart, series);
	}

	/**
	 * The core update logic.
	 *
	 * It prepares the screen coordinates for all points in the path and configures the
	 * `PolygonRenderer` to draw them as a continuous line.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'Path'>;
		const permanentPoints = this._tool.getPermanentPointsForTranslation();
 
		if (!options.visible) {
			return;
		}

		if (this._tool.points().length < 1) {
			return;
		}

		// 1. Convert logical points to raw screen coordinates
		const hasScreenPoints = this._updatePoints(); // Populates this._points (raw screen points)

		if (!hasScreenPoints || this._points.length === 0) {
			return;
		}

		// --- CULLING IMPLEMENTATION START (Using a conservative AABB check) ---
		// Note: Since this is an unbounded series of segments, we'll perform a simple AABB check 
		// on all permanent points. A more precise check would involve iterating over every segment.
		if (!this._tool.isCreating() && !this._tool.isEditing() && permanentPoints.length > 1) {
			const toolAABB = getToolBoundingBox(permanentPoints);

			if (toolAABB) {
				const boundingPointsLogical: LineToolPoint[] = [
					// Point 1: Top-Left Corner (Min Time, Max Price)
					{ timestamp: toolAABB.minTime, price: toolAABB.maxPrice },
					// Point 2: Bottom-Right Corner (Max Time, Min Price)
					{ timestamp: toolAABB.maxTime, price: toolAABB.minPrice }
				];

				/**
				 * CULLING & VISIBILITY CHECK
				 *
				 * For an unbounded tool like the Path, we cannot check a simple fixed box.
				 * 1. We calculate the AABB (Axis-Aligned Bounding Box) of *all* permanent points in logical space.
				 * 2. We synthesize a logical box from these min/max values (Top-Left and Bottom-Right).
				 * 3. We check if this box intersects the current viewport.
				 *
				 * Note: We only cull when the tool is *finished* or static. During creation, we always render.
				 */
				const cullingState = getToolCullingState(boundingPointsLogical, this._tool);

				if (cullingState !== OffScreenState.Visible) {
					//console.log('path culled')
					this._renderer.clear();
					return;
				}
			}
		}
		// --- CULLING IMPLEMENTATION END ---

		// 2. Configure Renderers - The Path tool simply passes the raw points to the Polygon Renderer.
 
		// Get a complete, final LineOptions object from the Model's options
		const finalLineOptions = options.line as LineOptions;
 
		// The Path tool can be used to draw non-closed shapes, so hitTestBackground should be false.
		/**
		 * POLYGON RENDERER DATA SETUP
		 *
		 * We configure the `PolygonRenderer` with the raw screen points.
		 * - `points`: The full array of screen coordinates.
		 * - `line`: The visual styling (color, width).
		 * - `hitTestBackground`: Set to `false`. Unlike the Triangle, a Path is usually an open line,
		 *   so we only want to detect hits on the line segments themselves, not the empty space "inside".
		 */
		const polygonRendererData: PolygonRendererData = {
			points: this._points, // Raw screen points (including ghost point if creating)
			line: finalLineOptions, // Complete LineOptions
			hitTestBackground: false, // Don't hit test the background (Path is usually not filled)
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		};
 
		this._polygonRenderer.setData(polygonRendererData);

		(this._renderer as CompositeRenderer<HorzScaleItem>).append(this._polygonRenderer);

		// 3. Add Anchors
		//if (this.areAnchorsVisible()) {
			this._addAnchors(this._renderer as CompositeRenderer<HorzScaleItem>);
		//}
	}

	/**
	 * Creates and adds an anchor point for every vertex in the path.
	 *
	 * **Tutorial Note:**
	 * Since a Path can have N points, we map every point in the `_points` array to an `AnchorPoint`.
	 * We use the `DiagonalNwSeResize` cursor as a generic "Move Point" indicator, as the direction
	 * of resize depends on the specific segment orientation.
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length === 0) return;

		const anchorPoints: AnchorPoint[] = this._points.map((p, index) => {
			// Creates an anchor for each point. We use the point's index as its ID.
			return new AnchorPoint(p.x, p.y, index, false);
		});

		const anchorData = {
			points: anchorPoints,
			// Since every anchor is a standard vertex, they should use a standard resize/drag cursor
			pointsCursorType: anchorPoints.map(p => PaneCursorType.DiagonalNwSeResize),
		};

		// Add the anchor renderer.
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}