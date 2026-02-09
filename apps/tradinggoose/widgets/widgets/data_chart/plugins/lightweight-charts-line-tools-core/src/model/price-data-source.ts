// /src/model/price-data-source.ts

import { AutoscaleInfoImpl, FirstValue, TimePointIndex, IPriceFormatter, IDataSource, AutoscaleInfo } from '../types';
import { IChartApiBase, Logical } from 'lightweight-charts';
import { DataSource } from './data-source';

/**
 * An abstract class that extends the minimal {@link DataSource} and enforces the required
 * IDataSource contract for primitives that rely on chart and price model information.
 *
 * This class provides a required reference to the `IChartApiBase` instance and is the
 * immediate parent for {@link BaseLineTool}.
 *
 * @typeParam HorzScaleItem - The type of the horizontal scale item (e.g., `Time` or `number`).
 */
export abstract class PriceDataSource<HorzScaleItem> extends DataSource implements IDataSource {
    
    /**
     * The reference to the Lightweight Charts chart API instance.
     * @protected
     * @readonly
     */
    protected readonly _model: IChartApiBase<HorzScaleItem>;

    /**
     * Initializes the data source by storing the reference to the chart model.
     *
     * @param model - The `IChartApiBase` instance.
     */
    public constructor(model: IChartApiBase<HorzScaleItem>) {
        super();
        this._model = model;
    }

    /**
     * Retrieves the chart model API instance.
     *
     * This implements the abstract `IDataSource.model()` contract.
     *
     * @returns The `IChartApiBase` instance.
     */
    public model(): IChartApiBase<HorzScaleItem> {
        return this._model;
    }

    /**
     * Abstract method to provide the base value for the data source.
     * @returns The base value (a number).
     * @abstract
     */
    public abstract base(): number;

    /**
     * Abstract method to provide autoscale information.
     * @param startTimePoint - The logical index of the start of the visible range.
     * @param endTimePoint - The logical index of the end of the visible range.
     * @returns An {@link AutoscaleInfo} object, or `null`.
     * @abstract
     */
    public abstract autoscaleInfo(startTimePoint: Logical, endTimePoint: Logical): AutoscaleInfo | null;

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
}