// /src/api/public-api.ts

/**
 * This file defines the public-facing API for the Lightweight Charts Line Tools Core plugin.
 * It specifies the interfaces and types that users will interact with, ensuring data structures
 * remain consistent with the original V3.8 line tools build for drop-in replacement compatibility.
 */

import { IChartApiBase, ISeriesApi, SeriesType } from 'lightweight-charts';
import { LineToolOptionsInternal, LineToolPartialOptionsMap, LineToolType } from '../types';

// #region Data Structures

/**
 * Represents a single anchor point for a line tool in logical space.
 *
 * This structure is the fundamental way of defining a tool's position. It is compatible
 * with the original V3.8 line tools build's data format.
 *
 * @property timestamp - The time component of the point, typically a UNIX timestamp in seconds (or a date string if the chart is configured for `BusinessDay`).
 * @property price - The price component of the point (a floating-point number).
 *
 * @example
 * const point: LineToolPoint = {
 *   timestamp: 1672531200, // January 1, 2023, 00:00:00 UTC
 *   price: 1500.50
 * };
 */
export interface LineToolPoint {
	timestamp: number;
	price: number;
}

/**
 * Represents the full serializable state of a line tool for export, import, or event payloads.
 *
 * This object is used to transfer the complete definition of a tool between the plugin's API
 * and a consumer's application (e.g., when saving tool state to a database). The structure
 * is designed for compatibility with the V3.8 line tools export format.
 *
 * @template T - The specific string identifier type of the line tool (e.g., `'TrendLine'`).
 * @property id - The unique identifier of the tool.
 * @property toolType - The specific type of the tool (must match a registered type).
 * @property points - The array of {@link LineToolPoint}s defining the tool's geometry.
 * @property options - The complete, current configuration object for the tool.
 *
 * @example
 * // Example structure returned by `exportLineTools()`
 * const exportedData: LineToolExport<'Rectangle'>[] = [{
 *   id: 'rect-a1b2c3d4',
 *   toolType: 'Rectangle',
 *   points: [{ timestamp: 1672531200, price: 100 }, { timestamp: 1672534800, price: 120 }],
 *   options: { ... } // Full configuration options
 * }];
 */
export interface LineToolExport<T extends LineToolType> {
	id: string;
	toolType: T;
	points: LineToolPoint[];
	options: LineToolOptionsInternal<T>;
}

// #endregion Data Structures


// #region Event Structures

/**
 * Defines the structured data payload passed to listeners when a double-click event occurs on a line tool.
 *
 * This structure is kept identical to the original V3.8 event output for drop-in compatibility.
 *
 * @property selectedLineTool - The full {@link LineToolExport} data of the tool that was double-clicked.
 */
export interface LineToolsDoubleClickEventParams {
	selectedLineTool: LineToolExport<LineToolType>;
}

/**
 * Defines the structured data payload passed to listeners after a line tool has been edited or created.
 *
 * This is a crucial event for applications that need to persist tool state immediately after user interaction.
 *
 * @property selectedLineTool - The full {@link LineToolExport} data of the tool after the modification is complete.
 * @property stage - A string indicating the context of the edit completion:
 * - `'lineToolEdited'`: A point was moved, or the entire tool was dragged.
 * - `'pathFinished'`: (Deprecated/Path-Tool-Specific) A path tool creation has finished.
 * - `'lineToolFinished'`: A fixed-point tool creation (e.g., TrendLine, Rectangle) has finished.
 */
export interface LineToolsAfterEditEventParams {
	selectedLineTool: LineToolExport<LineToolType>;
	stage: 'lineToolEdited' | 'pathFinished' | 'lineToolFinished';
}

/**
 * The function signature required for handlers subscribing to the double-click event.
 *
 * @param param - The event data containing the details of the double-clicked tool.
 */
export type LineToolsDoubleClickEventHandler = (param: LineToolsDoubleClickEventParams) => void;

/**
 * The function signature required for handlers subscribing to the after-edit event.
 *
 * This handler is essential for applications that need to save the final state of a tool
 * immediately after its creation or modification by the user.
 *
 * @param param - The event data containing the updated tool export and the stage of the edit.
 */
export type LineToolsAfterEditEventHandler = (param: LineToolsAfterEditEventParams) => void;

// #endregion Event Structures


// #region Main API Interface

/**
 * The public-facing interface for the Line Tools Core Plugin.
 *
 * This object serves as the main point of interaction for managing, querying, and configuring
 * drawing tools on a Lightweight Charts instance. All methods here are callable by the consumer
 * and are designed to be compatible with the API of the V3.8 line tools build.
 */
export interface ILineToolsApi {

	/**
	 * Programmatically adds a new line tool to the chart.
	 *
	 * If `points` is an empty array, `null`, or omitted, this method initiates the
	 * **interactive creation mode**, allowing the user to click on the chart to define the tool's points.
	 *
	 * @param type - The specific {@link LineToolType} to add (e.g., `'TrendLine'`).
	 * @param points - Optional. The initial {@link LineToolPoint}s for the tool. Pass `[]` to start interactive drawing.
	 * @param options - Optional. Partial configuration options to override the tool's defaults.
	 * @returns The unique ID string of the newly created line tool, or an empty string on error.
	 *
	 * @example
	 * // Start interactive drawing mode for a Rectangle
	 * plugin.addLineTool('Rectangle');
	 *
	 * @example
	 * // Add a horizontal line at a specific price immediately
	 * plugin.addLineTool('HorizontalLine', [
	 *   { timestamp: 1672531200, price: 150.50 }
	 * ]);
	 */
	addLineTool<T extends LineToolType>(type: T, points?: LineToolPoint[], options?: LineToolPartialOptionsMap[T]): string;

	/**
	 * Creates a new line tool with a specific ID, or updates the existing tool if the ID is found.
	 *
	 * This method is idempotent and is typically used for state management operations like imports,
	 * ensuring that data is synchronized reliably without user interaction.
	 *
	 * @param type - The {@link LineToolType} of the tool. Must match the existing tool's type if updating.
	 * @param points - The full array of {@link LineToolPoint}s to set for the tool.
	 * @param options - The partial configuration options to apply or merge.
	 * @param id - The unique ID of the tool to create or update.
	 * @returns void
	 */
	createOrUpdateLineTool<T extends LineToolType>(type: T, points: LineToolPoint[], options: LineToolPartialOptionsMap[T], id: string): void;

	/**
	 * Removes one or more line tools from the chart by their unique IDs.
	 *
	 * @param ids - An array of unique string IDs of the tools to remove.
	 * @returns void
	 */
	removeLineToolsById(ids: string[]): void;

	/**
	 * Removes all line tools whose IDs match a given regular expression pattern.
	 *
	 * @param regex - The regular expression (e.g., `^temp-`) to test against all current tool IDs.
	 * @returns void
	 *
	 * @example
	 * // Remove all tools whose ID starts with 'old-tool'
	 * plugin.removeLineToolsByIdRegex(/^old-tool/);
	 */
	removeLineToolsByIdRegex(regex: RegExp): void;

	/**
	 * Removes the currently selected line tool(s) from the chart.
	 *
	 * This utility method is useful for implementing quick user interactions, such as binding
	 * the deletion of selected tools to the 'Delete' key.
	 *
	 * @returns void
	 */
	removeSelectedLineTools(): void;

	/**
	 * Removes every single line tool managed by this plugin instance from the chart.
	 *
	 * This performs a complete cleanup and resource release for all drawing primitives.
	 *
	 * @returns void
	 */
	removeAllLineTools(): void;

	/**
	 * Retrieves the full export data for all line tools currently marked as selected.
	 *
	 * @returns A JSON string representing an array of {@link LineToolExport} data. Returns `[]` if no tools are selected.
	 *
	 * @remarks
	 * The returned JSON string must be parsed (e.g., `JSON.parse(result)`) to access the tool data.
	 */
	getSelectedLineTools(): string;

	/**
	 * Retrieves the full export data for a single line tool identified by its unique ID.
	 *
	 * @param id - The unique identifier of the tool.
	 * @returns A JSON string representing an array with the single {@link LineToolExport} data, or an empty array `[]` if the ID is not found.
	 *
	 * @remarks
	 * The return value is a JSON string containing an array (even for a single result) for consistency with the V3.8 API.
	 */
	getLineToolByID(id: string): string;

	/**
	 * Retrieves the full export data for a collection of line tools whose IDs match a given regular expression.
	 *
	 * @param regex - The regular expression to test against all tool IDs.
	 * @returns A JSON string representing an array of matching {@link LineToolExport} data.
	 */
	getLineToolsByIdRegex(regex: RegExp): string;

	/**
	 * Applies new points and/or partial options to an existing line tool defined by its ID.
	 *
	 * This is the primary method for modifying a tool's visual style or location programmatically
	 * *after* it has been created.
	 *
	 * @param toolData - An object containing the tool's ID, type, and the partial options/points to apply.
	 * @returns `true` if the tool was found and successfully updated, otherwise `false`.
	 */
	applyLineToolOptions<T extends LineToolType>(toolData: LineToolExport<T>): boolean;

	/**
	 * Serializes the complete state of all currently drawn line tools into a JSON string.
	 *
	 * This function is essential for state persistence (e.g., saving tools to local storage or a database)
	 * as the returned format is fully compatible with {@link importLineTools}.
	 *
	 * @returns A JSON string representing an array of all {@link LineToolExport} data.
	 *
	 * @example
	 * const state = plugin.exportLineTools();
	 * localStorage.setItem('chartToolsState', state);
	 */
	exportLineTools(): string;

	/**
	 * Imports a collection of line tools from a JSON string, typically a payload from {@link exportLineTools}.
	 *
	 * The import logic is non-destructive: it uses {@link createOrUpdateLineTool} to update existing tools
	 * with matching IDs and create new ones for non-existent IDs.
	 *
	 * @param json - A JSON string containing an array of {@link LineToolExport} data.
	 * @returns `true` if the JSON was valid and the import process was initiated, `false` otherwise.
	 */
	importLineTools(json: string): boolean;

	/**
	 * Subscribes a handler function to the event that fires when a line tool is double-clicked.
	 *
	 * @param handler - The callback function to execute. It receives a {@link LineToolsDoubleClickEventParams} object.
	 * @returns void
	 */
	subscribeLineToolsDoubleClick(handler: LineToolsDoubleClickEventHandler): void;

	/**
	 * Unsubscribes a handler function from the double-click event.
	 *
	 * @param handler - The previously subscribed handler function.
	 * @returns void
	 */
	unsubscribeLineToolsDoubleClick(handler: LineToolsDoubleClickEventHandler): void;

	/**
	 * Subscribes a handler function to the event that fires after a line tool is created or edited by the user.
	 *
	 * This is the critical event for persisting user-drawn changes.
	 *
	 * @param handler - The callback function to execute. It receives a {@link LineToolsAfterEditEventParams} object.
	 * @returns void
	 */
	subscribeLineToolsAfterEdit(handler: LineToolsAfterEditEventHandler): void;

	/**
	 * Unsubscribes a handler function from the after-edit event.
	 *
	 * @param handler - The previously subscribed handler function.
	 * @returns void
	 */
	unsubscribeLineToolsAfterEdit(handler: LineToolsAfterEditEventHandler): void;
	
	/**
	 * Programmatically positions the chart's crosshair at a specific screen pixel coordinate.
	 *
	 * The plugin handles the conversion of the `(x, y)` pixel coordinate into the correct logical time and price values
	 * required by the chart's internal API.
	 *
	 * @param x - The x-coordinate (in pixels) relative to the chart's canvas.
	 * @param y - The y-coordinate (in pixels) relative to the chart's canvas.
	 * @param visible - Controls visibility. If `false`, the crosshair is cleared regardless of `x` and `y`.
	 * @returns void
	 */
    setCrossHairXY(x: number, y: number, visible: boolean): void;

	/**
	 * Clears the crosshair position, making it invisible.
	 *
	 * This is a direct wrapper around `chart.clearCrosshairPosition()`.
	 *
	 * @returns void
	 */
    clearCrossHair(): void;

}

// #endregion Main Plugin Interface


// #region Factory Type

/**
 * Defines the function signature for the primary plugin factory used to initialize the core logic.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item (e.g., `Time`, `UTCTimestamp`).
 * @param chart - The Lightweight Charts chart API instance.
 * @param series - The primary series API instance to which tools will be attached.
 * @returns The {@link ILineToolsApi} interface for tool management.
 */
export type LineToolsPluginFactory = <HorzScaleItem>(
	chart: IChartApiBase<HorzScaleItem>,
	series: ISeriesApi<SeriesType, HorzScaleItem>
) => ILineToolsApi;


// #endregion Factory Type