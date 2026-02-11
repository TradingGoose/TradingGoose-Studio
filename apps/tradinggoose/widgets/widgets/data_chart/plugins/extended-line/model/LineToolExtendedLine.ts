// /src/model/LineToolExtendedLine.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	SeriesType,
} from 'lightweight-charts';

import {
	LineToolPoint,
	LineToolOptionsInternal,
	LineToolType,
	DeepPartial,
	LineToolsCorePlugin,
	PriceAxisLabelStackingManager
} from '../../core';

// Import the base class model and its default options structure
// NOTE: Assuming LineToolTrendLine.ts will be modified to export TrendLineOptionDefaults
import { LineToolTrendLine, TrendLineOptionDefaults } from '../../shared/lines/model/LineToolTrendLine';
import { buildLineToolOptions } from '../../shared/lines/model/line-tool-options';
import { LineToolExtendedLinePaneView } from '../views/LineToolExtendedLinePaneView';


/**
 * Defines the specific configuration overrides that transform a standard Trend Line into an Extended Line.
 *
 * **Tutorial Note:**
 * The key characteristic of an Extended Line is that it spans the entire chart indefinitely,
 * passing through its two defining points.
 *
 * This override sets both `extend.left` and `extend.right` to `true`. The underlying
 * `SegmentRenderer` reads these flags and automatically handles the mathematics to calculate
 * the intersections with the viewport boundaries.
 */
const ExtendedLineSpecificOverrides = {
	line: {
		extend: { left: true, right: true },
	}
};


/**
 * Concrete implementation of the Extended Line drawing tool.
 *
 * **What is an Extended Line?**
 * Structurally, it is identical to a {@link LineToolTrendLine} (defined by two points).
 * Visually, it draws a line that passes through these two points and continues infinitely
 * in both directions across the chart.
 *
 * **Inheritance:**
 * It extends {@link LineToolTrendLine} to reuse the point handling, hit testing, and normalization logic.
 * The difference is purely configuration (extensions enabled) and the specific View class used.
 */
export class LineToolExtendedLine<HorzScaleItem> extends LineToolTrendLine<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('ExtendedLine').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'ExtendedLine';
	
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * An Extended Line requires exactly **2 points** to define the slope and position of the infinite line.
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 2; // Still a 2-point tool

	/**
	 * Initializes the Extended Line tool.
	 *
	 * **Tutorial Note on Option Merging:**
	 * 1. **Base Defaults:** Start with `TrendLineOptionDefaults`.
	 * 2. **Subclass Overrides:** Merge `ExtendedLineSpecificOverrides` to force `extend: { left: true, right: true }`.
	 * 3. **User Options:** Merge the `options` passed by the user.
	 *
	 * This setup ensures the line extends infinitely by default, but still allows the user to
	 * customize other aspects like color, width, or text.
	 *
	 * @param coreApi - The Core Plugin API.
	 * @param chart - The Lightweight Charts Chart API.
	 * @param series - The Series API this tool is attached to.
	 * @param horzScaleBehavior - The horizontal scale behavior.
	 * @param options - Configuration overrides.
	 * @param points - Initial points.
	 * @param priceAxisLabelStackingManager - The manager for label collision.
	 */
	public constructor(
		coreApi: LineToolsCorePlugin<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
		horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>,
		options: DeepPartial<LineToolOptionsInternal<'ExtendedLine'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		const finalOptions = buildLineToolOptions<'ExtendedLine', 'TrendLine'>(
			TrendLineOptionDefaults,
			options,
			ExtendedLineSpecificOverrides
		);

		// 4. Call the parent (LineToolTrendLine) constructor with the customized options.
		// The parent constructor is effectively the BaseLineTool constructor.
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			priceAxisLabelStackingManager
		);

		// 3. Set the specific PaneView for this tool (optional, but good practice for consistency)
		// NOTE: LineToolExtendedLinePaneView must be created next, inheriting from the TrendLine view.
		this._setPaneViews([new LineToolExtendedLinePaneView(this, this._chart, this._series)]);

	}

	// NOTE: All core logic (hitTest, shift constraints, normalize) is inherited from LineToolTrendLine.
}
