// /src/views/LineToolTextPaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPaneView,
	CompositeRenderer,
	OffScreenState,
	getToolCullingState,
	LineToolOptionsInternal,
	TextRenderer,
	TextRendererData,
	PaneCursorType,
	deepCopy,
} from '../../core';

import { LineToolText } from '../model/LineToolText';
import { TrendLineOptionDefaults } from '../../shared/lines/model/LineToolTrendLine';


/**
 * Pane View for the Text tool.
 *
 * **Tutorial Note on Logic:**
 * This view delegates text box placement to {@link TextRenderer}.
 *
 * The tool contributes only the anchor point and text options. The renderer then applies
 * box alignment, padding, inflation, offsets, and rotation consistently with other tools.
 */
export class LineToolTextPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	
	/**
	 * Internal renderer for the text content and its surrounding box.
	 * @protected
	 */
	protected _textRenderer: TextRenderer<HorzScaleItem> = new TextRenderer();

	/**
	 * Container renderer used to group the text and the anchor point for hit-testing.
	 * @private
	 */
	private _compositeRenderer: CompositeRenderer<HorzScaleItem> = new CompositeRenderer<HorzScaleItem>();

	/**
	 * Initializes the Text View.
	 *
	 * @param source - The specific Text model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolText<HorzScaleItem>,
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		super(source as BaseLineTool<HorzScaleItem>, chart, series);
		this._compositeRenderer.append(this._textRenderer);
	}

	/**
	 * The core update logic.
	 *
	 * It builds renderer data from the tool's single anchor point and current text options.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._compositeRenderer.clear();

		const options = this._tool.options() as LineToolOptionsInternal<'Text'>;
		
		if (!options.visible) {
			return;
		}

		const points = this._tool.points();
		
		// Tool requires at least one point to draw.
		if (points.length < 1) {
			return;
		}

		// --- CULLING IMPLEMENTATION START ---

		/**
		 * CULLING & VISIBILITY CHECK
		 *
		 * Since the Text tool is defined by a single point with no infinite extensions,
		 * we use the standard culling logic. If the anchor point (P0) is off-screen,
		 * the tool is considered hidden.
		 */
		const cullingState = getToolCullingState(points, this._tool as BaseLineTool<HorzScaleItem>);
		
		if (cullingState !== OffScreenState.Visible) {
			return; // Exit if culled
		}
		// --- CULLING IMPLEMENTATION END ---

		// 1. Coordinate Conversion: Get screen coordinates for the single point P0.
		const hasScreenPoints = this._updatePoints(); // Converts logical points to screen coordinates (_points array)

		if (!hasScreenPoints) {
			return;
		}

		const [anchorPoint] = this._points; // Screen coordinates of the single anchor P0

		// --- 2. Text Renderer Setup ---
		const textOptions = deepCopy(options.text);
		const textScale = Math.max(0.01, textOptions.box?.scale ?? 1);
		const textBorderColor = textOptions.box?.border?.color?.trim();
		if (!textBorderColor && textOptions.box?.border) {
			textOptions.box.border.color = TrendLineOptionDefaults.line.color;
		}
		if (textOptions.box?.border?.radius !== undefined) {
			const borderRadius = textOptions.box.border.radius;
			textOptions.box.border.radius = Array.isArray(borderRadius)
				? borderRadius.map((radiusValue) => radiusValue * textScale)
				: borderRadius * textScale;
		}
		const textRendererData: TextRendererData = {
			points: [anchorPoint],
			text: textOptions,
			useThemeForegroundColor: false,
			useThemeBackgroundColor: true,
			hitTestBackground: true, // Allow clicking inside the box to select/drag
			toolDefaultHoverCursor: options.defaultHoverCursor,
			toolDefaultDragCursor: options.defaultDragCursor,
		};

		this._textRenderer.setData(textRendererData);
		this._compositeRenderer.append(this._textRenderer);

		// 3. Line Anchors (Handles for P0)

		//if (this.areAnchorsVisible()) {
			this._addAnchors(this._compositeRenderer);
		//}

		this._renderer = this._compositeRenderer;
	}

	/**
	 * Adds the single interactive anchor point.
	 *
	 * We use the `Move` cursor to indicate that this point controls the position of the entire text element.
	 *
	 * @param renderer - The composite renderer to append the anchor to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
		if (this._points.length < 1) return;

		const [anchorPoint] = this._points;
		
		// The single anchor point (P0)
		const anchorData = {
			points: [anchorPoint],
			// Use the default move cursor as the Text Tool is usually dragged from this point
			pointsCursorType: [PaneCursorType.Move], 
		};

		// Add the single LineAnchorRenderer set
		renderer.append(this.createLineAnchor(anchorData, 0));
	}
}
