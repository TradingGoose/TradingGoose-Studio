// /src/views/line-tool-price-axis-label-view.ts

import { PriceAxisView } from './price-axis-view';
import {
	PriceAxisViewRendererCommonData,
	PriceAxisViewRendererData,
	PriceAxisViewRendererOptions
} from '../types';
import { BaseLineTool } from '../model/base-line-tool';
import { LineToolPoint } from '../api/public-api';
import { generateContrastColors } from '../utils/helpers';
import { IChartApiBase, Coordinate, ISeriesApi, SeriesType, ISeriesPrimitiveAxisView } from 'lightweight-charts';
import { PriceAxisLabelStackingManager } from '../model/price-axis-label-stacking-manager';
import { PriceAxisViewRenderer } from '../rendering/price-axis-view-renderer';

/**
 * A concrete implementation of a Price Axis View for a specific anchor point of a Line Tool.
 * 
 * This class manages the lifecycle of a single price label on the Y-axis. It is responsible for:
 * 1. formatting the price value based on the series configuration.
 * 2. determining visibility based on the tool's interaction state (selected, hovered).
 * 3. interacting with the {@link PriceAxisLabelStackingManager} to prevent label overlaps.
 * 
 * @typeParam HorzScaleItem - The type of the horizontal scale item.
 */
export class LineToolPriceAxisLabelView<HorzScaleItem> extends PriceAxisView implements ISeriesPrimitiveAxisView {
	private readonly _tool: BaseLineTool<HorzScaleItem>;
	private readonly _pointIndex: number;
	private readonly _chart: IChartApiBase<HorzScaleItem>;
	private readonly _priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>;

	// NEW: Store the fixed coordinate provided by the stacking manager
    private _fixedCoordinate: Coordinate | undefined = undefined;

    private _isRegistered: boolean = false; 

	/**
     * Initializes the price axis label view.
     * 
     * @param tool - The parent line tool instance.
     * @param pointIndex - The index of the point in the tool's data array that this label represents.
     * @param chart - The chart API instance.
     * @param priceAxisLabelStackingManager - The manager instance to register this label with for collision resolution.
     */
	public constructor(tool: BaseLineTool<HorzScaleItem>, pointIndex: number, chart: IChartApiBase<HorzScaleItem>, priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>) {
		super();
		this._tool = tool;
		this._pointIndex = pointIndex;
		this._chart = chart;
		this._priceAxisLabelStackingManager = priceAxisLabelStackingManager;
	}

    /**
     * Retrieves the index of the point this label is associated with.
     * 
     * Used primarily by the {@link PriceAxisLabelStackingManager} to generate a unique ID 
     * for this label (e.g., `ToolID-pIndex`).
     * 
     * @returns The zero-based point index.
     */
    public getPointIndex(): number {
        return this._pointIndex;
    }

    /**
     * Callback method used by the {@link PriceAxisLabelStackingManager} to update the label's vertical position.
     * 
     * If the stacking manager detects a collision, it calls this method with a new, adjusted Y-coordinate.
     * This method then triggers an immediate chart update to ensure the label is drawn at the new position
     * in the same render frame, preventing visual jitter.
     * 
     * @param coordinate - The calculated collision-free Y-coordinate, or `undefined` to use the natural position.
     */
    public setFixedCoordinateFromManager(coordinate: Coordinate | undefined): void {
        if (this._fixedCoordinate !== coordinate) {
            this._fixedCoordinate = coordinate;
            this.update(); // Mark view as dirty

            // *** AGGRESSIVE FIX: Force a chart update to read the new fixed coordinate ***
            // This should eliminate the visual flicker during drag/scale by forcing the coordinate
            // to be read by the renderer within the same frame it was calculated.
            this._tool._triggerChartUpdate(); 
        }
    }    

	/**
     * The core logic for updating the renderer's state.
     * 
     * This overrides the abstract method from {@link PriceAxisView}. It performs several critical tasks:
     * 1. **Validity Check:** Verifies if the tool and point are valid; if not, unregisters the label from the stacking manager.
     * 2. **Registration:** Registers (or updates) the label with the {@link PriceAxisLabelStackingManager}, providing current height and position data.
     * 3. **Formatting:** Formats the price value into a string using the series' formatter.
     * 4. **Styling:** Applies high-contrast colors (using {@link generateContrastColors}) based on the tool's configuration.
     * 5. **Coordinate Sync:** Ensures the renderer uses the `fixedCoordinate` (if set) or the natural price coordinate.
     * 
     * @param axisRendererData - The data object for the main axis label.
     * @param paneRendererData - The data object for any pane-side rendering (unused here).
     * @param commonData - Shared data (coordinates, colors) between axis and pane renderers.
     */
	protected _updateRendererData(
		axisRendererData: PriceAxisViewRendererData,
		paneRendererData: PriceAxisViewRendererData,
		commonData: PriceAxisViewRendererCommonData
	): void {
		// Set fixed coordinate (from manager) at the very start
		commonData.fixedCoordinate = this._fixedCoordinate;

		axisRendererData.visible = false;
		paneRendererData.visible = false;

		const toolOptions = this._tool.options();
		const priceScaleApi = this._tool.priceScale();
		const series = this._tool.getSeries();
		const point = this._tool.getPoint(this._pointIndex);
		const labelId = this._tool.id() + '-p' + this._pointIndex;

		// 1. Calculate the tool's current interaction state
		const isToolActive = this._tool.isSelected() || this._tool.isHovered() || this._tool.isEditing() || this._tool.isCreating();
		
		// 2. Determine if the label should be visually active based on options
		const isLabelVisuallyActive = toolOptions.priceAxisLabelAlwaysVisible || isToolActive;

		// Determine if the label is structurally valid (Prerequisite for stacking registration)
		const isStructurallyValid = 
			toolOptions.visible &&
			toolOptions.showPriceAxisLabels &&
			isLabelVisuallyActive &&
			point &&
			isFinite(point.price) &&
			priceScaleApi &&
			series;

		// --- 1. HANDLE UNREGISTER/CLEAR (If Structure Fails) ---
		if (!isStructurallyValid) {
			if (this._isRegistered) {
				this._priceAxisLabelStackingManager.unregisterLabel(labelId);
				this._isRegistered = false;
				this.setFixedCoordinateFromManager(undefined); // Clear old fixed coordinate
			}
			return;
		}

		// --- 2. CALCULATE DATA & HEIGHT (Runs only if structurally valid) ---
		
		const backgroundColor = this._tool.priceAxisLabelColor();
		
		// The manager needs the coordinate regardless of the color being null, but LWC views should be clean.
		commonData.coordinate = series.priceToCoordinate(point!.price) as Coordinate;

		// Height calculation remains complex, relying on temporary setup:
		const layoutOptions = this._chart.options().layout;
		const priceScaleOptions = priceScaleApi!.options();
		
		const currentRendererOptions: PriceAxisViewRendererOptions = {
			font: `${layoutOptions.fontSize}px ${layoutOptions.fontFamily}`,
			fontFamily: layoutOptions.fontFamily,
			color: layoutOptions.textColor,
			fontSize: layoutOptions.fontSize,
			// Approximate/Default internal padding and sizing from V3.8's PriceAxisRendererOptionsProvider defaults
			baselineOffset: Math.round(layoutOptions.fontSize / 10),
			borderSize: priceScaleOptions.borderVisible ? 1 : 0,
			paddingBottom: Math.floor(layoutOptions.fontSize / 3.5),
			paddingTop: Math.floor(layoutOptions.fontSize / 3.5),
			paddingInner: Math.max(Math.ceil(layoutOptions.fontSize / 2 - (priceScaleOptions.ticksVisible ? 4 : 0) / 2), 0),
			paddingOuter: Math.ceil(layoutOptions.fontSize / 2 + (priceScaleOptions.ticksVisible ? 4 : 0) / 2),
			tickLength: priceScaleOptions.ticksVisible ? 4 : 0,
		};
		
		let labelHeight = 16;
		try {
			const textToMeasure = series.priceFormatter().format(point!.price) || '0';
			const tempRendererData: PriceAxisViewRendererData = { text: textToMeasure, visible: true, tickVisible: false } as any;
			const tempCommonData: PriceAxisViewRendererCommonData = { coordinate: 0 as Coordinate, background: 'black', color: 'white' } as any;
			const tempRenderer = new PriceAxisViewRenderer(tempRendererData, tempCommonData);
			labelHeight = tempRenderer.height(currentRendererOptions, false);
		} catch (e) {
			// fallback
		}

		// --- 3. REGISTER/UPDATE with Stacking Manager (Upsert) ---
		
		this._priceAxisLabelStackingManager.registerLabel({
			id: labelId,
			toolId: this._tool.id(),
			originalCoordinate: commonData.coordinate as Coordinate,
			height: labelHeight,
			setFixedCoordinate: (coord: Coordinate | undefined) => this.setFixedCoordinateFromManager(coord),
			isVisible: () => true, // We are structurally valid, so we are visible to the manager
		});

		this._isRegistered = true;

		// --- 4. FINAL RENDERER DATA SETUP (Drawing Properties) ---

		// Only set drawing properties if the label is interactionally visible (color is supplied)
		if (backgroundColor !== null) {
			const colors = generateContrastColors(backgroundColor);
			commonData.background = colors.background;
			commonData.color = colors.foreground;
			axisRendererData.text = series.priceFormatter().format(point!.price);
			axisRendererData.borderColor = colors.background;
			axisRendererData.visible = true; // Make label draw
		} else {
			// If visually inactive, ensure data sent to renderer is clean
			axisRendererData.visible = false;
		}
		
		// The fixed coordinate is already set by the manager's logic. We trust the coordinate() getter to return it.
	}

}