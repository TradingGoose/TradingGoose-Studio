// /src/core-plugin.ts

import { IChartApiBase, ISeriesApi, SeriesType, IHorzScaleBehavior, IPaneApi, Coordinate, Time, BusinessDay, UTCTimestamp } from 'lightweight-charts';
import {
	ILineToolsApi,
	LineToolExport,
	LineToolPoint,
	LineToolsAfterEditEventHandler,
	LineToolsDoubleClickEventHandler,
	LineToolsDoubleClickEventParams,
	LineToolsAfterEditEventParams
} from './api/public-api';
import { Delegate } from './utils/helpers';
import { LineToolPartialOptionsMap, LineToolType, IChartWidgetBase } from './types';
import { BaseLineTool } from './model/base-line-tool';
import { ToolRegistry } from './model/tool-registry';
import { InteractionManager } from './interaction/interaction-manager';
import { Point } from './utils/geometry';
import { PriceAxisLabelStackingManager } from './model/price-axis-label-stacking-manager';

/**
 * The main implementation of the Line Tools Core Plugin.
 *
 * This class acts as the central controller for adding, managing, and interacting with line tools
 * on a Lightweight Chart. It coordinates between the chart's API, the series, and the internal
 * interaction manager to handle user input, rendering, and state management of drawing tools.
 *
 * While typically initialized via the `createLineToolsPlugin` factory, this class implements
 * the {@link ILineToolsApi} interface which defines the primary methods available to consumers.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item (e.g., `Time`, `UTCTimestamp`, or `number`), matching the chart's configuration.
 */
export class LineToolsCorePlugin<HorzScaleItem> implements ILineToolsApi {
	private readonly _chart: IChartApiBase<HorzScaleItem>;
	private readonly _series: ISeriesApi<SeriesType, HorzScaleItem>;
	private readonly _horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>;

	private _tools: Map<string, BaseLineTool<HorzScaleItem>> = new Map();
	private readonly _toolRegistry: ToolRegistry<HorzScaleItem>;
	private readonly _interactionManager: InteractionManager<HorzScaleItem>;
	private readonly _priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>;

	// Delegates for broadcasting V3.8-compatible events
	private readonly _doubleClickDelegate = new Delegate<LineToolsDoubleClickEventParams>();
	private readonly _afterEditDelegate = new Delegate<LineToolsAfterEditEventParams>();

	// Throttled Stacking Update
	private _stackingUpdateScheduled: boolean = false;

	public constructor(
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
		horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
	) {
		this._chart = chart;
		this._series = series;
		this._horzScaleBehavior = horzScaleBehavior;
		this._toolRegistry = new ToolRegistry<HorzScaleItem>();
		this._interactionManager = new InteractionManager<HorzScaleItem>(this, this._chart, this._series, this._tools, this._toolRegistry);
		this._priceAxisLabelStackingManager = new PriceAxisLabelStackingManager<HorzScaleItem>(this._chart, this._series);

		console.log('Line Tools Core Plugin initialized.');
	}

	/**
	 * Requests a redraw of the chart.
	 *
	 * This method is the primary mechanism for internal components (like the {@link InteractionManager} or individual tools)
	 * to trigger a render cycle after state changes (e.g., hovering, selecting, or modifying a tool).
	 * It effectively calls `chart.applyOptions({})` to signal that the primitives need repainting.
	 *
	 * @internal
	 * @returns void
	 */
	public requestUpdate(): void {
		// Applying empty options is a lightweight way to tell the chart
		// that something has changed and it needs to re-render.
		this._chart.applyOptions({});

		// Centralized control now relies on the BaseLineTool to call the
		// Stacking Manager at the right time. The Core Plugin should no longer manage
		// the throttle here to avoid the premature call.
	}	

	/**
	 * Registers a custom line tool class with the plugin.
	 *
	 * Before a specific tool type (e.g., 'Rectangle', 'FibRetracement') can be created via
	 * {@link addLineTool} or {@link importLineTools}, its class constructor must be registered here.
	 * This maps a string identifier to the actual class implementation.
	 *
	 * @param type - The unique string identifier for the tool type (e.g., 'Rectangle').
	 * @param toolClass - The class constructor for the tool, which must extend {@link BaseLineTool}.
	 * @returns void
	 *
	 * @example
	 * import { LineToolRectangle } from './my-tools/rectangle';
	 * plugin.registerLineTool('Rectangle', LineToolRectangle);
	 */
	public registerLineTool(type: LineToolType, toolClass: new (...args: any[]) => BaseLineTool<HorzScaleItem>): void {
		this._toolRegistry.registerTool(type, toolClass);
		console.log(`Registered line tool: ${type}`);
	}

	// #region ILineToolsApi Implementation


	/**
	 * Adds a new line tool to the chart.
	 *
	 * If `points` is provided, the tool is drawn immediately at those coordinates.
	 * If `points` is an empty array, `null`, or undefined, the plugin enters
	 * **interactive creation mode**, allowing the user to click on the chart to draw the tool.
	 *
	 * @param type - The type of line tool to create (e.g., 'TrendLine', 'Rectangle').
	 * @param points - An array of logical points (timestamp/price) to define the tool. Pass `[]` to start interactive drawing.
	 * @param options - Optional configuration object to customize the tool's appearance (line color, width, etc.).
	 * @returns The unique string ID of the newly created tool.
	 *
	 * @example
	 * // Start drawing a Trend Line interactively (user clicks to place points)
	 * plugin.addLineTool('TrendLine');
	 *
	 * @example
	 * // Programmatically add a Rectangle at specific coordinates
	 * plugin.addLineTool('Rectangle', [
	 *   { timestamp: 1620000000, price: 100 },
	 *   { timestamp: 1620086400, price: 120 }
	 * ], {
	 *   line: { color: '#ff0000', width: 2 },
	 *   background: { color: 'rgba(255, 0, 0, 0.2)' }
	 * });
	 */
	public addLineTool<T extends LineToolType>(type: T, points?: LineToolPoint[] | null, options?: LineToolPartialOptionsMap[T] | undefined): string {
		try {
			// Check if points are provided and signal interactive creation if they are empty
			const initiateInteractive = (points === null || points === undefined || points.length === 0);
			const tool = this._createAndAddTool(type, points || [], options, undefined, initiateInteractive);
			return tool.id();
		} catch (e: any) {
			console.error(e.message);
			return '';
		}
	}

	/**
	 * Creates a new line tool with a specific ID, or updates it if that ID already exists.
	 *
	 * Unlike `addLineTool`, this method requires a specific ID. It is primarily used for
	 * state synchronization (e.g., `importLineTools`) where preserving the original tool ID is critical.
	 *
	 * @param type - The type of the line tool.
	 * @param points - The points defining the tool.
	 * @param options - The configuration options.
	 * @param id - The unique ID to assign to the tool (or the ID of the tool to update).
	 * @returns void
	 */
	public createOrUpdateLineTool<T extends LineToolType>(type: T, points: LineToolPoint[], options: LineToolPartialOptionsMap[T], id: string): void {
		const existingTool = this._tools.get(id);
		if (existingTool) {
			// Update existing tool
			existingTool.setPoints(points);
			existingTool.applyOptions(options);
			console.log(`Updated line tool with ID: ${id}`);
		} else {
			// Create new tool with specified ID
			try {
				this._createAndAddTool(type, points, options, id);
			} catch (e: any) {
				console.error(e.message);
			}
		}
	}

	/**
	 * Removes one or more line tools from the chart based on their unique IDs.
	 *
	 * @param ids - An array of unique string IDs representing the tools to remove.
	 * @returns void
	 *
	 * @example
	 * plugin.removeLineToolsById(['tool-id-1', 'tool-id-2']);
	 */
	public removeLineToolsById(ids: string[]): void {
		console.log(`[CorePlugin] Removing tools. Current tool count: ${this._tools.size}`);
		let needsUpdate = false;
		ids.forEach(id => {
			const tool = this._tools.get(id);
			if (tool) {
				this._interactionManager.detachTool(tool); // DETACH FROM LWCHARTS FIRST
				tool.destroy(); // Then call our plugin's internal cleanup
				this._tools.delete(id); // Then remove from plugin's map
				needsUpdate = true;
				console.log(`Removed line tool with ID: ${id}`);
			}
		});
		if (needsUpdate) {
			this._chart.applyOptions({}); // Trigger a chart update
		}
	}

	/**
	 * Removes all line tools whose IDs match the provided Regular Expression.
	 *
	 * This allows for bulk deletion of tools based on naming patterns (e.g., removing all tools tagged with 'temp-').
	 *
	 * @param regex - The Regular Expression to match against tool IDs.
	 * @returns void
	 *
	 * @example
	 * // Remove all tools starting with "drawing-"
	 * plugin.removeLineToolsByIdRegex(/^drawing-/);
	 */
	public removeLineToolsByIdRegex(regex: RegExp): void {
		const idsToRemove: string[] = [];
		this._tools.forEach(tool => {
			if (regex.test(tool.id())) {
				idsToRemove.push(tool.id());
			}
		});
		if (idsToRemove.length > 0) {
			this.removeLineToolsById(idsToRemove);
		}
	}

	/**
	 * Removes the currently selected line tool(s) from the chart.
	 *
	 * This is typically wired to a keyboard shortcut (like the Delete key) or a UI button
	 * to allow users to delete the specific tool they are interacting with.
	 *
	 * @returns void
	 */
	public removeSelectedLineTools(): void {
		const selectedIds: string[] = [];
		this._tools.forEach(tool => {
			if (tool.isSelected()) {
				selectedIds.push(tool.id());
			}
		});
		if (selectedIds.length > 0) {
			this.removeLineToolsById(selectedIds);
		}
	}

	/**
	 * Removes all line tools managed by this plugin from the chart.
	 *
	 * This performs a full cleanup, detaching every tool from the chart's series and
	 * releasing associated resources.
	 *
	 * @returns void
	 */
	public removeAllLineTools(): void {
		const allIds = Array.from(this._tools.keys());
		if (allIds.length > 0) {
			this.removeLineToolsById(allIds);
		}
		console.log(`[CorePlugin] All tools removed. Final total tool count: ${this._tools.size}`);
	}

	/**
	 * Retrieves the data for all line tools that are currently selected by the user.
	 *
	 * @returns A JSON string representing an array of the selected tools' data.
	 *
	 * @example
	 * const selected = JSON.parse(plugin.getSelectedLineTools());
	 * console.log(`User has selected ${selected.length} tools.`);
	 */
	public getSelectedLineTools(): string {
		const selectedTools: LineToolExport<LineToolType>[] = [];
		this._tools.forEach(tool => {
			if (tool.isSelected()) {
				selectedTools.push(tool.getExportData());
			}
		});
		return JSON.stringify(selectedTools);
	}

	/**
	 * Retrieves the data for a specific line tool by its unique ID.
	 *
	 * @param id - The unique identifier of the tool to retrieve.
	 * @returns A JSON string representing an array containing the single tool's data, or an empty array `[]` if the ID was not found.
	 *
	 * @remarks
	 * The return type is a JSON string to maintain compatibility with the V3.8 API structure.
	 * You will typically need to `JSON.parse()` the result to work with the data programmatically.
	 */
	public getLineToolByID(id: string): string {
		const tool = this._tools.get(id);
		return tool ? JSON.stringify([tool.getExportData()]) : JSON.stringify([]);
	}

	/**
	 * Retrieves a list of line tools whose IDs match a specific Regular Expression.
	 *
	 * This is useful for grouping tools by naming convention (e.g., fetching all tools with IDs starting with 'trend-').
	 *
	 * @param regex - The Regular Expression to match against tool IDs.
	 * @returns A JSON string representing an array of all matching line tools.
	 *
	 * @example
	 * // Get all tools with IDs starting with "fib-"
	 * const tools = plugin.getLineToolsByIdRegex(/^fib-/);
	 */
	public getLineToolsByIdRegex(regex: RegExp): string {
		const matchingTools: LineToolExport<LineToolType>[] = [];
		this._tools.forEach(tool => {
			if (regex.test(tool.id())) {
				matchingTools.push(tool.getExportData());
			}
		});
		return JSON.stringify(matchingTools);
	}

	/**
	 * Applies new configuration options or points to an existing line tool.
	 *
	 * This method is used to dynamically update a tool's appearance or position after it
	 * has been created. It performs a partial merge, so you only need to provide the properties
	 * you wish to change.
	 *
	 * Note: If the tool is currently selected, it will be deselected upon update to ensure visual consistency.
	 *
	 * @param toolData - An object containing the tool's `id`, `toolType`, and the `options` or `points` to update.
	 * @returns `true` if the tool was found and updated, `false` otherwise (e.g., ID not found or type mismatch).
	 *
	 * @example
	 * // Change the color of an existing tool to blue
	 * plugin.applyLineToolOptions({
	 *   id: 'existing-tool-id',
	 *   toolType: 'TrendLine',
	 *   options: {
	 *     line: { color: 'blue' }
	 *   },
	 *   points: [] // Points can be omitted if not changing
	 * });
	 */
	public applyLineToolOptions<T extends LineToolType>(toolData: LineToolExport<T>): boolean {
		const tool = this._tools.get(toolData.id);
		if (!tool || tool.toolType !== toolData.toolType) {
			console.error(`Cannot apply options: Tool with ID "${toolData.id}" not found or type mismatch.`);
			return false;
		}

		// Behavioral change: Deselect the tool after applying options, matching V3.8
		if (tool.isSelected()) {
			tool.setSelected(false);
		}

		if (toolData.options) {
			tool.applyOptions(toolData.options);
		}
		if (toolData.points) {
			tool.setPoints(toolData.points);
		}
 
		this._chart.applyOptions({}); // Trigger update
		return true;
	}

	/**
	 * Serializes the state of all currently drawn line tools into a JSON string.
	 *
	 * This export format is compatible with `importLineTools` and the V3.8 line tools plugin,
	 * making it suitable for saving chart state to a database or local storage.
	 *
	 * @returns A JSON string representing an array of all line tools and their current state.
	 *
	 * @example
	 * const savedState = plugin.exportLineTools();
	 * localStorage.setItem('my-chart-tools', savedState);
	 */
	public exportLineTools(): string {
		const allToolsData = Array.from(this._tools.values()).map(tool => tool.getExportData());
		console.log('Exporting all line tools:', allToolsData);
		return JSON.stringify(allToolsData);
	}

	/**
	 * Imports a set of line tools from a JSON string.
	 *
	 * This method parses the provided JSON (typically generated by {@link exportLineTools}) and
	 * creates or updates the tools on the chart.
	 *
	 * **Note:** This is a non-destructive import. It will not remove existing tools unless
	 * the imported data overwrites them by ID. It creates new tools if the IDs do not exist
	 * and updates existing ones if they do.
	 *
	 * @param json - A JSON string containing an array of line tool export data.
	 * @returns `true` if the import process completed successfully, `false` if the JSON was invalid.
	 */
	public importLineTools(json: string): boolean {
		// Behavioral change: Do NOT removeAll() first, just use createOrUpdate
		// Ensure it's synchronous and returns boolean
		try {
			const parsedTools = JSON.parse(json);
			if (!Array.isArray(parsedTools)) {
				throw new Error('Import data is not a valid array of line tools.');
			}
			parsedTools.forEach((toolData: LineToolExport<LineToolType>) => {
				// Use createOrUpdateLineTool to handle updating existing or creating new
				this.createOrUpdateLineTool(toolData.toolType, toolData.points, toolData.options, toolData.id);
			});
			console.log(`Imported ${parsedTools.length} line tools.`);
			this.requestUpdate(); // Trigger a single update after all imports
			return true;
		} catch (e: any) {
			console.error('Failed to import line tools:', e.message);
			return false;
		}
	}

	/**
	 * Subscribes a callback function to the "Double Click" event.
	 *
	 * This event fires whenever a user double-clicks on an existing line tool.
	 * It is often used to open custom settings modals or perform specific actions on the tool.
	 *
	 * @param handler - The function to execute when the event fires. Receives {@link LineToolsDoubleClickEventParams}.
	 * @returns void
	 */
	public subscribeLineToolsDoubleClick(handler: LineToolsDoubleClickEventHandler): void {
		this._doubleClickDelegate.subscribe(handler);
	}

	/**
	 * Unsubscribes a previously registered callback from the "Double Click" event.
	 *
	 * @param handler - The specific callback function that was passed to {@link subscribeLineToolsDoubleClick}.
	 * @returns void
	 */
	public unsubscribeLineToolsDoubleClick(handler: LineToolsDoubleClickEventHandler): void {
		this._doubleClickDelegate.unsubscribe(handler);
	}

	/**
	 * Subscribes a callback function to the "After Edit" event.
	 *
	 * This event fires whenever a line tool is:
	 * 1. Modified (points moved or properties changed).
	 * 2. Finished creating (the final point was placed).
	 *
	 * @param handler - The function to execute when the event fires. Receives {@link LineToolsAfterEditEventParams}.
	 * @returns void
	 *
	 * @example
	 * plugin.subscribeLineToolsAfterEdit((params) => {
	 *   console.log('Tool edited:', params.selectedLineTool.id);
	 *   console.log('Edit stage:', params.stage);
	 * });
	 */
	public subscribeLineToolsAfterEdit(handler: LineToolsAfterEditEventHandler): void {
		this._afterEditDelegate.subscribe(handler);
	}

	/**
	 * Unsubscribes a previously registered callback from the "After Edit" event.
	 *
	 * Use this to stop listening for tool creation or modification events, typically during
	 * component cleanup or when the chart is being destroyed.
	 *
	 * @param handler - The specific callback function that was passed to {@link subscribeLineToolsAfterEdit}.
	 * @returns void
	 */
	public unsubscribeLineToolsAfterEdit(handler: LineToolsAfterEditEventHandler): void {
		this._afterEditDelegate.unsubscribe(handler);
	}



	/**
	 * Sets the crosshair position to a specific pixel coordinate (x, y) on the chart.
	 *
	 * This method acts as a high-level proxy for the Lightweight Charts API. It converts the
	 * provided screen pixel coordinates into the logical time and price values required by the chart
	 * to position the crosshair.
	 *
	 * @param x - The x-coordinate (in pixels) relative to the chart's canvas.
	 * @param y - The y-coordinate (in pixels) relative to the chart's canvas.
	 * @param visible - Controls the visibility of the crosshair. If `false`, the crosshair is cleared.
	 * @returns void
	 */
	public setCrossHairXY(x: number, y: number, visible: boolean): void {
		if (!visible) {
		this.clearCrossHair();
		return;
		}

		const chart = this._chart;
		const mainSeries = this._series;

		// Use the robust screenPointToLineToolPoint from InteractionManager
		// to get an interpolated time and price from the screen coordinates.
		const lineToolPoint = this._interactionManager.screenPointToLineToolPoint(new Point(x as Coordinate, y as Coordinate));

		if (lineToolPoint) {

			// Cast lineToolPoint.timestamp directly to HorzScaleItem.
			// This tells TypeScript that we know lineToolPoint.timestamp (a number) 
			// is compatible with the HorzScaleItem type expected by the current chart setup.
			const horizontalPosition: HorzScaleItem = lineToolPoint.timestamp as unknown as HorzScaleItem;
			const priceValue: number = lineToolPoint.price;

			chart.setCrosshairPosition(
				priceValue, 
				horizontalPosition, 
				mainSeries as ISeriesApi<SeriesType, HorzScaleItem> 
			);
		} else {
			// If conversion fails (e.g., coordinates are out of valid range or interpolation not possible), clear the crosshair
			this.clearCrossHair();
		}
	}

    /**
	 * Clears the chart's crosshair, making it invisible.
	 *
	 * This acts as a proxy for the underlying Lightweight Charts API `clearCrosshairPosition()`.
	 * Use this to programmatically hide the crosshair (e.g., when the mouse leaves a custom container).
	 *
	 * @returns void
	 */
    public clearCrossHair(): void {
        this._chart.clearCrosshairPosition();
    }

	// #endregion

	/**
	 * Broadcasts an event indicating that a line tool has been double-clicked.
	 *
	 * This method is called internally by the {@link InteractionManager} upon detecting a double-click
	 * interaction on a tool. It triggers listeners subscribed via {@link subscribeLineToolsDoubleClick}.
	 *
	 * @internal
	 * @param tool - The tool instance that was double-clicked.
	 * @returns void
	 */
	public fireDoubleClickEvent(tool: BaseLineTool<HorzScaleItem>): void {
		console.log(`[CorePlugin] Firing DoubleClick event for tool: ${tool.id()}`);
		const eventParams: LineToolsDoubleClickEventParams = {
			selectedLineTool: tool.getExportData(),
		};
		this._doubleClickDelegate.fire(eventParams);
	}

	/**
	 * Broadcasts an event indicating that a line tool has been modified or created.
	 *
	 * This method is primarily called internally by the {@link InteractionManager} when a user
	 * finishes drawing or editing a tool. It triggers any listeners subscribed via
	 * {@link subscribeLineToolsAfterEdit}.
	 *
	 * @internal
	 * @param tool - The tool instance that was edited.
	 * @param stage - The stage of the edit action (e.g., 'lineToolEdited' for modification, 'lineToolFinished' for creation).
	 * @returns void
	 */
	public fireAfterEditEvent(tool: BaseLineTool<HorzScaleItem>, stage: 'lineToolEdited' | 'pathFinished' | 'lineToolFinished'): void {
		console.log(`[CorePlugin] Firing AfterEdit event for tool: ${tool.id()} with stage: ${stage}`);
		const eventParams: LineToolsAfterEditEventParams = {
			selectedLineTool: tool.getExportData(),
			stage: stage,
		};
		this._afterEditDelegate.fire(eventParams);
	}

	/**
	 * Internal factory method to instantiate and register a new tool.
	 *
	 * This handles the common logic for `addLineTool`, `createOrUpdateLineTool`, and `importLineTools`,
	 * including checking the registry, creating the instance, attaching it to the series, and
	 * managing interactive state if required.
	 *
	 * @param type - The tool type identifier.
	 * @param points - The initial points for the tool.
	 * @param options - Optional configuration options.
	 * @param id - Optional specific ID (if not provided, the tool generates its own).
	 * @param initiateInteractive - If `true`, sets the tool to "Creating" mode and updates the InteractionManager.
	 * @returns The newly created `BaseLineTool` instance.
	 * @throws Error if the tool type is not registered.
	 * @private
	 */
	private _createAndAddTool<T extends LineToolType>(
		type: T,
		points: LineToolPoint[],
		options?: LineToolPartialOptionsMap[T],
		id?: string,
		initiateInteractive: boolean = false // New parameter to signal interactive drawing initiation
	): BaseLineTool<HorzScaleItem> {
		if (!this._toolRegistry.isRegistered(type)) {
			throw new Error(`Cannot create tool: Line tool type "${type}" is not registered.`);
		}

		if (initiateInteractive) {
            this._interactionManager.deselectAllTools();
        }

		const ToolClass = this._toolRegistry.getToolClass(type);

		const newTool = new ToolClass(
			this,
			this._chart,
			this._series,
			this._horzScaleBehavior,
			options,
			points,
			this._priceAxisLabelStackingManager,
		);

		if (id) {
			newTool.setId(id);
		}

		this._tools.set(newTool.id(), newTool);
		this._series.attachPrimitive(newTool);

		// NEW LOGIC for addLineTool's interactive initiation
		if (initiateInteractive) {
			newTool.setCreating(true); // Mark the tool as actively being created
			this._interactionManager.setCurrentToolCreating(newTool); // Set THIS tool as the target for interactive drawing
		}

		this._chart.applyOptions({}); // Trigger a chart update to render the new tool
		console.log(`Created or updated line tool: ${type} with ID: ${newTool.id()}`);
		return newTool;
	}

	/**
	 * Retrieves the instance of the Price Axis Label Stacking Manager.
	 *
	 * This manager is responsible for preventing overlap between the price labels of different tools
	 * on the Y-axis. This accessor is primarily used internally by {@link BaseLineTool} to register its labels.
	 *
	 * @internal
	 * @returns The shared {@link PriceAxisLabelStackingManager} instance.
	 */
	public getPriceAxisLabelStackingManager(): PriceAxisLabelStackingManager<HorzScaleItem> {
		return this._priceAxisLabelStackingManager;
	}


}