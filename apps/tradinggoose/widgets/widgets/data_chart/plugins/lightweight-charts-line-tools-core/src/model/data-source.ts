// /src/model/data-source.ts

import { IDataSource, IPaneView, IPriceAxisView, ITimeAxisView, AutoscaleInfo, FirstValue, IPriceFormatter } from '../types';
import { Logical,  IPriceScaleApi } from 'lightweight-charts';

/**
 * An abstract base class that implements the minimal required structure of a Lightweight Charts `IDataSource`.
 *
 * This class provides basic functionality for managing the price scale reference and Z-order (layering)
 * of any primitive. It is intended to be the top layer of inheritance for primitives that render data
 * (e.g., `PriceDataSource` and ultimately `BaseLineTool`).
 *
 * It leaves key rendering and data methods (like `autoscaleInfo` and `paneViews`) as abstract.
 */
export abstract class DataSource implements IDataSource {
	/**
	 * The API instance for the price scale this data source is currently bound to.
	 * This can be the default price scale or a custom one.
	 * @protected
	 */
	protected _priceScale: IPriceScaleApi | null = null;

	private _zorder: number = 0;

	/**
	 * Retrieves the current Z-order value, which determines the drawing layer of the tool's primitive.
	 * @returns The Z-order index.
	 */
	public zorder(): number {
		return this._zorder;
	}

	/**
	 * Sets the drawing layer of the tool's primitive.
	 * @param zorder - The new Z-order index.
	 * @returns void
	 */
	public setZorder(zorder: number): void {
		this._zorder = zorder;
	}

	/**
	 * Retrieves the API for the price scale this primitive is attached to.
	 * @returns The `IPriceScaleApi` instance, or `null`.
	 */
	public priceScale(): IPriceScaleApi | null {
		return this._priceScale;
	}

	/**
	 * Sets the API instance for the price scale.
	 * @param priceScale - The `IPriceScaleApi` instance, or `null` to clear.
	 * @returns void
	 */
	public setPriceScale(priceScale: IPriceScaleApi | null): void {
		this._priceScale = priceScale;
	}

	/**
	 * Abstract method to signal that all views associated with this data source should update.
	 * Concrete subclasses (like {@link BaseLineTool}) must implement this to trigger view updates.
	 * @abstract
	 */	
	public abstract updateAllViews(): void;

	/**
	 * Checks if the data source is visible.
	 * @returns Always returns `true` by default, but derived classes can override.
	 */	
	public visible(): boolean {
		return true;
	}

	/**
	 * Abstract method to provide autoscale information.
	 * @param startTimePoint - The logical index of the start of the visible range.
	 * @param endTimePoint - The logical index of the end of the visible range.
	 * @returns An {@link AutoscaleInfo} object, or `null`.
	 * @abstract
	 */	
	public abstract autoscaleInfo(startTimePoint: Logical, endTimePoint: Logical): AutoscaleInfo | null;

	/**
	 * Abstract method to provide all price axis views for rendering labels.
	 * @returns A readonly array of {@link IPriceAxisView} components.
	 * @abstract
	 */	
	public abstract priceAxisViews(): readonly IPriceAxisView[];

	/**
	 * Abstract method to provide all pane views for rendering the main tool body.
	 * @returns A readonly array of {@link IPaneView} components.
	 * @abstract
	 */	
	public abstract paneViews(): readonly IPaneView[];

	/**
	 * Abstract method to provide all time axis views for rendering labels.
	 * @returns A readonly array of {@link ITimeAxisView} components.
	 * @abstract
	 */	
	public abstract timeAxisViews(): readonly ITimeAxisView[];

	/**
	 * Provides an array of views for labels drawn in the pane (not used by default).
	 * @returns An empty array.
	 */	
	public labelPaneViews(): readonly IPaneView[] {
		return [];
	}

	/**
	 * Provides an array of views for drawing content above the series data (not used by default).
	 * @returns An empty array.
	 */	
	public topPaneViews(): readonly IPaneView[] {
		return [];
	}

	/**
	 * Abstract method to provide the base value for the data source.
	 * @returns The base value (a number).
	 * @abstract
	 */
	public abstract base(): number;

	/**
	 * Abstract method to provide the first value of the series.
	 * @returns The {@link FirstValue} object, or `null`.
	 * @abstract
	 */	
	public abstract firstValue(): FirstValue | null;

	/**
	 * Abstract method to provide a price formatter for the data source.
	 * @returns The {@link IPriceFormatter}.
	 * @abstract
	 */	
	public abstract formatter(): IPriceFormatter;

	/**
	 * Abstract method to determine the price line color based on the last bar.
	 * @param lastBarColor - The color of the last bar.
	 * @returns The price line color string.
	 * @abstract
	 */
	public abstract priceLineColor(lastBarColor: string): string;

	/**
	 * Abstract method to provide the chart model reference.
	 * @returns The chart model object.
	 * @abstract
	 */	
	public abstract model(): any; // This will point to IChartApiBase<any> in PriceDataSource

}