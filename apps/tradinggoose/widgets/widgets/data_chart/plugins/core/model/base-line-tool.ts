// /src/model/base-line-tool.ts

/**
 * This file defines the abstract BaseLineTool class.
 * It serves as the foundation for all individual line drawing tools, encapsulating common
 * properties, state management, and essential methods for coordinate conversion and interaction.
 *
 * It implements the `ISeriesPrimitive` interface, making any of its subclasses a valid
 * plugin for a Lightweight Charts series. Its primary role is to abstract away the
 * complexities of the v5 plugin system, providing a consistent and simpler API for
 * individual tool implementations.
 */
import {
	IChartApiBase,
	ISeriesApi,
	ISeriesPrimitive,
	SeriesAttachedParameter,
	SeriesType,
	Coordinate,
	PrimitiveHoveredItem,
	IHorzScaleBehavior,
	Logical,
	IPaneApi,
	UTCTimestamp,
	Time,
	ISeriesPrimitiveAxisView
} from 'lightweight-charts';

import { LineToolExport, LineToolPoint } from '../api/public-api';
import { merge, randomHash, DeepPartial, deepCopy } from '../utils/helpers';
import { 
	LineToolOptionsInternal,
	LineToolType,
	HitTestResult,
	HitTestType,
	IPaneView,
	IUpdatablePaneView,
	TimePointIndex,
	FirstValue,
	IPriceFormatter,
	AutoscaleInfoImpl,
	AutoscaleInfo,
	IPriceAxisView,
	ITimeAxisView,
	PaneCursorType,
	InteractionPhase,
	ConstraintResult,
	SnapAxis,
	FinalizationMethod,
	LineToolCullingInfo,
} from '../types';
import { Point, interpolateTimeFromLogicalIndex, interpolateLogicalIndexFromTime   } from '../utils/geometry';
import { LineToolsCorePlugin } from '../core-plugin';
import { PriceDataSource } from './price-data-source';
// Imports for the LineTool specific axis views
import { LineToolPriceAxisLabelView } from '../views/line-tool-price-axis-label-view';
import { LineToolTimeAxisLabelView } from '../views/line-tool-time-axis-label-view';
import { PriceAxisLabelStackingManager } from './price-axis-label-stacking-manager';


/**
 * The abstract base class for all line drawing tools in the plugin.
 *
 * This class extends {@link PriceDataSource} and implements the Lightweight Charts `ISeriesPrimitive`
 * interface. It provides a common set of properties, utility methods for coordinate conversion,
 * state management (selection, hover, editing), and hooks for custom behavior (hit-testing, constraints).
 * All custom line tool implementations must extend this class.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item (e.g., `Time` or `number`).
 */
export abstract class BaseLineTool<HorzScaleItem> extends PriceDataSource<HorzScaleItem> implements ISeriesPrimitive<HorzScaleItem> {
	// Abstract properties that must be defined by child classes
	// These properties are now set in the constructor from subclass arguments

	/**
	 * The unique string identifier for this specific tool's type (e.g., 'TrendLine', 'Rectangle').
	 * This is defined by the concrete implementation class.
	 * @readonly
	 */
	public readonly toolType: LineToolType;

	/**
	 * The fixed number of logical points this tool requires.
	 *
	 * - A positive number (e.g., `2` for a TrendLine) means the tool is *bounded*.
	 * - A value of `-1` (e.g., for Brush, Path) means the tool is *unbounded* and can have a variable number of points.
	 * @readonly
	 */
	public readonly pointsCount: number;

	// Storage for axis view instances
	protected _priceAxisLabelViews: IPriceAxisView[] = [];
	protected _timeAxisLabelViews: ITimeAxisView[] = [];

	/**
	 * Reference to the manager responsible for resolving price axis label collisions.
	 * Used to ensure this tool's price labels do not overlap others.
	 * @protected
	 */
	protected _priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>;

	/**
	 * Abstract method for the tool's core hit-testing logic.
	 *
	 * Concrete subclasses must implement this to define the precise geometric area of the tool
	 * (lines, backgrounds, anchors) and return a {@link HitTestResult} if the coordinates are inside.
	 *
	 * @param x - The X coordinate of the mouse pointer (in pixels).
	 * @param y - The Y coordinate of the mouse pointer (in pixels).
	 * @returns A {@link HitTestResult} containing hit type and index data, or `null`.
	 * @internal
	 */
	public abstract _internalHitTest(x: Coordinate, y: Coordinate): HitTestResult<any> | null;

	/**
	 * Provides an array of price axis view components to Lightweight Charts for rendering the tool's labels.
	 *
	 * This implementation wraps the internal `_priceAxisLabelViews` array.
	 *
	 * @returns A readonly array of {@link IPriceAxisView} components.
	 */
	public priceAxisViews(): readonly IPriceAxisView[] { // Correct return type for DataSource
		// Defensive check: Do not return views if the tool is already marked for destruction
		if (this._isDestroying) return []; 

		const views: IPriceAxisView[] = [...this._priceAxisLabelViews];
		return views;
	}

	/**
	 * Provides an array of time axis view components to Lightweight Charts for rendering the tool's labels.
	 *
	 * This implementation wraps the internal `_timeAxisLabelViews` array.
	 *
	 * @returns A readonly array of {@link ITimeAxisView} components.
	 */
	public timeAxisViews(): readonly ITimeAxisView[] { // Correct return type for DataSource
		// Defensive check: Do not return views if the tool is already marked for destruction
		if (this._isDestroying) return []; 

		const views: ITimeAxisView[] = [...this._timeAxisLabelViews];
		return views;
	}

	private _overrideCursor: PaneCursorType | null = null;

	/**
	 * Temporarily overrides the cursor style displayed over the chart pane, bypassing normal hover detection.
	 *
	 * This is typically used by the {@link InteractionManager} during an active drag or edit gesture
	 * to ensure the cursor stays consistent (e.g., `grabbing`) regardless of where the mouse moves.
	 *
	 * @param cursor - The {@link PaneCursorType} to enforce, or `null` to revert to default behavior.
	 */
	public setOverrideCursor(cursor: PaneCursorType | null): void {
		this._overrideCursor = cursor;
	}

	/**
	 * The public hit-test method required by the Lightweight Charts `ISeriesPrimitive` interface.
	 *
	 * This method acts as an adapter, calling `_internalHitTest` and converting its internal
	 * result (`HitTestResult`) into the required LWC `PrimitiveHoveredItem` format, including
	 * cursor determination and Z-order.
	 *
	 * @param x - The X coordinate from Lightweight Charts (in pixels).
	 * @param y - The Y coordinate from Lightweight Charts (in pixels).
	 * @returns A `PrimitiveHoveredItem` if the tool is hit, otherwise `null`.
	 */
	public hitTest(x: number, y: number): PrimitiveHoveredItem | null {

		//console.log(`[BaseLineTool] Public hitTest called at X:${x}, Y:${y}`);

		// Check for override first
		// If an override is set (e.g., during dragging), return it immediately
		// and bypass the renderer's geometric checks for cursor style.
		if (this._overrideCursor) {
			return {
				externalId: this.id(),
				zOrder: 'normal',
				cursorStyle: this._overrideCursor,
			};
		}


		if (!this.options().editable) {
			// Even if there's no actual "hit" data, we can still suggest a cursor
			// to the chart if the mouse is over the tool's general area.
			// To do this, we need to perform a minimal hit check first.
			const ourX = x as Coordinate;
			const ourY = y as Coordinate;
			const internalResult = this._internalHitTest(ourX, ourY);

			if (internalResult !== null) {
				//console.log(`[BaseLineTool] Tool is not editable. Forcing cursor to 'not-allowed'.`);
				return {
					externalId: this.id(),
					zOrder: 'normal',
					cursorStyle: this.options().notEditableCursor || PaneCursorType.NotAllowed,
				};
			}
			return null; // No hit on non-editable tool
		}

		// Convert LWChart's number coordinates to our plugin's nominal Coordinate type
		const ourX = x as Coordinate;
		const ourY = y as Coordinate;

		const internalResult = this._internalHitTest(ourX, ourY);

		if (internalResult === null) {
			//console.log(`[BaseLineTool] Internal hitTest returned NULL.`);
			return null;
		}

		// Adapt our internal HitTestResult to ISeriesPrimitive's expected PrimitiveHoveredItem
		//console.log(`[BaseLineTool] Internal hitTest returned: Type=${internalResult.type()}, Data=${JSON.stringify(internalResult.data())}`); 

		const hitData = internalResult.data();
		let cursorStyle: PaneCursorType = PaneCursorType.Default; 
		if (hitData?.suggestedCursor) {
			cursorStyle = hitData.suggestedCursor; // Use the specific cursor suggested by the hit
			//console.log(`[BaseLineTool] Using suggestedCursor from hitData: ${cursorStyle}`);
		} else {
			// Fallback to tool options or generic defaults if no specific suggestedCursor is provided by hitData
			const options = this.options();
			switch (internalResult.type()) {
				case HitTestType.MovePointBackground:
					// Use tool's defaultDragCursor or a generic 'grabbing'
					cursorStyle = options.defaultDragCursor || PaneCursorType.Grabbing;
					//console.log(`[BaseLineTool] Using defaultDragCursor: ${cursorStyle}`);
					break;
				case HitTestType.MovePoint:
				case HitTestType.Regular:
					// Use tool's defaultHoverCursor or a generic 'pointer'
					cursorStyle = options.defaultHoverCursor || PaneCursorType.Pointer;
					//console.log(`[BaseLineTool] Using defaultHoverCursor: ${cursorStyle}`);
					break;
				case HitTestType.ChangePoint:
					// For anchor points, a generic resize cursor if not specifically set elsewhere
					cursorStyle = PaneCursorType.DiagonalNwSeResize; // Example, can be refined.
					//console.log(`[BaseLineTool] Using generic DiagonalNwSeResize for ChangePoint.`);
					break;
				default:
					cursorStyle = PaneCursorType.Default;
					//console.log(`[BaseLineTool] Using PaneCursorType.Default as fallback.`);
					break;
			}
		}

		// Return the PrimitiveHoveredItem.
		//console.log(`[BaseLineTool] Final cursor selected for PrimitiveHoveredItem: ${cursorStyle}`);
		return {
			externalId: this.id(), // Return the unique ID of the tool
			zOrder: 'normal', // Default zOrder for line tools
			cursorStyle: cursorStyle, // NEW: Use the determined cursorStyle
		};
	}





	// Core instances and plugin API
	protected _chart!: IChartApiBase<HorzScaleItem>;
	protected _series!: ISeriesApi<SeriesType, HorzScaleItem>;
	protected _horzScaleBehavior!: IHorzScaleBehavior<HorzScaleItem>;
	protected _coreApi: LineToolsCorePlugin<HorzScaleItem>;
	protected _requestUpdate?: () => void;

	// Tool-specific state
	protected _id: string;
	protected _options: LineToolOptionsInternal<LineToolType> = {} as LineToolOptionsInternal<LineToolType>;
	protected _points: LineToolPoint[];

	protected _paneViews: IUpdatablePaneView[] = [];

	// Interaction state
	private _selected: boolean = false;
	private _hovered: boolean = false;
	private _editing: boolean = false;
	private _creating: boolean = false;
	protected _lastPoint: LineToolPoint | null = null;
	private _editedPointIndex: number | null = null;
	private _currentPoint: Point = new Point(0, 0);
	private _isDestroying: boolean = false;

	private _attachedPane: IPaneApi<HorzScaleItem> | null = null; 

	/**
	 * Initializes the Base Line Tool instance.
	 *
	 * Sets up core references, assigns the unique ID, and creates the persistent Price and Time Axis View instances
	 * based on the tool's required `pointsCount`.
	 *
	 * @param coreApi - The core plugin instance.
	 * @param chart - The chart API instance.
	 * @param series - The series API instance this tool is attached to.
	 * @param horzScaleBehavior - The horizontal scale behavior for time conversion utilities.
	 * @param finalOptions - The complete and final configuration options for the tool instance.
	 * @param points - Initial array of logical points.
	 * @param toolType - The specific string identifier for the tool.
	 * @param pointsCount - The fixed number of points this tool requires (`-1` for unbounded).
	 * @param priceAxisLabelStackingManager - The manager for label collision resolution.
	 */
	public constructor(
		coreApi: LineToolsCorePlugin<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
		horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
		finalOptions: LineToolOptionsInternal<LineToolType>, 
		points: LineToolPoint[] = [],
		toolType: LineToolType,
		pointsCount: number,
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		super(chart); 
		
		this._id = randomHash();
		this._coreApi = coreApi;
		this._chart = chart;
		this._series = series;
		this._horzScaleBehavior = horzScaleBehavior;
		this._points = points;
		this._creating = points.length === 0;
		this.toolType = toolType;
		this.pointsCount = pointsCount;
		this._priceAxisLabelStackingManager = priceAxisLabelStackingManager;

		// We assume the concrete tool has already handled the deep copy and merge,
		// and is passing the final, ready-to-use options object.
		this._setupOptions(finalOptions);

		// *** NEW LOGIC: Create persistent axis views here ***
		// If pointsCount is -1 (dynamic), we will handle view creation inside updateAllViews.
		if (this.pointsCount !== -1) {
			for (let i = 0; i < this.pointsCount; i++) {
				this._priceAxisLabelViews[i] = new LineToolPriceAxisLabelView(this, i, this._chart, this._priceAxisLabelStackingManager);
				this._timeAxisLabelViews[i] = new LineToolTimeAxisLabelView(this, i, this._chart);
			}
		}

	}


	/**
	 * Lifecycle hook called by Lightweight Charts when the primitive is first attached to a series.
	 *
	 * This method finalizes the setup by acquiring necessary runtime references:
	 * the `IPriceScaleApi`, the `requestUpdate` callback, and the {@link IPaneApi} reference.
	 *
	 * @param param - The parameters provided by Lightweight Charts upon attachment.
	 * @returns void
	 */
	public attached(param: SeriesAttachedParameter<HorzScaleItem>): void {
		this._chart = param.chart;
		this._series = param.series;
		this.setPriceScale(param.series.priceScale());
		this._requestUpdate = param.requestUpdate;
		this._horzScaleBehavior = param.horzScaleBehavior;

		// Dynamically find and store the IPaneApi object for the pane this tool's series is in.
		// We iterate through all panes of the chart and check if our series instance is part of that pane.
		this._attachedPane = this._chart.panes().find(p => {
			// Use direct instance comparison since ISeriesApi does not have a public .id() method
			return p.getSeries().some(s => s === this._series);
		}) || null;

		if (!this._attachedPane) {
			console.warn(`[BaseLineTool] Tool ${this.id()} attached to a series not found in any pane. This primitive relies on IPaneApi access.`);
		}

		console.log(`Tool ${this.toolType} with ID ${this.id()} attached to series.`);
	}

	/**
	 * OPTIONAL: Defines the maximum index of an interactive anchor point that this tool supports.
	 *
	 * This is used by the {@link InteractionManager} to correctly determine the total number of anchor
	 * points (including virtual ones like the midpoint handle on a Trend Line) to monitor for interaction.
	 *
	 * @returns The highest index of an anchor point (e.g., 7 for an 8-anchor tool).
	 */
	public maxAnchorIndex?(): number;	

	/**
	 * OPTIONAL: Indicates if this tool supports creation via a sequence of discrete mouse clicks.
	 *
	 * Most bounded tools (e.g., TrendLine) should return `true` or omit this method (defaulting to true).
	 * Unbounded tools (e.g., Brush) typically return `false`.
	 *
	 * @returns `true` if click-click is supported, `false` otherwise.
	 */
	public supportsClickClickCreation?(): boolean;

	/**
	 * OPTIONAL: Indicates if this tool supports creation via a single click-hold-drag-release gesture.
	 *
	 * This is the common method for drawing tools like Rectangles and the only method for freehand tools like Brush.
	 *
	 * @returns `true` if click-drag is supported, `false` otherwise.
	 */
	public supportsClickDragCreation?(): boolean;

	/**
	 * OPTIONAL: Indicates if holding the Shift key should apply a geometric constraint (like axis-lock)
	 * during a **discrete click-click** creation sequence.
	 *
	 * This is only relevant if {@link supportsClickClickCreation} is `true`.
	 *
	 * @returns `true` if the constraint should be applied, `false` otherwise.
	 */
	public supportsShiftClickClickConstraint?(): boolean;

	/**
	 * OPTIONAL: Indicates if holding the Shift key should apply a geometric constraint (like 45-degree lock)
	 * during a **click-drag-release** creation gesture.
	 *
	 * This is only relevant if {@link supportsClickDragCreation} is `true`.
	 *
	 * @returns `true` if the constraint should be applied, `false` otherwise.
	 */
	public supportsShiftClickDragConstraint?(): boolean;	


	/**
	 * Lifecycle hook called by Lightweight Charts when the primitive is detached from a series.
	 *
	 * This performs crucial cleanup by nullifying references to external Lightweight Charts API objects
	 * (chart, series, pane, etc.) to prevent memory leaks and stale closures.
	 *
	 * @returns void
	 */
	public detached(): void {
		console.log(`[BaseLineTool] Tool ${this.id()} detached from series.`);

		// Nullify references to LWCharts APIs to prevent memory leaks / stale closures.
		// This is important because chart/series APIs might hold references back to the primitive.
		// Cast to `any` only where strictly necessary for re-assigning readonly properties for cleanup.
		(this._chart as any) = null;
		(this._series as any) = null;
		(this._horzScaleBehavior as any) = null;
		(this._attachedPane as any) = null; // Clear the IPaneApi reference
		(this._requestUpdate as any) = null; // Clear the requestUpdate callback
	}

	/**
	 * Returns the {@link IPaneApi} instance to which this tool is currently attached.
	 *
	 * This reference is required for internal operations like detaching the tool primitive.
	 *
	 * @returns The {@link IPaneApi} for the attached pane.
	 * @throws An error if the tool has not been successfully attached to a series/pane yet.
	 */
	public getPane(): IPaneApi<HorzScaleItem> {
		if (!this._attachedPane) {
			throw new Error(`Tool ${this.id()} is not attached to a pane. 'attached()' might not have been called or ran into an issue.`);
		}
		return this._attachedPane;
	}

	// #region Public API for managing tool state & properties

	/**
	 * Retrieves the unique string identifier for this tool instance.
	 *
	 * @returns The unique ID.
	 */
	public id(): string { return this._id; }

	/**
	 * Sets a specific unique ID for this tool instance.
	 *
	 * This is primarily used during programmatic creation via {@link LineToolsCorePlugin.createOrUpdateLineTool}
	 * to ensure a user-defined ID is preserved.
	 *
	 * @param id - The unique string ID to assign.
	 * @returns void
	 */
	public setId(id: string): void { this._id = id; }
	
	/**
	 * Checks if the tool is currently in the selected state.
	 *
	 * The selected state typically enables anchor handles and border highlighting.
	 *
	 * @returns `true` if selected, `false` otherwise.
	 */
	public isSelected(): boolean { return this._selected; }

	/**
	 * Checks if the mouse cursor is currently hovering over the tool.
	 *
	 * The hovered state often triggers a temporary visual change, like a different border color.
	 *
	 * @returns `true` if hovered, `false` otherwise.
	 */
	public isHovered(): boolean { return this._hovered; }

	/**
	 * Checks if the tool is currently being actively edited (i.e., an anchor point is being dragged).
	 *
	 * The editing state is distinct from being merely selected.
	 *
	 * @returns `true` if an anchor is being dragged, `false` otherwise.
	 */
	public isEditing(): boolean { return this._editing; }

	/**
	 * Checks if the tool is currently in the process of being created by user interaction.
	 *
	 * The creating state is active from the moment the tool is initiated until its final point is placed.
	 *
	 * @returns `true` if in creation mode, `false` otherwise.
	 */
	public isCreating(): boolean { return this._creating; }

	/**
	 * Sets the tool's selection state and triggers a view update to reflect the change.
	 *
	 * @param selected - The new selection state (`true` to select, `false` to deselect).
	 * @returns void
	 */
	public setSelected(selected: boolean): void {
		this._selected = selected;
		this.updateAllViews();
		this._requestUpdate?.();
	}
	
	/**
	 * Sets the tool's hovered state and triggers a view update if the state changes.
	 *
	 * @param hovered - The new hover state.
	 * @returns void
	 */
	public setHovered(hovered: boolean): void {
		this._hovered = hovered;
		this.updateAllViews();
		this._requestUpdate?.();
	}

	/**
	 * Sets the tool's editing state (active drag is in progress).
	 *
	 * This typically happens when the user clicks down on an anchor and moves beyond the drag threshold.
	 *
	 * @param editing - The new editing state.
	 * @returns void
	 */
	public setEditing(editing: boolean): void {
		this._editing = editing;
		this.updateAllViews();
		this._requestUpdate?.();
	}
	
	/**
	 * Sets the tool's creation state.
	 *
	 * This is used internally by the {@link InteractionManager} to track which tool instance
	 * is currently accepting new points from user clicks.
	 *
	 * @param creating - The new creation state.
	 * @returns void
	 */
	public setCreating(creating: boolean): void {
		this._creating = creating;
	}

	/**
	 * Returns the index of the anchor point currently being dragged/edited.
	 *
	 * @returns The zero-based index of the dragged point, or `null` if `isEditing` is false.
	 */
	public editedPointIndex(): number | null {
		return this._editing ? this._editedPointIndex : null;
	}

	/**
	 * Sets the index of the anchor point that is currently the target of an editing drag.
	 *
	 * @param index - The index of the point, or `null` to clear the reference.
	 * @returns void
	 */
	public setEditedPointIndex(index: number | null): void {
		this._editedPointIndex = index;
	}

	/**
	 * Retrieves the last known screen coordinates of the mouse cursor over the chart.
	 *
	 * This point is continuously updated by the {@link InteractionManager} and is used by renderers
	 * (like the anchor renderer) to draw effects relative to the mouse position (e.g., hover halo).
	 *
	 * @returns A {@link Point} object with the current mouse screen coordinates.
	 */
	public currentPoint(): Point {
		return this._currentPoint;
	}

	/**
	 * Sets the last known screen coordinates of the mouse cursor.
	 *
	 * @param point - The new screen coordinate point.
	 * @returns void
	 */
	public setCurrentPoint(point: Point): void {
		this._currentPoint = point;
	}

	/**
	 * Retrieves the full list of points used for drawing the tool.
	 *
	 * This list includes both the permanent, committed points (`_points`) and, if the tool is in
	 * creation mode, the single temporary "ghost" point (`_lastPoint`) currently following the cursor.
	 *
	 * @returns A composite array of {@link LineToolPoint}s.
	 */
	public points(): LineToolPoint[] {
		// Combine permanent points with the temporary last point if it exists
		const points = [...this._points, ...(this._lastPoint ? [this._lastPoint] : [])];
		
		// If pointsCount is -1 (for tools like Brush), return all points.
		// Otherwise, only return the number of points the tool is defined to have.
		return this.pointsCount === -1 ? points : points.slice(0, this.pointsCount);
	}

	/**
	 * Retrieves the single temporary "ghost" point used for live preview during tool creation.
	 *
	 * @returns The last calculated {@link LineToolPoint} of the mouse position, or `null`.
	 */
	public getLastPoint(): LineToolPoint | null {
		return this._lastPoint;
	}

	/**
	 * Sets or clears the temporary "ghost" point.
	 *
	 * Used during the tool creation process to show a live preview that follows the user's mouse.
	 * Setting this immediately calls `_triggerChartUpdate`.
	 *
	 * @param point - The temporary {@link LineToolPoint}, or `null` to clear it.
	 * @returns void
	 */
	public setLastPoint(point: LineToolPoint | null): void {
		this._lastPoint = point;
		// Trigger a chart update to redraw the tool with its new ghost point
		this._triggerChartUpdate();
	}

	/**
	 * Overwrites the entire array of permanent points defining the tool's geometry.
	 *
	 * This method is called during programmatic updates or when the entire tool is translated (moved).
	 *
	 * @param points - The new array of {@link LineToolPoint}s.
	 * @returns void
	 */
	public setPoints(points: LineToolPoint[]): void { this._points = points; }

	/**
	 * Adds a new, permanent {@link LineToolPoint} to the end of the tool's point array.
	 *
	 * This is called by the {@link InteractionManager} when a user performs a click to commit a new point during creation.
	 *
	 * @param point - The {@link LineToolPoint} to add.
	 * @returns void
	 */	
	public addPoint(point: LineToolPoint): void { this._points.push(point); }

	/**
	 * Retrieves a permanent point from the internal array by its index.
	 *
	 * @param index - The zero-based index of the point.
	 * @returns The requested {@link LineToolPoint}, or `null` if the index is out of bounds.
	 */
	public getPoint(index: number): LineToolPoint | null { return this._points[index] || null; }

	/**
	 * Updates a specific permanent point in the internal array with new logical coordinates.
	 *
	 * This method is called during editing (resizing) of a specific anchor point.
	 *
	 * @param index - The index of the point to modify.
	 * @param point - The new {@link LineToolPoint} coordinates.
	 * @returns void
	 */	
	public setPoint(index: number, point: LineToolPoint): void { 
		if(this._points[index]){
			this._points[index] = point;
		}
	}

	/**
	 * Returns the number of permanently committed points currently defining the tool.
	 *
	 * This count excludes any temporary "ghost" point and is used by the {@link InteractionManager}
	 * to decide the index of the next point to add.
	 *
	 * @returns The number of permanent points.
	 */
	public getPermanentPointsCount(): number {
		return this._points.length;
	}
	
	/**
	 * Retrieves the complete and final configuration options object for this tool instance.
	 *
	 * This includes both the {@link LineToolOptionsCommon} and the tool-specific options.
	 *
	 * @returns The full options object.
	 */
	public options(): LineToolOptionsInternal<any> {
		return this._options;
	}

	/**
	 * Deeply merges a partial set of new options into the tool's current configuration.
	 *
	 * This is the core method for updating the tool's appearance programmatically. It automatically
	 * triggers a full view update and a chart redraw after the merge is complete.
	 *
	 * @param options - A deep partial of the tool's options structure containing changes to be merged.
	 * @returns void
	 */
	public applyOptions(options: DeepPartial<LineToolOptionsInternal<any>>): void {
		merge(this._options, options);
		this.updateAllViews();
		this._requestUpdate?.();
	}
	
	/**
	 * Checks if the tool has acquired its minimum required number of permanent points.
	 *
	 * For bounded tools (`pointsCount > 0`), this returns true if `_points.length` meets `pointsCount`.
	 * For unbounded tools (`pointsCount === -1`), this check typically passes early, deferring finalization to `getFinalizationMethod`.
	 *
	 * @returns `true` if the tool is ready to exit creation mode, `false` otherwise.
	 */
	public isFinished(): boolean {
		return this._points.length >= this.pointsCount;
	}

	/**
	 * Attempts to transition the tool out of the `creating` state and into the `selected` state.
	 *
	 * This is called by the {@link InteractionManager} after a point is added. If `isFinished()` is true,
	 * the creation state is reset, the selected state is set, and views are updated.
	 *
	 * @returns void
	 */
	public tryFinish(): void {
		if (this.isFinished()) {
			this._creating = false;
			this._editing = false;
			this.setSelected(true);
			this.updateAllViews();
			this._requestUpdate?.();
		}
	}

	/**
	 * Generates the complete, serializable {@link LineToolExport} object representing the tool's current state.
	 *
	 * This is the fundamental data output used for API responses, event payloads, and state persistence.
	 *
	 * @returns The full export data object.
	 */
	public getExportData(): LineToolExport<LineToolType> {
		return {
			id: this.id(),
			toolType: this.toolType,
			points: this.points(),
			options: this.options(),
		};
	}

	/**
	 * OPTIONAL: Method used by the {@link InteractionManager} to enforce a tool-specific
	 * geometric constraint (like Y-Lock, 45-degree, or Axis-Alignment) when the Shift key is pressed.
	 *
	 * Concrete tools implement this to define their specific constraint logic.
	 *
	 * @param pointIndex - The index of the anchor point being dragged.
	 * @param rawScreenPoint - The raw, unconstrained screen coordinates of the mouse.
	 * @param phase - The current {@link InteractionPhase} (Creation, Editing, or Move).
	 * @param originalLogicalPoint - The logical point of the anchor at the start of the gesture.
	 * @param allOriginalLogicalPoints - The full array of all anchor points BEFORE the drag started.
	 * @returns The {@link ConstraintResult} containing the new constrained screen point and the snap axis hint.
	 */
	public getShiftConstrainedPoint?(
		pointIndex: number,
		rawScreenPoint: Point,
		phase: InteractionPhase,
		originalLogicalPoint: LineToolPoint,
		allOriginalLogicalPoints: LineToolPoint[]
	): ConstraintResult;	

	// #endregion

	// #region ISeriesPrimitive implementation

	/**
	 * Provides an array of pane view components to Lightweight Charts for rendering the tool's body.
	 *
	 * This implements the `ISeriesPrimitive` contract.
	 *
	 * @returns A readonly array of {@link IPaneView} components.
	 */
	public paneViews(): readonly IPaneView[] {
		return this._paneViews;
	}

	/**
	 * Signals that all associated view components (pane, price axis, time axis) need to update their internal data and caches.
	 *
	 * This method automatically triggers the synchronous update of the {@link PriceAxisLabelStackingManager}
	 * to ensure correct vertical placement of labels before the next render.
	 *
	 * @returns void
	 */
	public updateAllViews(): void {
		// Update the main pane view(s) for the tool's body (the line, rectangle, etc.)
		this._paneViews.forEach(view => view.update());

		// For tools with a dynamic number of points (like Brush or Path),
		// the logic to match the number of views to points would go here.
		// Since we are focused on fixed-point tools for now, this part is simplified.
		if (this.pointsCount === -1) {
			// Example for future implementation:
			// while (this._priceAxisLabelViews.length > this.points().length) {
			// 	 this._priceAxisLabelViews.pop();
			// 	 this._timeAxisLabelViews.pop();
			// }
		}

		// Now, simply call update() on the persistent view instances.
		// These views were created once in the constructor.
		this._priceAxisLabelViews.forEach(view => view.update());
		this._timeAxisLabelViews.forEach(view => view.update());

		// Call Stacking Manager synchronously. It must run immediately after the view updates
		// to ensure the shifted Y-coordinate is available for the chart's paint cycle.
		this._priceAxisLabelStackingManager.updateStacking();
	}	

	/**
	 * Retrieves the color that should be used for the price axis label background.
	 *
	 * Concrete tools should override this to return a dynamic color based on the tool's current state (e.g., color of P0).
	 *
	 * @returns A color string (e.g., '#FF0000') or `null` if the label should not be visible.
	 */
	public priceAxisLabelColor(): string | null {
		// The view will check the active state. This method just needs to provide a color if labels are shown.
		// Returning a static color simplifies this, but tools can override for more complex behavior.
		return '#2962FF'; // Default active color
	}

	/**
	 * Retrieves the color that should be used for the time axis label background.
	 *
	 * Concrete tools should override this to return a dynamic color based on the tool's current state (e.g., color of P0).
	 *
	 * @returns A color string (e.g., '#FF0000') or `null` if the label should not be visible.
	 */
	public timeAxisLabelColor(): string | null {
		// Same logic as priceAxisLabelColor
		return '#2962FF'; // Default active color
	}

	/**
	 * Retrieves the Lightweight Charts Series API instance this tool is attached to.
	 *
	 * @returns The `ISeriesApi` instance.
	 * @throws An error if the series has not been attached (e.g., in `detached` state).
	 */
	public getSeries(): ISeriesApi<SeriesType, HorzScaleItem> {
		if (!this._series) {
			throw new Error(`Series not attached to tool ${this.id()}. Cannot get series API.`);
		}
		return this._series;
	}

	/**
	 * Retrieves the Lightweight Charts Chart API instance associated with this tool.
	 *
	 * @returns The `IChartApiBase` instance.
	 * @throws An error if the chart API is not available.
	 */
	public getChart(): IChartApiBase<HorzScaleItem> {
		if (!this._chart) {
			throw new Error('Chart API not available. Tool might not be attached.');
		}
		return this._chart; 
	}
    
	/**
	 * Retrieves the chart's horizontal scale behavior instance.
	 *
	 * This object is critical for correctly converting time values (`Time`, `UTCTimestamp`, etc.)
	 * to and from the generic `HorzScaleItem` type used by Lightweight Charts.
	 *
	 * @returns The `IHorzScaleBehavior` instance.
	 * @throws An error if the scale behavior is not attached.
	 */
	public get horzScaleBehavior(): IHorzScaleBehavior<HorzScaleItem> {
		if (!this._horzScaleBehavior) {
			throw new Error(`Horizontal Scale Behavior not attached to tool ${this.id()}.`);
		}
		return this._horzScaleBehavior;
	}	
	
	// #endregion

	// #region Utilities for subclasses

	/**
	 * Transforms a logical data point (timestamp/price) into pixel screen coordinates.
	 *
	 * This utility handles the complex conversion, including interpolation for points
	 * that lie in the chart's "blank logical space" (outside the available data bars).
	 *
	 * @param point - The logical {@link LineToolPoint} to convert.
	 * @returns A {@link Point} with screen coordinates, or `null` if conversion fails.
	 */
	public pointToScreenPoint(point: LineToolPoint): Point | null {
		const timeScale = this._chart.timeScale();

		// CORRECTED: Assert point.timestamp as UTCTimestamp to match the 'Time' type expectation.
		const logicalIndex = interpolateLogicalIndexFromTime(this._chart, this._series, point.timestamp as UTCTimestamp);

		if (logicalIndex === null) {
			console.warn(`[BaseLineTool] pointToScreenPoint: Could not determine logical index for timestamp: ${point.timestamp}.`);
			return null;
		}
 
		// Use logicalToCoordinate for x-coordinate based on the logical index.
		const x = timeScale.logicalToCoordinate(logicalIndex);

		// Use the series' priceToCoordinate method directly.
		const y = this._series.priceToCoordinate(point.price);

		// Ensure conversions were successful and resulted in valid coordinates.
		if (x === null || y === null) {
			console.warn(`[BaseLineTool] pointToScreenPoint: Coordinate conversion failed for point: ${JSON.stringify(point)}. Received x=${x}, y=${y}`);
			return null;
		}

		return new Point(x, y);
	}

	/**
	 * Transforms a pixel screen coordinate into a logical data point (timestamp/price).
	 *
	 * This method is the inverse of `pointToScreenPoint` and is primarily used by the
	 * {@link InteractionManager} to determine the final logical coordinates of a user click or drag.
	 *
	 * @param point - The {@link Point} with screen coordinates.
	 * @returns A logical {@link LineToolPoint}, or `null` if conversion fails.
	 */
	public screenPointToPoint(point: Point): LineToolPoint | null {
		const timeScale = this._chart.timeScale();
		const price = this._series.coordinateToPrice(point.y as Coordinate);

		// Get the logical index from the screen X coordinate.
		const logical = timeScale.coordinateToLogical(point.x as Coordinate);
		
		if (logical === null) {
			return null;
		}

		// Use our interpolation function to get a timestamp from the logical index.
		// This handles cases where the logical position is in a "blank" area.
		const interpolatedTime = interpolateTimeFromLogicalIndex(this._chart, this._series, logical);

		if (interpolatedTime === null || price === null) {
			console.warn(`[BaseLineTool] screenPointToPoint: Could not determine interpolated time or price for screen point: ${JSON.stringify(point)}.`);
			return null;
		}

		return {
			timestamp: this._horzScaleBehavior.key(interpolatedTime as HorzScaleItem) as number,
			price: price as number,
		};
	}

	/**
	 * Sets the internal array of pane view components.
	 *
	 * This protected method is called by the concrete line tool's `constructor` or `updateAllViews`
	 * to define what graphical elements (lines, shapes, text, etc.) will be rendered.
	 *
	 * @param views - An array of {@link IUpdatablePaneView} instances.
	 * @protected
	 */
	protected _setPaneViews(views: IUpdatablePaneView[]): void {
		this._paneViews = views;
	}

	/**
	 * Assigns the tool's final and complete configuration options.
	 *
	 * Concrete tool implementations use this during construction, ensuring the base class
	 * always holds a unique, finalized options object.
	 *
	 * @param finalOptions - The complete options object.
	 * @protected
	 */
	protected _setupOptions(
		finalOptions: LineToolOptionsInternal<LineToolType>
	): void {
		// Base tool just assigns the options object, assuming it is unique and complete.
		this._options = finalOptions;
	}

	// #endregion

	/**
	 * Cleans up and releases all resources held by the line tool instance.
	 *
	 * This is the final internal cleanup hook called by the {@link LineToolsCorePlugin} when the tool is removed.
	 * It ensures memory safety by:
	 * 1. Unregistering all price axis labels from the stacking manager.
	 * 2. Clearing all internal view and point references.
	 * 3. Nullifying the price scale.
	 *
	 * @returns void
	 */
	public destroy(): void {
		console.log(`[BaseLineTool] Destroying tool with ID: ${this.id()}`);

		this._isDestroying = true;

		// Immediately request an update so the chart knows to stop using my views
        // This is done BEFORE unregistering from the stacking manager which will trigger its own update
		this._triggerChartUpdate(); 

		// Unregister all price axis labels associated with this tool from the stacking manager
		this._priceAxisLabelViews.forEach(view => {
			if (view instanceof LineToolPriceAxisLabelView) {
				// The ID used for registration is toolId + '-p' + pointIndex (see LineToolPriceAxisLabelView)
				this._priceAxisLabelStackingManager.unregisterLabel(this.id() + '-p' + view.getPointIndex());
			}
		});
		// Trigger a stacking update to re-flow remaining labels after this tool's labels are removed
		this._priceAxisLabelStackingManager.updateStacking();

		// Clear references to views and internal data
		this._paneViews.forEach(paneView => {
			const renderer = paneView.renderer();
			if (renderer && renderer.clear) { // Check if the renderer has a clear method
				renderer.clear();
			}
		});
		(this._paneViews as any) = []; // Breaks references to renderers and views
		(this._points as any) = [];
		this._lastPoint = null;

		// Clear price scale reference
		this.setPriceScale(null); // Will set this._priceScale = null

		// Reset interaction states
		this._selected = false;
		this._hovered = false;
		this._editing = false;
		this._creating = false;
		this._editedPointIndex = null;
		(this._currentPoint as any) = new Point(0, 0); // Reset Point instance (or nullify)

		// Note: The `detached()` method will handle nullifying references to external LWCharts APIs.
		// We do not call `this.detached()` here as `detached()` is part of the `ISeriesPrimitive` lifecycle
		// managed by LWCharts, and `destroy` is our plugin's internal cleanup hook.
		// When our `InteractionManager.detachTool` is called, it will eventually lead to LWCharts calling `detached()`.
	}

	/**
	 * Triggers a chart update (redraw) via the internal `requestUpdate` callback.
	 *
	 * This is the standard mechanism for the tool to force the chart to redraw itself
	 * after a state change that affects its visual output.
	 *
	 * @internal
	 * @returns void
	 */
	public _triggerChartUpdate(): void {
		if (this._requestUpdate) { // Use the existing _requestUpdate property
			this._requestUpdate();
			//console.log(`[BaseLineTool] Triggering chart update for tool ${this.id()}.`);
		} else {
			console.warn(`[BaseLineTool] Attempted to trigger chart update for tool ${this.id()} but _requestUpdate is not set.`);
		}
	}

	/**
	 * Implements the `IDataSource` method for the base value.
	 *
	 * For line tools, this typically has no meaning and returns 0.
	 *
	 * @returns The base value (0).
	 */
	public base(): number {
		// Line tools typically don't have a 'base' in the same way a histogram does.
		return 0;
	}

	/**
	 * Provides autoscale information for the primitive, implementing the `IDataSource` contract.
	 *
	 * By default, line tools do not influence the chart's autoscale range, and this method returns `null`.
	 * Tools that need to affect the autoscale (e.g., specialized markers) must override this.
	 *
	 * @param startTimePoint - The logical index of the start of the visible range.
	 * @param endTimePoint - The logical index of the end of the visible range.
	 * @returns An {@link AutoscaleInfo} object if the tool affects the scale, or `null`.
	 */
	public autoscaleInfo(startTimePoint: Logical, endTimePoint: Logical): AutoscaleInfo | null {
		// Line tools do not participate in autoscale by default.
		// If a specific tool needs to, it should override this method.
		// The AutoscaleInfoImpl provides a .toRaw() method to convert to the expected AutoscaleInfo interface.
		return null; // Returning null for no autoscale influence by default.
	}

	/**
	 * Implements the `IDataSource` method for providing the price scale's first value.
	 *
	 * This is primarily used for features like percentage-based price scales. For general line tools,
	 * this is typically not applicable.
	 *
	 * @returns The {@link FirstValue} object, or `null`.
	 */
	public firstValue(): FirstValue | null {
		// This can be enhanced later if tools need to influence the price scale formatting.
		return null;
	}

	/**
	 * Provides an {@link IPriceFormatter} for this tool, implementing the `IDataSource` contract.
	 *
	 * This is usually a no-op formatter as the underlying series' formatter is preferred.
	 *
	 * @returns A basic {@link IPriceFormatter} implementation.
	 */
	public formatter(): IPriceFormatter {
		// Return a default formatter that satisfies the IPriceFormatter interface.
		// The actual series' formatter will be used for display.
		return {
			format: (price: number) => price.toString(), // Basic string conversion for format
			formatTickmarks: (prices: readonly number[]) => prices.map(p => p.toString()) // Basic string conversion for tickmarks
		};
	}

	/**
	 * Implements the `IDataSource` method to provide a price line color.
	 *
	 * This is typically not used for line tools and returns an empty string.
	 *
	 * @param lastBarColor - The color of the last bar in the series (unused).
	 * @returns An empty string.
	 */	
	public priceLineColor(lastBarColor: string): string {
		// Not applicable for line tools.
		return '';
	}

	/**
	 * OPTIONAL: Indicates if dragging the first anchor point (index 0) of an unbounded tool (e.g., Brush)
	 * should be treated as a full tool translation (move) rather than just a point edit.
	 *
	 * This is used by the {@link InteractionManager} to distinguish the drag behavior of tools like Brush vs. Path.
	 *
	 * @returns `true` if dragging anchor 0 should translate the whole tool, `false` otherwise.
	 */
	public anchor0TriggersTranslation(): boolean {
		// Default to false. Path Tool inherits this.
		return false;
	}
	
	/**
	 * OPTIONAL: Hook for tools that finalize creation on a double-click (e.g., Path tool).
	 *
	 * This allows the tool to perform specific cleanup (like removing the last "rogue" point added
	 * on the final single click before the double-click) before the creation process concludes.
	 *
	 * @returns The instance of the tool (for method chaining).
	 */
	public handleDoubleClickFinalization(): BaseLineTool<HorzScaleItem> {
		return this; // Default is no operation.
	}

	/**
	 * Returns the method a user must employ to signal the end of the tool's creation process.
	 *
	 * Concrete tools must override this if they don't finalize automatically when `pointsCount` is reached.
	 *
	 * @returns The required {@link FinalizationMethod} (e.g., `MouseUp`, `DoubleClick`, or `PointCount`).
	 */
	public getFinalizationMethod(): FinalizationMethod {
		return FinalizationMethod.PointCount;
	}	

	/**
	 * Retrieves the complete array of permanent points that should be translated when the tool is moved.
	 *
	 * This is used by the {@link InteractionManager} to get a stable snapshot of all points
	 * for calculating logical translation vectors.
	 *
	 * @returns An array of permanent {@link LineToolPoint}s.
	 */
	public getPermanentPointsForTranslation(): LineToolPoint[] {
		// Return a copy to ensure external modifications do not corrupt internal state
		return [...this._points]; 
	}

	/**
	 * Clears the temporary "ghost" point (`_lastPoint`), ensuring it is no longer rendered.
	 *
	 * This is called by the {@link InteractionManager} upon finalization of the tool's creation.
	 *
	 * @returns void
	 */
	public clearGhostPoint(): void {
		this._lastPoint = null;
	}

	/**
	 * Retrieves the pixel width of the chart pane's central drawing area.
	 *
	 * This width excludes the left and right price axes, giving the usable horizontal space.
	 * It is used for calculating the extent of lines that should span the full width.
	 *
	 * @returns The pixel width of the drawing area.
	 */
	public getChartDrawingWidth(): number {
		// Assumption: this._chart (IChartApiBase) exposes paneSize() which returns a PaneSize object {width, height}.
		const paneDimensions = this._chart.paneSize(); 
		return paneDimensions.width;
	}

	/**
	 * Retrieves the pixel height of the chart pane's central drawing area.
	 *
	 * This height excludes the top and bottom margins as well as the time scale area,
	 * giving the usable vertical space within the pane.
	 *
	 * @returns The pixel height of the drawing area.
	 */
	public getChartDrawingHeight(): number {
		// Assumption: this._chart (IChartApiBase) exposes paneSize() which returns a PaneSize object {width, height}.
		const paneDimensions = this._chart.paneSize(); 
		return paneDimensions.height;
	}
}