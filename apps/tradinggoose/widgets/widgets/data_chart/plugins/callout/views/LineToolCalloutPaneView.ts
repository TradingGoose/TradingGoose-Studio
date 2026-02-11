// /src/views/LineToolCalloutPaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
	Coordinate,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPaneView,
	CompositeRenderer,
	SegmentRenderer,
	TextRenderer,
	AnchorPoint,
	OffScreenState,
	getToolCullingState,
	LineToolOptionsInternal,
	TextRendererData,
	PaneCursorType,
	LineJoin,
	LineCap,
	LineOptions,
	deepCopy,
} from '../../core';

import { LineToolCallout } from '../model/LineToolCallout';


/**
 * Pane View for the Callout tool.
 *
 * **Tutorial Note on View Logic:**
 * The Callout requires a custom view because its rendering pipeline differs from a simple line.
 * It involves two distinct visual elements:
 * 1. A **Text Box** (the annotation).
 * 2. A **Stem Line** (connecting the target point P0 to the text box P1).
 *
 * This view manages the coordination of these two renderers.
 */
export class LineToolCalloutPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {

	protected _segmentRenderer: SegmentRenderer<HorzScaleItem> = new SegmentRenderer();
	protected _textRenderer: TextRenderer<HorzScaleItem> = new TextRenderer();

	/**
	 * Initializes the Callout View.
	 *
	 * @param source - The specific Callout model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolCallout<HorzScaleItem>,
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);
	}

	/**
	 * Orchestrates the rendering of the line stem and the text box.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'Callout'>;

		if (!options.visible) {
			return;
		}

		if (this._tool.points().length < 2) {
			return;
		}

		// 1. CULLING: Callout is a segment, so we rely on the core geometric culling.
		const points = this._tool.points();

		/**
		 * 1. CULLING & VISIBILITY CHECK
		 *
		 * Even though the Callout is complex, we treat the Stem (segment P0-P1) as the
		 * primary object for culling. We use the core geometric culler to check visibility.
		 */
		const cullingState = getToolCullingState(points, this._tool as BaseLineTool<HorzScaleItem>, options.line.extend);

		if (cullingState !== OffScreenState.Visible) {
			return; // Exit if culled
		}

		// 2. Coordinate Conversion
		const hasScreenPoints = this._updatePoints(); // Converts logical points to screen coordinates (_points array)
		if (!hasScreenPoints) {
			return;
		}

		const [point0, point1] = this._points; // Screen coordinates P0 (Stem Start) and P1 (Text Box Anchor)


		// Text Renderer logic needs the text pivot, which is P1 in screen space
		const textPivot = point1;
		const textOptions = deepCopy(options.text);

		/**
		 * 2. TEXT RENDERER SETUP (MEASUREMENT)
		 *
		 * We calculate the text box data first. P1 serves as the "Pivot" or anchor for the text box.
		 * We configure the `TextRendererData` with P1 and the text options.
		 *
		 * `measure()` can be called here if we need to know the box dimensions to adjust the stem
		 * endpoint (e.g., to stop at the box border instead of the center), though in this
		 * simplified implementation, the stem runs directly to the pivot P1.
		 */
		const textRendererData: TextRendererData = {
			points: [textPivot],
			text: textOptions,
			useThemeForegroundColor: true,
			useThemeBackgroundColor: true,
			hitTestBackground: true,
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		};

		// Temporarily set data to the TextRenderer to measure the final bounding box size.
		// NOTE: This must happen *before* we calculate the final line end point.
		this._textRenderer.setData(textRendererData);
		const boxDimensions = this._textRenderer.measure(); // { width: boxWidth, height: boxHeight }


		/**
		 * 3. SEGMENT RENDERER SETUP (THE STEM)
		 *
		 * We configure the `SegmentRenderer` to draw the line connecting the Target (P0)
		 * to the Text Box (P1).
		 */
		const lineOptions = deepCopy(options.line) as any;
		lineOptions.join = lineOptions.join || LineJoin.Miter;
		lineOptions.cap = lineOptions.cap || LineCap.Butt;

		this._segmentRenderer.setData({
			points: [point0, point1], // P0 to P1
			line: lineOptions as LineOptions,
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		});

		// --- 4. Final Assembly ---

		this._renderer.clear();
		const compositeRenderer = new CompositeRenderer<HorzScaleItem>();

		// Render the Line Stem first
		compositeRenderer.append(this._segmentRenderer);

		// Render the Text Box second
		compositeRenderer.append(this._textRenderer);

		// Render Anchors last for hit-test priority
		if (this.areAnchorsVisible()) {
			this._addAnchors(compositeRenderer);
		}

		this._renderer = compositeRenderer;
	}

	/**
	 * Adds the two interactive anchor points.
	 *
	 * - **P0:** The "Target" point (where the callout points to).
	 * - **P1:** The "Text" point (where the annotation sits).
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 2) return;

		const [point0, point1] = this._points;

		// The two anchor points (P0 and P1)
		const anchorData = {
			points: [point0, point1],
			pointsCursorType: [PaneCursorType.Pointer, PaneCursorType.Pointer],
		};

		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}
