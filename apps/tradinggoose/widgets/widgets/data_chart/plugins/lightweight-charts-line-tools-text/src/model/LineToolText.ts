// /src/model/LineToolText.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	SeriesType,
	Coordinate,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPoint,
	LineToolOptionsInternal,
	LineToolType,
	DeepPartial,
	LineToolsCorePlugin,
	merge,
	deepCopy,
	PriceAxisLabelStackingManager,
	HitTestResult,
	HitTestType,
	Point,
	LineToolHitTestData,
	LineToolTextOptions,
	LineEnd,
	TextAlignment,
	BoxVerticalAlignment,
	BoxHorizontalAlignment,
	TextOptions,
	PaneCursorType,
	CompositeRenderer,
} from '../../../lightweight-charts-line-tools-core/src';

import { LineToolTextPaneView } from '../views/LineToolTextPaneView';

// --- Default Options (Mimicking the base TrendLine structure but with specific Text defaults) ---

/**
 * Defines the default configuration options for the Text tool.
 *
 * **Tutorial Note:**
 * The Text tool is unique because it is a **Single Point** tool (`pointsCount: 1`) that renders
 * a complex text box.
 *
 * Key Defaults:
 * - **Cursors:** Uses `Grabbing` for drag and `Pointer` for hover to mimic standard UI elements.
 * - **Axis Labels:** Hidden by default (`showPriceAxisLabels: false`), as text annotations are usually informational, not analytical.
 * - **Box:** Defaults to a standard text box alignment (Centered horizontally, Top vertically relative to the anchor).
 */
const TextToolDefaultOptions: LineToolOptionsInternal<'Text'> = {
	visible: true,
	editable: true,
	defaultHoverCursor: PaneCursorType.Pointer,
	defaultDragCursor: PaneCursorType.Grab,
	defaultAnchorHoverCursor: PaneCursorType.Pointer,
	defaultAnchorDragCursor: PaneCursorType.Grabbing,
	notEditableCursor: PaneCursorType.NotAllowed,
	showPriceAxisLabels: false,
	showTimeAxisLabels: false,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,
	
	// Specific Options for TextTool (Inherits from core's TextToolOptions)
	text: {
		value: 'Text', // Default value
		padding: 0,
		wordWrapWidth: 0,
		forceTextAlign: false,
		forceCalculateMaxLineWidth: false,
		alignment: TextAlignment.Center, 

		font: {
			color: '#2962ff',
			size: 12,
			bold: false,
			italic: false,
			family: 'sans-serif',
		},

		box: {
			scale: 1,
			angle: 0,
			alignment: { vertical: BoxVerticalAlignment.Top, horizontal: BoxHorizontalAlignment.Center },
			// Default box is empty/transparent.
		},
	} as TextOptions,
};


/**
 * Concrete implementation of the Text drawing tool.
 *
 * **What is a Text Tool?**
 * It is a tool defined by a **Single Point** (P0). This point acts as the anchor/pivot
 * for a text box.
 *
 * **Inheritance:**
 * It inherits directly from {@link BaseLineTool} because it does not share the 2-point geometry
 * logic of the Trend Line family. It implements its own simple 1-point logic.
 */
export class LineToolText<HorzScaleItem> extends BaseLineTool<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('Text').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'Text';
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Text tool is defined by exactly **1 point** (the anchor location).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 1;

	/**
	 * Initializes the Text tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** Uses `TextToolDefaultOptions` which configures the specific cursors and hides axis labels.
	 * 2. **User Options:** Merges user provided settings.
	 * 3. **View:** Assigns `LineToolTextPaneView`, which handles the complex logic of calculating the text box size
	 *    and aligning it relative to the single anchor point.
	 *
	 * @param coreApi - The Core Plugin API.
	 * @param chart - The Lightweight Charts Chart API.
	 * @param series - The Series API this tool is attached to.
	 * @param horzScaleBehavior - The horizontal scale behavior.
	 * @param options - Configuration overrides.
	 * @param points - Initial points.
	 * @param priceAxisLabelStackingManager - The manager for label collision.
	 */
	public constructor(
		coreApi: LineToolsCorePlugin<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
		horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
		options: DeepPartial<LineToolOptionsInternal<'Text'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// 1. Start with a deep copy of the base defaults.
		const finalOptions = deepCopy(TextToolDefaultOptions) as LineToolOptionsInternal<'Text'>;
		
		// 2. Merge the user's provided options last (User wins).
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'Text'>>);

		// 3. Call the parent (BaseLineTool) constructor.
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			'Text',
			1, // 1-point tool
			priceAxisLabelStackingManager
		);

		// 4. Set the specific PaneView for this tool.
		this._setPaneViews([new LineToolTextPaneView(this, this._chart, this._series)]);

		console.log(`Text Tool created with ID: ${this.id()}`);
	}

	/**
	 * Performs the hit test for the Text Tool.
	 *
	 * **Architecture Note:**
	 * Since the text box dimensions are calculated in the View (based on font size, wrapping, etc.),
	 * the Model doesn't know the hit area. We must delegate to the View's `CompositeRenderer`.
	 *
	 * @param x - X coordinate in pixels.
	 * @param y - Y coordinate in pixels.
	 * @returns A hit result if the mouse is over the text box or the anchor.
	 * @override
	 */
	public override _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null {
		// Guard: Ensure pane view exists
		if (!this._paneViews || this._paneViews.length === 0 || !this._paneViews[0]) {
			return null;
		}

		// 1. Get the Pane View
		const paneView = this._paneViews[0] as LineToolTextPaneView<HorzScaleItem>;

		// 2. Get the Composite Renderer (calling renderer() ensures it's updated)
		const compositeRenderer = paneView.renderer() as CompositeRenderer<HorzScaleItem>;

		// 3. Delegate the hit test
		if (!compositeRenderer || !compositeRenderer.hitTest) {
			return null;
		}

		return compositeRenderer.hitTest(x, y);
	}
	
	/**
	 * Updates the coordinates of the single anchor point.
	 *
	 * @param index - The index of the point (always 0).
	 * @param point - The new logical coordinates.
	 * @override
	 */
	public override setPoint(index: number, point: LineToolPoint): void {
		if (index === 0) {
			this._points[0] = point;
			this._triggerChartUpdate();
		}
	}

	/**
	 * Explicitly defines the highest valid index for an interactive anchor point.
	 *
	 * Since `pointsCount` is 1, the only valid index is 0.
	 *
	 * @override
	 * @returns `0`
	 */
	public override maxAnchorIndex(): number {
		return 0;
	}
	
	/**
	 * Checks if the tool creation is complete.
	 *
	 * For a 1-point tool like Text, creation is finished as soon as the first point is placed.
	 *
	 * @returns `true` if at least one point exists.
	 * @override
	 */
	public override isFinished(): boolean {
		return this._points.length >= this.pointsCount;
	}

}