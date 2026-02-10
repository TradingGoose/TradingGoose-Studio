// /src/views/LineToolTrianglePaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPaneView,
	CompositeRenderer,
	PolygonRenderer,
	PolygonRendererData,
	AnchorPoint,
	LineToolOptionsInternal,
	LineOptions,
	OffScreenState,
	getToolCullingState,
	LineToolPoint,
	PaneCursorType,
	getToolBoundingBox,
	LineEnd,
	LineJoin,
	LineCap,
} from '../../core';

import { LineToolTriangle } from '../model/LineToolTriangle';


/**
 * Pane View for the Triangle tool.
 *
 * **Tutorial Note on Logic:**
 * This view utilizes the generic `PolygonRenderer` to draw the triangle.
 * Unlike complex custom views, this class primarily focuses on:
 * 1. **Data Prep:** Converting the 3 logical points to screen coordinates.
 * 2. **Culling:** Using a bounding box check (AABB) to optimize rendering.
 * 3. **Config:** Mapping the tool's specific `border` and `background` options to the generic `PolygonRendererData` structure.
 */
export class LineToolTrianglePaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	/**
	 * Internal renderer responsible for drawing the filled polygon shape and its perimeter.
	 * @protected
	 */
	protected _polygonRenderer: PolygonRenderer<HorzScaleItem> = new PolygonRenderer();

	/**
	 * Initializes the Triangle View.
	 *
	 * @param source - The specific Triangle model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolTriangle<HorzScaleItem>, // Accepts the specific Triangle Model type
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<any>, chart, series);
	}

	/**
	 * The core update logic.
	 *
	 * It prepares the 3 screen vertices and configures the `PolygonRenderer` to draw a closed shape.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'Triangle'>;
		
		if (!options.visible) {
			return;
		}

		const permanentPoints = this._tool.getPermanentPointsForTranslation();
		const isFinished = permanentPoints.length === this._tool.pointsCount;

		// 1. Convert logical points to raw screen coordinates
		const hasScreenPoints = this._updatePoints(); // Populates this._points (raw screen points)

		// Must have at least the minimum number of points (2 for an initial segment)
		if (!hasScreenPoints || this._points.length < 2) {
			return;
		}
		
		// --- CULLING IMPLEMENTATION START (Simple AABB Check) ---
		// We only check if the tool is finished. During creation, we always draw.
		if (isFinished) {
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
				 * For a closed shape like a Triangle, we use a Bounding Box (AABB) check.
				 * 1. Calculate the bounding box of the 3 points in logical space.
				 * 2. Check if that box intersects the current viewport.
				 *
				 * We only strictly cull "Finished" tools. During creation/editing, we allow drawing
				 * even if partially off-screen to ensure the user doesn't lose track of the tool.
				 */
				const cullingState = getToolCullingState(boundingPointsLogical, this._tool);

				if (cullingState !== OffScreenState.Visible) {
					//console.log('triangle culled')
					return;
				}
			}
		}
		// --- CULLING IMPLEMENTATION END ---

		// --- 2. Configure Renderer Data ---
		
		// The Triangle is a closed shape, so we need 3 points.
		const pointsToRender = this._points.slice(0, 3); // Slice to max 3 points (P0, P1, P2)

		// 2a. Determine Stroke Options (Border)
		const borderOptions = options.triangle.border;
		const lineOptions: LineOptions = {
			width: borderOptions.width,
			color: borderOptions.color,
			style: borderOptions.style,
			
			// Set defaults for unused LineOptions properties
			cap: LineCap.Butt,
			join: LineJoin.Miter, 
			end: { left: LineEnd.Normal, right: LineEnd.Normal }, 
			extend: { left: false, right: false }, 
		};
		
		// 2b. Determine Fill Option (Background)
		const backgroundOption = options.triangle.background;

		// 2c. Prepare PolygonRenderer Data

		/**
		 * POLYGON RENDERER DATA SETUP
		 *
		 * We configure the `PolygonRenderer` with the 3 vertices.
		 * - `points`: The 3 screen points.
		 * - `background`: The fill color.
		 * - `enclosePerimeterWithLine`: Set to `true` to force the renderer to close the path (P2 -> P0).
		 * - `hitTestBackground`: Set to `true` (via options logic elsewhere or implicit) to allow dragging the shape by its fill.
		 */
		const polygonRendererData: PolygonRendererData = {
			points: pointsToRender,
			line: lineOptions, 
			background: { color: backgroundOption.color },
			// Set hitTestBackground to true to allow dragging the filled area
			hitTestBackground: false, 
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
			enclosePerimeterWithLine: true,

		};
		
		// --- 3. Render and Finalize ---

		this._polygonRenderer.setData(polygonRendererData);

		(this._renderer as CompositeRenderer<HorzScaleItem>).append(this._polygonRenderer);

		// 4. Add Anchors (Only for finished tool or active creation)
		//if (this.areAnchorsVisible()) {
			this._addAnchors(this._renderer as CompositeRenderer<HorzScaleItem>);
		//}
	}
	
	/**
	 * Adds the three interactive anchor points (vertices).
	 *
	 * All three points use the `DiagonalNwSeResize` cursor to indicate general 2D resizing capability.
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 2) return;

		// The anchor points are the vertices themselves (P0, P1, P2)
		const anchorPoints: AnchorPoint[] = this._points.slice(0, 3).map((p, index) => {
			return new AnchorPoint(p.x, p.y, index, false);
		});
		
		const anchorData = {
			points: anchorPoints,
			pointsCursorType: anchorPoints.map(p => PaneCursorType.DiagonalNwSeResize),
		};

		// Add the anchor renderer set
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}
