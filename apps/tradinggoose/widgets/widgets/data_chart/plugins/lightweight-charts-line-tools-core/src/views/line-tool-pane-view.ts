// /src/views/line-tool-pane-view.ts

import { IUpdatablePaneView, IPaneRenderer, LineToolHitTestData, PaneCursorType, HitTestType, LineAnchorCreationData } from '../types';
import { AnchorPoint } from '../rendering/line-anchor-renderer';
import { Point,  } from '../utils/geometry';
import { CompositeRenderer } from '../rendering/composite-renderer';
import { IChartApiBase, ISeriesApi, SeriesType, IPaneApi } from 'lightweight-charts';
import { BaseLineTool } from '../model/base-line-tool';
import { LineAnchorRenderer, LineAnchorRendererData } from '../rendering/line-anchor-renderer';
import { DeepPartial } from '../utils/helpers';
import { RectangleRenderer, TextRenderer } from '../rendering/generic-renderers';



/**
 * Abstract base class for the Pane View of a Line Tool.
 * 
 * This view is responsible for rendering the main visual elements of the tool (lines, shapes, text)
 * directly onto the chart pane. It also manages the state and rendering of interactive elements
 * like resize anchors.
 * 
 * Concrete tool implementations should extend this class and override `_updateImpl` to define
 * their specific rendering logic.
 * 
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export abstract class LineToolPaneView<HorzScaleItem> implements IUpdatablePaneView {
    /**
     * Reference to the specific line tool model instance this view represents.
     * Provides access to the tool's options, points, and state.
     * @protected
     */
    protected readonly _tool: BaseLineTool<HorzScaleItem>;

    /**
     * Reference to the Lightweight Charts API instance.
     * Used for coordinate conversions and accessing chart options.
     * @protected
     */
    protected readonly _chart: IChartApiBase<HorzScaleItem>;

    /**
     * Reference to the series API instance the tool is attached to.
     * Used for price-to-coordinate conversions.
     * @protected
     */
    protected readonly _series: ISeriesApi<SeriesType, HorzScaleItem>;
	

    /**
     * Internal cache of the tool's points converted to screen coordinates (pixels).
     * These are recalculated whenever `_updatePoints` is called.
     * @protected
     */
    protected _points: AnchorPoint[] = []; // Screen coordinates of the tool's defining points

    /**
     * Dirty flag indicating if the view's data is out of sync with the model.
     * If `true`, `_updateImpl` will be called during the next render cycle.
     * @protected
     */
    protected _invalidated: boolean = true; // Flag to indicate if the view needs updating

    /**
     * Collection of renderers responsible for drawing the interactive anchor points (handles).
     * These are reused to avoid unnecessary object creation.
     * @protected
     */
    protected _lineAnchorRenderers: LineAnchorRenderer<HorzScaleItem>[] = []; // Renderers for the tool's anchor points

    /**
     * The main composite renderer for this view.
     * It aggregates all specific renderers (shape, text, anchors) into a single draw call.
     * @protected
     */
    protected _renderer: CompositeRenderer<HorzScaleItem>;

    /**
     * A reusable renderer instance for drawing rectangular shapes or backgrounds.
     * @protected
     */
    protected _rectangleRenderer: RectangleRenderer<HorzScaleItem>;

    /**
     * A reusable renderer instance for drawing text labels.
     * @protected
     */
    protected _labelRenderer: TextRenderer<HorzScaleItem>;

    /**
     * Initializes the Pane View.
     * 
     * @param tool - The specific line tool model.
     * @param chart - The chart API instance.
     * @param series - The series API instance.
     */
    public constructor(
        tool: BaseLineTool<any>,
        chart: IChartApiBase<any>,
        series: ISeriesApi<SeriesType, any>,
    ) {
        this._tool = tool;
        this._chart = chart;
        this._series = series;
        // Initialize the renderer here, it will be populated in _updateImpl
        // Default to a composite renderer which can hold other renderers
        this._renderer = new CompositeRenderer<HorzScaleItem>();
        this._rectangleRenderer = new RectangleRenderer<HorzScaleItem>();
        this._labelRenderer = new TextRenderer<HorzScaleItem>();
    }

    /**
     * Signals that the view's data or options have changed.
     * 
     * Sets the `_invalidated` flag to `true`, forcing a recalculation of geometry
     * and render data during the next paint cycle.
     * 
     * @param updateType - The type of update (e.g., 'data', 'options').
     */
    public update(updateType?: 'data' | 'other' | 'options'): void {
        this._invalidated = true;
    }

    /**
     * Retrieves the renderer for the current frame.
     * 
     * If the view is invalidated, this method triggers `_updateImpl` to refresh the
     * rendering logic before returning the renderer.
     * 
     * @returns The {@link IPaneRenderer} to be drawn, or `null` if nothing should be rendered.
     */
    public renderer(): IPaneRenderer | null {
        if (this._invalidated) {
            const chartElement = this._chart.chartElement();
            const height = chartElement.clientHeight;
            const width = chartElement.clientWidth;

            // If the chart has no size, there is nothing to draw.
            if (height <= 0 || width <= 0) {
                (this._renderer as CompositeRenderer<HorzScaleItem>).clear();
                return null;
            }

            this._updateImpl(height, width);
            this._invalidated = false;
        }
        return this._renderer;
    }

    /**
     * Converts the tool's logical points (Time/Price) into screen coordinates (Pixels).
     * 
     * This method accesses the chart's time scale and the series' price scale to perform
     * the conversion. It populates the `_points` array.
     * 
     * @returns `true` if all points were successfully converted, `false` if scale data is missing.
     * @protected
     */
    protected _updatePoints(): boolean {
        const timeScaleApi = this._chart.timeScale();
        const priceScale = this._tool.priceScale();

        if (timeScaleApi.getVisibleLogicalRange() === null || !priceScale) {
            return false;
        }

        this._points = [];
        const sourcePoints = this._tool.points();

        for (let i = 0; i < sourcePoints.length; i++) {
            const point = this._tool.pointToScreenPoint(sourcePoints[i]) as AnchorPoint;
            if (!point) {
                return false; // Point conversion failed
            }
            point.data = i;
            this._points.push(point);
        }

        return true;
    }


    /**
     * The core update logic for the view.
     * 
     * This method is called when the view is invalidated. It is responsible for:
     * 1. Clearing the composite renderer.
     * 2. Updating point coordinates via `_updatePoints`.
     * 3. Constructing the specific renderers (lines, shapes) required for the tool's current state.
     * 4. Adding interaction anchors if applicable.
     * 
     * @param height - The current height of the pane in pixels.
     * @param width - The current width of the pane in pixels.
     * @protected
     */
    protected _updateImpl(height: number, width: number): void {
        (this._renderer as CompositeRenderer<HorzScaleItem>).clear();

        if (!this._tool.options().visible) {
            return;
        }

        if (this._updatePoints()) {
            // This is where a generic tool might add its renderers.
            // For our specific tools, we'll override this entire method.
            if (this.areAnchorsVisible() && this._points.length > 0) {
                this._addAnchors(this._renderer as CompositeRenderer<HorzScaleItem>);
            }
        }
    }

    /**
     * Determines if the tool's interaction anchors (resize handles) should be visible.
     * 
     * Anchors are typically shown when the tool is selected, hovered, being edited,
     * or currently being drawn (not finished).
     * 
     * @returns `true` if anchors should be drawn.
     * @protected
     */
    protected areAnchorsVisible(): boolean {
        return this._tool.isHovered() || this._tool.isSelected() || this._tool.isEditing() || !this._tool.isFinished();
    }

    /**
     * Adds anchor renderers to the composite renderer.
     * 
     * This method is intended to be overridden or used by subclasses to place
     * resize handles at specific points (e.g., corners of a rectangle, ends of a line).
     * 
     * @param renderer - The composite renderer to append anchors to.
     * @protected
     */
    protected _addAnchors(renderer: CompositeRenderer<HorzScaleItem>): void {
        // Concrete views will pass their specific anchor configurations to this.createLineAnchor.
        // This abstract method is just a placeholder to ensure it's called.
    }

    

    /**
     * Factory method to create or recycle a `LineAnchorRenderer`.
     * 
     * It configures the anchor with standard styling (colors, hit test logic) and
     * specific interaction data (index, cursor type).
     * 
     * @param data - Configuration data for the anchor (points, cursors).
     * @param index - The index in the internal renderer array (for recycling).
     * @returns A configured {@link LineAnchorRenderer}.
     * @protected
     */
    protected createLineAnchor(data: LineAnchorCreationData, index: number): LineAnchorRenderer<HorzScaleItem> { 
        let renderer = this._lineAnchorRenderers[index];
        if (!renderer) {
            renderer = new LineAnchorRenderer(this._chart); // Pass chart instance to anchor renderer
            this._lineAnchorRenderers.push(renderer);
        }
        
        // Populate the renderer with common anchor data
        const toolOptions = this._tool.options();
        renderer.setData({
            ...data,
            radius: 6, // Default radius
            strokeWidth: 1, // Default stroke width
            color: '#1E53E5', // Default color (blue)
            hoveredStrokeWidth: 4, // Default hovered stroke width
            selected: this._tool.isSelected(),
            visible: this.areAnchorsVisible(),
            currentPoint: this._tool.currentPoint(), // Mouse position
            backgroundColors: this._lineAnchorColors(data.points), // Colors for anchors' backgrounds
            editedPointIndex: this._tool.isEditing() ? this._tool.editedPointIndex() : null,
            hitTestType: HitTestType.ChangePoint, // Default hit test type for anchors
        });
        return renderer;
    }

    /**
     * Helper to determine the background color for anchor points.
     * 
     * By default, it attempts to match the chart's background color to make hollow
     * anchors look transparent or blend in. Subclasses can override this for custom styling.
     * 
     * @param points - The list of anchor points.
     * @returns An array of color strings corresponding to each point.
     * @protected
     */
    protected _lineAnchorColors(points: AnchorPoint[]): string[] {
        // This is a placeholder; concrete views can override for custom coloring.
        // Defaulting to chart's layout background color for anchor circles/squares.
        const chartOptions = this._chart.options();
        const backgroundColor = chartOptions.layout.background;

        // Apply a color based on the chart's background type
        const defaultAnchorColor = backgroundColor.type === 'solid' ? backgroundColor.color : 'transparent';
        
        return points.map(point => defaultAnchorColor);
    }
}