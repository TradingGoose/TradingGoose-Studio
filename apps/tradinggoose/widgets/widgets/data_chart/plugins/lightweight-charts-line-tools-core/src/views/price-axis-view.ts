// /src/views/price-axis-view.ts

import {
	PriceAxisViewRendererCommonData,
	PriceAxisViewRendererData,
	IPriceAxisViewRenderer,
	IPriceAxisView, // Our internal interface that extends ISeriesPrimitiveAxisView
	PriceAxisViewRendererOptions
} from '../types';

import { Coordinate } from 'lightweight-charts'; // Ensure Coordinate is imported from lightweigh-charts
import { PriceAxisViewRenderer } from '../rendering/price-axis-view-renderer';

// Forward declaration for the actual renderer class
// This will be created in /src/rendering/price-axis-view-renderer.ts
// For now, we assume it exists for typing purposes.
// We also need a constructor type for it if we want to instantiate it generically.

/**
 * Interface defining the constructor signature for a Price Axis View Renderer.
 * 
 * This allows the `PriceAxisView` to be instantiated with a custom renderer implementation,
 * facilitating testing or specialized rendering logic.
 */
interface PriceAxisViewRendererConstructor {
	new(data: PriceAxisViewRendererData, commonData: PriceAxisViewRendererCommonData): IPriceAxisViewRenderer;
}

/**
 * Abstract base class for Price Axis Views.
 * 
 * This class implements the `ISeriesPrimitiveAxisView` interface and manages the data state
 * for two distinct renderers: one for the axis label itself and one for potential pane-side labels.
 * It handles caching, dirty state (`invalidated`), and integration with the stacking manager via `fixedCoordinate`.
 */
export abstract class PriceAxisView implements IPriceAxisView {
	// These objects hold the data that will be passed to the actual renderer.
	// We have one for the "axis label" itself and one for potential "pane-side labels".
	private readonly _commonRendererData: PriceAxisViewRendererCommonData = {
		coordinate: 0 as Coordinate, // Price coordinates on the axis
		color: '#FFF',               // Text color (default white)
		background: '#000',          // Background color of the label (default black)
	};

	private readonly _axisRendererData: PriceAxisViewRendererData = {
		text: '',
		visible: false,
		tickVisible: true,             // Option to draw a small tick mark next to the label
		moveTextToInvisibleTick: false, // If tick is invisible, should text move away?
		borderColor: '',               // Border color for the label box
	};

	private readonly _paneRendererData: PriceAxisViewRendererData = {
		text: '',
		visible: false,
		tickVisible: false,
		moveTextToInvisibleTick: true,
		borderColor: '',
	};

	// These are the actual renderer instances that will perform the drawing.
	private readonly _axisRenderer: IPriceAxisViewRenderer;
	private readonly _paneRenderer: IPriceAxisViewRenderer; // For labels drawn within the pane (e.g., custom price lines)

	private _invalidated: boolean = true; // Flag to force and update

	/**
     * Initializes the Price Axis View.
     * 
     * @param ctor - Optional constructor for the renderer. Defaults to `PriceAxisViewRenderer`.
     */
	public constructor(ctor?: PriceAxisViewRendererConstructor) {
		// Use the provided constructor or default to PriceAxisViewRenderer
		const RendererImpl = ctor || PriceAxisViewRenderer; // PriceAxisViewRenderer will be defined in another file
		this._axisRenderer = new RendererImpl(this._axisRendererData, this._commonRendererData);
		this._paneRenderer = new RendererImpl(this._paneRendererData, this._commonRendererData);
	}

	// -------------------------------------------------------------------
	// Implementation of IPriceAxisView / ISeriesPrimitiveAxisView methods
	// -------------------------------------------------------------------

	/**
     * Retrieves the text to be displayed on the axis label.
     * 
     * @returns The formatted price string.
     */
	public text(): string {
		this._updateRendererDataIfNeeded();
		return this._axisRendererData.text; // Text visible on the axis
	}

	/**
     * Retrieves the Y-coordinate for the label.
     * 
     * **Stacking Logic:** This method checks if a `fixedCoordinate` has been set by the 
     * `PriceAxisLabelStackingManager`. If so, it returns that shifted coordinate to prevent 
     * overlap. Otherwise, it returns the natural price-to-coordinate value.
     * 
     * @returns The Y-coordinate in pixels.
     */
	public coordinate(): Coordinate {
		this._updateRendererDataIfNeeded();
		
		// CRITICAL FIX: Return fixedCoordinate (the shifted value) if the Stacking Manager has set one.
		if (this._commonRendererData.fixedCoordinate !== undefined) {
			// Explicitly cast to Coordinate (the nominal type)
			return this._commonRendererData.fixedCoordinate as Coordinate;
		}

		// Otherwise, return the original, unshifted coordinate.
		return this._commonRendererData.coordinate as Coordinate;
	}

	/**
     * Marks the view as invalid, forcing a data recalculation on the next access.
     */
	public update(): void {
		this._invalidated = true;
	}

	/**
     * Measures the height required by the label.
     * 
     * It queries both the axis renderer and the pane renderer and returns the maximum height
     * to ensure sufficient space is reserved.
     * 
     * @param rendererOptions - Current styling options from the chart.
     * @param useSecondLine - Whether to account for a second line of text (default `false`).
     * @returns The height in pixels.
     */
	public height(rendererOptions: PriceAxisViewRendererOptions, useSecondLine: boolean = false): number {
        // Here, we don't call updateRendererDataIfNeeded to avoid side-effects during measurement.
        // The underlying renderer should be able to measure based on its current internal data.
        return Math.max(
			this._axisRenderer.height(rendererOptions, useSecondLine),
			this._paneRenderer.height(rendererOptions, useSecondLine)
		);
	}

	/**
     * Retrieves the manually fixed Y-coordinate set by the Stacking Manager.
     * 
     * @returns The fixed coordinate, or `0` if unset (nominal type cast).
     */
	public getFixedCoordinate(): Coordinate {
		return (this._commonRendererData.fixedCoordinate || 0) as Coordinate; // Nominal type cast
	}

	/**
     * Sets a manual Y-coordinate for this view.
     * 
     * This is called by the `PriceAxisLabelStackingManager` when it detects a collision
     * with another label.
     * 
     * @param value - The new Y-coordinate in pixels.
     */
	public setFixedCoordinate(value: Coordinate): void {
		this._commonRendererData.fixedCoordinate = value;
	}
	
	/**
     * Retrieves the text color for the label.
     * 
     * @returns A CSS color string.
     */
	public textColor(): string {
		this._updateRendererDataIfNeeded();
		return this._commonRendererData.color; // Text color
	}
	
	/**
     * Retrieves the background color for the label.
     * 
     * @returns A CSS color string.
     */
	public backColor(): string {
		this._updateRendererDataIfNeeded();
		return this._commonRendererData.background; // Label background color
	}
	
	/**
     * Checks if the view is currently visible.
     * 
     * Returns `true` if either the main axis label or the pane-side label is set to visible.
     * 
     * @returns `true` if visible, `false` otherwise.
     */
	public visible(): boolean {
		this._updateRendererDataIfNeeded();
		return this._axisRendererData.visible || this._paneRendererData.visible;
	}
	
	/**
     * Retrieves the renderer for the main axis label.
     * 
     * This method triggers a data update if the view is invalidated, applies the latest
     * data to the renderer instance, and returns it for drawing by the chart engine.
     * 
     * @returns The {@link IPriceAxisViewRenderer} for the axis.
     */
	public getRenderer(): IPriceAxisViewRenderer {
		this._updateRendererDataIfNeeded();

		// Apply price scale drawing options before sending renderer data
		// (No priceScale reference here, specific implementations will handle this logic)
		// For now, we'll just update with existing defaults/data from _updateRendererData.
		this._axisRenderer.setData(this._axisRendererData, this._commonRendererData);
		return this._axisRenderer;
	}

	/**
     * Retrieves the renderer for the pane-side label (e.g., text drawn inside the chart area near the axis).
     * 
     * @returns The {@link IPriceAxisViewRenderer} for the pane.
     */
	public getPaneRenderer(): IPriceAxisViewRenderer {
		this._updateRendererDataIfNeeded();
		this._paneRenderer.setData(this._paneRendererData, this._commonRendererData);
		return this._paneRenderer;
	}

	// -------------------------------------------------------------------
	// Abstract method to be implemented by concrete axis views
	// -------------------------------------------------------------------

	/**
     * Abstract method to update the internal data structures based on the tool's current state.
     * 
     * Concrete implementations must override this to populate `axisRendererData`, `paneRendererData`, 
     * and `commonData` with the correct text, colors, and coordinates derived from the specific tool model.
     * 
     * @param axisRendererData - Data object for the axis label.
     * @param paneRendererData - Data object for the pane label.
     * @param commonData - Shared data (coordinates, colors).
     * @protected
     */
	protected abstract _updateRendererData(
		axisRendererData: PriceAxisViewRendererData,
		paneRendererData: PriceAxisViewRendererData,
		commonData: PriceAxisViewRendererCommonData
	): void;

	// -------------------------------------------------------------------
	// Private helper to ensure data is fresh before rendering
	// -------------------------------------------------------------------

	/**
     * Internal helper to trigger data recalculation if the view is dirty.
     * 
     * It resets default visibility flags and colors before calling the abstract `_updateRendererData`.
     * 
     * **Note on Stacking:** This method intentionally does *not* reset `fixedCoordinate`. 
     * The fixed coordinate is managed exclusively by the concrete view's interaction with the 
     * `PriceAxisLabelStackingManager`, ensuring that stacking shifts persist across standard update cycles.
     * 
     * @private
     */
	private _updateRendererDataIfNeeded(): void {
		if (this._invalidated) {
			// ** NOTE: fixedCoordinate is intentionally NOT reset here.
			// It is managed solely by the concrete view's _updateRendererData (which gets its value from the Stacking Manager)
			// to preserve the shifted Y position across update cycles.

			// Reset defaults before filling
			this._axisRendererData.text = '';
			this._axisRendererData.visible = false;
			this._axisRendererData.tickVisible = true;
			this._axisRendererData.moveTextToInvisibleTick = false;
			this._axisRendererData.borderColor = '';

			this._paneRendererData.text = '';
			this._paneRendererData.visible = false;
			this._paneRendererData.tickVisible = false;
			this._paneRendererData.moveTextToInvisibleTick = true;
			this._paneRendererData.borderColor = '';
			
			// Only reset coordinate, background, and color, which are always freshly recalculated
			this._commonRendererData.coordinate = 0 as Coordinate;
			this._commonRendererData.color = '#FFF';
			this._commonRendererData.background = '#000';

			this._updateRendererData(this._axisRendererData, this._paneRendererData, this._commonRendererData);
			this._invalidated = false;
		}
	}
}

