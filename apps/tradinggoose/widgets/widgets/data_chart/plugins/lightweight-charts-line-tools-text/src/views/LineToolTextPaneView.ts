// /src/views/LineToolTextPaneView.ts

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
	AnchorPoint,
	OffScreenState,
	getToolCullingState,
	LineToolOptionsInternal,
	TextRenderer,
	HitTestType,
	TextRendererData,
	BoxVerticalAlignment,
	BoxHorizontalAlignment,
	PaneCursorType,
	TextAlignment,
	deepCopy,
	ensureNotNull
} from '../../../lightweight-charts-line-tools-core/src';

import { LineToolText } from '../model/LineToolText';


/**
 * Pane View for the Text tool.
 *
 * **Tutorial Note on Logic:**
 * This view implements complex alignment logic. Unlike simple shapes, a Text Box's size depends
 * on its content, font, and word wrapping.
 *
 * This view performs a 3-step process:
 * 1. **Measure:** Pre-renders the text internally to determine its pixel width/height.
 * 2. **Align:** Calculates an "Adjusted Pivot" point based on the user's alignment settings
 *    (e.g., if aligned "Right", the box is shifted left so its right edge touches the anchor).
 * 3. **Render:** configure the final renderer with this adjusted position.
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
	 * It handles the "Measure -> Calculate Offset -> Render" pipeline to ensure the text box
	 * appears exactly where the user expects relative to the anchor point.
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
			//console.log('text culled')
			return; // Exit if culled
		}
		// --- CULLING IMPLEMENTATION END ---

		// 1. Coordinate Conversion: Get screen coordinates for the single point P0.
		const hasScreenPoints = this._updatePoints(); // Converts logical points to screen coordinates (_points array)

		if (!hasScreenPoints) {
			return;
		}

		const [anchorPoint] = this._points; // Screen coordinates of the single anchor P0
		const rawPivot = anchorPoint; // The raw anchor point is the starting reference for the pivot.


		// --- 2. Text Renderer Setup (Text Box Size and Pivot Offset Calculation) ---

		// --- 2a. Temporarily set data to measure the box size (must happen BEFORE pivot calculation) ---

		/**
		 * TEXT MEASUREMENT (PRE-CALCULATION)
		 *
		 * Before we can determine where to draw the box, we need to know how big it is.
		 * We configure the TextRenderer with the content and font options and call `measure()`.
		 * This returns the calculated pixel width and height of the final box.
		 */
		const textOptions = deepCopy(options.text);
		const temporaryTextRendererData: TextRendererData = {
			points: [rawPivot], 
			text: textOptions,
			hitTestBackground: true,
		};
		this._textRenderer.setData(temporaryTextRendererData);
		const boxDimensions = this._textRenderer.measure(); // { width: boxWidth, height: boxHeight }
		//console.log('boxDimensions', boxDimensions)

		// --- 2b. Calculate Adjusted Pivot (textPivot) ---

		/**
		 * PIVOT ADJUSTMENT (ALIGNMENT LOGIC)
		 *
		 * The `TextRenderer` draws starting from a specific point. However, the user might want
		 * that point to represent the "Bottom Right" of the box, not the "Top Left".
		 *
		 * We calculate offsets based on the `boxDimensions` found in the previous step.
		 * - **Horizontal:** If aligned Right, we shift the x-pivot left by the box width.
		 * - **Vertical:** If aligned Bottom, we shift the y-pivot up by the box height.
		 */
		let adjustedPivotX = rawPivot.x;
		let adjustedPivotY = rawPivot.y;
		
		// Adjust X based on box width and box.alignment.horizontal
		const horizontalAlignment = options.text.box?.alignment?.horizontal;
		//console.log('horizontalAlignment', horizontalAlignment)
		
		// Note: The TextRenderer draws the box *starting* at the pivot X and Y.
		// To achieve the desired alignment, we must offset the pivot based on the box's size.
		switch (horizontalAlignment) {
			case BoxHorizontalAlignment.Right:
				// Goal: The right edge of the text box should touch the anchor point.
				// Action: Offset the pivot LEFT by the full box width.
				adjustedPivotX = (rawPivot.x + (boxDimensions.width)) as Coordinate;
				break;
			case BoxHorizontalAlignment.Center:
				// Goal: The center of the text box should align with the anchor point.
				// Action: Offset the pivot LEFT by half the box width.
				adjustedPivotX = (rawPivot.x) as Coordinate;
				break;
			case BoxHorizontalAlignment.Left:
				// Goal: The left edge of the text box should touch the anchor point.
				// Action: No horizontal offset needed (pivot is already at the left edge).
				adjustedPivotX = (rawPivot.x  - (boxDimensions.width)) as Coordinate;
				break;
		}

		// Adjust Y based on box height and box.alignment.vertical
		const verticalAlignment = options.text.box?.alignment?.vertical;
		//console.log('verticalAlignment', verticalAlignment)
		
		switch (verticalAlignment) {
			case BoxVerticalAlignment.Bottom:
				// Goal: The bottom edge of the text box should touch the anchor point.
				// Action: Offset the pivot UP by the full box height.
				adjustedPivotY = (rawPivot.y + (boxDimensions.height / 2)) as Coordinate;
				break;
			case BoxVerticalAlignment.Middle:
				// Goal: The center of the text box should align with the anchor point.
				// Action: Offset the pivot UP by half the box height.
				adjustedPivotY = (rawPivot.y) as Coordinate;
				break;
			case BoxVerticalAlignment.Top:
				// Goal: The top edge of the text box should touch the anchor point.
				// Action: No vertical offset needed.
				adjustedPivotY = (rawPivot.y - (boxDimensions.height / 2)) as Coordinate;
				break;
		}
		
		// Create the new adjusted pivot point
		const adjustedPivot = new AnchorPoint(adjustedPivotX, adjustedPivotY, rawPivot.data);


		// --- 2c. Final Renderer Data Setup ---

		/**
		 * FINAL RENDERER DATA SETUP
		 *
		 * We configure the `TextRenderer` with the **Adjusted Pivot**.
		 * This ensures that when the renderer draws the box at (x,y), it visually aligns
		 * correctly with the user's original anchor point.
		 */
		const textRendererData: TextRendererData = {
			// The calculated pivot point is now passed as the attachment point
			points: [adjustedPivot], 
			text: textOptions, 
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