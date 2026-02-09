// /src/views/line-tool-time-axis-label-view.ts

import {
	TimeAxisViewRendererData,
	ITimeAxisViewRenderer,
	ITimeAxisView, // Our internal interface
	TextWidthCache, // Needed for TimeAxisViewRendererOptions type
	TimeAxisViewRendererOptions, // NEW: For height method parameters
} from '../types';
import { BaseLineTool } from '../model/base-line-tool';
import { LineToolPoint } from '../api/public-api';
import { generateContrastColors } from '../utils/helpers';
import { IChartApiBase, Coordinate, Time, ITimeScaleApi, UTCTimestamp, isBusinessDay, isUTCTimestamp, InternalHorzScaleItem, ISeriesPrimitiveAxisView, Logical } from 'lightweight-charts';
import { interpolateLogicalIndexFromTime } from '../utils/geometry';


// Assume TimeAxisViewRenderer is a class as defined in src/rendering/time-axis-view-renderer.ts
import { TimeAxisViewRenderer } from '../rendering/time-axis-view-renderer';

/**
 * A concrete implementation of a Time Axis View for a specific anchor point of a Line Tool.
 * 
 * This class manages the lifecycle of a single label on the X-axis (Time Scale). 
 * Unlike standard views, it implements specialized logic to render labels in the "blank space" 
 * (future dates) by using logical index interpolation, ensuring tools can be drawn 
 * beyond the last existing data bar.
 * 
 * @typeParam HorzScaleItem - The type of the horizontal scale item (e.g., `Time` or `UTCTimestamp`).
 */
export class LineToolTimeAxisLabelView<HorzScaleItem> implements ITimeAxisView {
	private readonly _tool: BaseLineTool<HorzScaleItem>;
	private readonly _pointIndex: number;
	private readonly _chart: IChartApiBase<HorzScaleItem>; // Reference to chart for timescale & formatting
	private readonly _timeScale: ITimeScaleApi<HorzScaleItem>; // Direct reference to timeScaleAPI for convenience

	private readonly _renderer: ITimeAxisViewRenderer;
	private readonly _rendererData: TimeAxisViewRendererData = {
		visible: false,
		background: '#4c525e', // Default background, will be overridden
		color: 'white', // Default text color, will be overridden
		text: '',
		width: 0, // Will be filled by updateImpl
		coordinate: 0 as Coordinate, // X-coordinate will be filled by updateImpl
	};

	private _invalidated: boolean = true;

	/**
     * Initializes the time axis label view.
     * 
     * @param tool - The parent line tool instance.
     * @param pointIndex - The index of the point in the tool's data array that this label represents.
     * @param chart - The chart API instance (used for time scale access and formatting).
     */
	public constructor(tool: BaseLineTool<HorzScaleItem>, pointIndex: number, chart: IChartApiBase<HorzScaleItem>) {
		this._tool = tool;
		this._pointIndex = pointIndex;
		this._chart = chart;
		this._timeScale = chart.timeScale(); // Initialize timeScale reference
		this._renderer = new TimeAxisViewRenderer(); // Instantiate the renderer
		// No need to setData in constructor; _updateRendererDataIfNeeded will call it later.
	}

	// -------------------------------------------------------------------
	// Implementation of ITimeAxisView / ISeriesPrimitiveAxisView methods
	// -------------------------------------------------------------------

	/**
     * Marks the view as invalidated.
     * 
     * This signals that the internal data (text, coordinate, color) needs to be recalculated 
     * before the next render cycle. This is typically called when the tool moves or options change.
     */
	public update(): void {
		this._invalidated = true;
	}

	/**
     * Retrieves the renderer responsible for drawing the label.
     * 
     * This method ensures the renderer's data is up-to-date by triggering a recalculation 
     * (`_updateImpl`) if the view is invalidated.
     * 
     * @returns The {@link ITimeAxisViewRenderer} instance.
     */
	public getRenderer(): ITimeAxisViewRenderer {
		// Ensure renderer data is up-to-date before returning the renderer
		this._updateRendererDataIfNeeded();
		this._renderer.setData(this._rendererData); // setData is now a required method.
		return this._renderer;
	}

	/**
     * Retrieves the formatted text content for the label.
     * 
     * @returns The formatted date/time string based on the chart's localization settings.
     */
	public text(): string {
		this._updateRendererDataIfNeeded();
		return this._rendererData.text;
	}

	/**
     * Retrieves the X-coordinate of the label's center.
     * 
     * @returns The screen coordinate in pixels.
     */
	public coordinate(): Coordinate {
		this._updateRendererDataIfNeeded();
		return this._rendererData.coordinate as Coordinate;
	}

	/**
     * Retrieves the text color.
     * 
     * @returns A CSS color string (usually calculated for high contrast against the background).
     */
	public textColor(): string {
		this._updateRendererDataIfNeeded();
		return this._rendererData.color;
	}

	/**
     * Retrieves the background color of the label tag.
     * 
     * @returns A CSS color string (derived from the tool's styling options).
     */
	public backColor(): string {
		this._updateRendererDataIfNeeded();
		return this._rendererData.background;
	}

	/**
     * Checks if the label should be currently visible.
     * 
     * Visibility depends on:
     * 1. The tool's global visibility.
     * 2. The `showTimeAxisLabels` option.
     * 3. The tool's interaction state (selected/hovered) vs. `timeAxisLabelAlwaysVisible`.
     * 
     * @returns `true` if the label should be drawn.
     */
	public visible(): boolean {
		this._updateRendererDataIfNeeded();
		return this._rendererData.visible;
	}

	/**
     * Calculates the required height of the label in the time scale area.
     * 
     * This delegates to the renderer's measurement logic to ensure consistency.
     * 
     * @param rendererOptions - Current styling options for the time axis.
     * @returns The height in pixels.
     */
	public height(rendererOptions: TimeAxisViewRendererOptions): number {
		// Delegate to the actual renderer to calculate its perceived height
		// This ensures consistency between measure and draw.
		return this._renderer.height(rendererOptions);
	}

	// -------------------------------------------------------------------
	// Private/Protected helper methods for updating data
	// -------------------------------------------------------------------

	/**
     * Internal helper to trigger data recalculation only if the view is dirty.
     * 
     * @private
     */
	private _updateRendererDataIfNeeded(): void {
		if (this._invalidated) {
			this._updateImpl();
			this._invalidated = false;
		}
	}

	/**
     * The core logic for calculating the label's data.
     * 
     * Performs the following critical steps:
     * 1. **Visibility Check:** Determines if the label should be shown based on options and state.
     * 2. **Styling:** Calculates background and high-contrast text colors.
     * 3. **Formatting:** Uses `horzScaleBehavior` to format the timestamp into a string.
     * 4. **Coordinate Calculation (The "Blank Space" Logic):**
     *    Instead of standard `timeToCoordinate` (which fails for future dates), it uses 
     *    {@link interpolateLogicalIndexFromTime} to calculate a logical position even 
     *    where no data exists, allowing the label to be placed accurately in the empty future space.
     * 
     * @private
     */
	private _updateImpl(): void {
		const data = this._rendererData;
		data.visible = false; // Start as invisible

		const toolOptions = this._tool.options();

		// Determine label visibility based on options and active state
		const isToolActive = this._tool.isSelected() || this._tool.isHovered() || this._tool.isEditing() || this._tool.isCreating();

		// The label is visible if:
		// 1. Tool is generally visible AND
		// 2. showTimeAxisLabels is true AND
		// 3. (Label is set to "Always Visible" OR Tool is currently in an active state)
		if (!toolOptions.visible || !toolOptions.showTimeAxisLabels || !(toolOptions.timeAxisLabelAlwaysVisible || isToolActive)) {
			return;
		}

		// Get the specific point for this label
		const point = this._tool.getPoint(this._pointIndex);
		if (!point || !isFinite(point.timestamp)) {
			return;
		}

		// Determine the background color for the label
		const backgroundColor = this._tool.timeAxisLabelColor();
		if (backgroundColor === null) {
			return;
		}

		// Use the utility to generate contrasting text color
		const colors = generateContrastColors(backgroundColor);
		data.background = colors.background;
		data.color = colors.foreground;

		if (this._timeScale.getVisibleLogicalRange() === null) {
			return;
		}

		// Use HorzScaleBehavior to get the correct internal object for formatting
		
		// Assert the raw timestamp (which is a number) directly to the generic placeholder type (HorzScaleItem).
		const timeAsHorzScaleItem = point.timestamp as unknown as HorzScaleItem;

		// Convert raw time to the internal LWC object structure needed for full format/coordinate functions.
		// This ensures we get the *exact* object expected by LWC's internal APIs.
		const internalHorzItemForFormatting = this._tool.horzScaleBehavior.convertHorzItemToInternal(timeAsHorzScaleItem);

		// Apply Formatting
		data.text = this._tool.horzScaleBehavior.formatHorzItem(internalHorzItemForFormatting);

		// --- 2. COORDINATE FIX: Get Interpolated Logical Index for Blank Space Plotting ---

		/*
		 * We must use the structural method to get a Logical Index that accounts for blank space.
		 * 
		 * We already have 'timeAsHorzScaleItem' (which is just the timestamp number).
		 * LWC's logicalToCoordinate requires a 'Logical' number which is correct if the index exists.
		 * 
		 * We rely on the utility function [interpolateLogicalIndexFromTime] (the only way to safely 
		 * get an interpolated logical position in blank space for now).
		*/

		// Convert the time to a Logical Index that solves the blank space problem.
		// We use the raw timestamp (which is part of the 'Time' union type expected by the geometry helper).
		const interpolatedLogicalIndex = interpolateLogicalIndexFromTime(
			this._chart,
			this._tool.getSeries(), // Pass ISeriesApi from the BaseLineTool
			timeAsHorzScaleItem as unknown as Time
		);

		if (interpolatedLogicalIndex === null) {
			console.warn(`[TimeLabelView] Skipping update: Time-to-Index Interpolation failed for timestamp ${point.timestamp}`);
			return;
		}

		// Convert the interpolated Logical Index into a Screen Coordinate.
		const coordinate = this._timeScale.logicalToCoordinate(interpolatedLogicalIndex as unknown as Logical);

		if (coordinate === null || !isFinite(coordinate)) {
			console.warn(`[TimeLabelView] Skipping update: Logical-to-Coordinate failed for index ${interpolatedLogicalIndex}`);
			return;
		}

		// Finalize data
		data.coordinate = coordinate as Coordinate;
		data.width = this._timeScale.width();
		data.visible = true;
	}
}