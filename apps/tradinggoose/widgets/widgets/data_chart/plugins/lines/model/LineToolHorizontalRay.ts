// /src/model/LineToolHorizontalRay.ts

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
	merge,
	deepCopy,
	PriceAxisLabelStackingManager,
} from '../../core';

// Import the base class model and its default options structure
import { LineToolHorizontalLine } from './LineToolHorizontalLine';
import { TrendLineOptionDefaults } from './LineToolTrendLine'; // Reuse the TrendLine base defaults for structure
import { LineToolHorizontalRayPaneView } from '../views/LineToolHorizontalRayPaneView';


/**
 * Defines the specific configuration overrides that differentiate a Horizontal Ray from a standard Horizontal Line.
 *
 * **Tutorial Note:**
 * While a Horizontal Line extends infinitely in *both* directions, a Horizontal Ray starts at the
 * anchor point and extends infinitely only to the **Right**.
 *
 * This override:
 * 1. Sets `extend: { left: false, right: true }`.
 * 2. Maintains the visibility of Price Axis labels (critical for horizontal levels).
 * 3. Hides Time Axis labels, as a horizontal line has no specific "time" other than its start anchor.
 */
const HorizontalRaySpecificOverrides = {
	line: {
		extend: { left: false, right: true }, // Key change: Extends only to the right
	},
	// Ensure the base tool's price and time axis label visibility is maintained
	showPriceAxisLabels: true,
	priceAxisLabelAlwaysVisible: false,
	showTimeAxisLabels: true, // Time axis label is redundant for horizontal lines/rays
};


/**
 * Concrete implementation of the Horizontal Ray drawing tool.
 *
 * **Inheritance Hierarchy:**
 * `BaseLineTool` -> `LineToolHorizontalLine` -> `LineToolHorizontalRay`
 *
 * **Why this inheritance?**
 * This tool shares 99% of its DNA with the {@link LineToolHorizontalLine}. It has 1 point,
 * moves the same way (Y-axis logic), and uses similar hit-testing. The only difference
 * is the visual rendering (one-sided extension). By inheriting from `LineToolHorizontalLine`,
 * we reuse all that logic and only override the specific options and View class.
 */
export class LineToolHorizontalRay<HorzScaleItem> extends LineToolHorizontalLine<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('HorizontalRay').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'HorizontalRay';

	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * Like the Horizontal Line, the Ray is defined by exactly **1 point** (the start of the ray).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 1; // It is a single-point tool

	/**
	 * Initializes the Horizontal Ray tool.
	 *
	 * **Tutorial Note on Option Merging:**
	 * 1. **Base:** Starts with `TrendLineOptionDefaults` (for font/color structure).
	 * 2. **Override:** Merges `HorizontalRaySpecificOverrides` to set `extend.right = true` and `extend.left = false`.
	 * 3. **User:** Merges user `options`.
	 *
	 * **View Construction:**
	 * It specifically instantiates `LineToolHorizontalRayPaneView`. Even though the logic is similar
	 * to the Horizontal Line view, using a distinct view class allows for cleaner separation if
	 * Ray-specific rendering logic is added in the future.
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
		options: DeepPartial<LineToolOptionsInternal<'HorizontalLine'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// 1. Start with a deep copy of the base TrendLine defaults (for common options structure)
		const finalOptions = deepCopy(TrendLineOptionDefaults) as LineToolOptionsInternal<'HorizontalLine'>;
 
		// 2. Merge the Horizontal Ray specific overrides (line extension is the key).
		merge(finalOptions, deepCopy(HorizontalRaySpecificOverrides));

		// 3. Merge the user's provided options last (User wins).
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'HorizontalLine'>>);

		// 4. Call the parent (LineToolHorizontalLine) constructor.
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			priceAxisLabelStackingManager
		);

		// 5. Override the pane view with the specific Ray view.
		this._setPaneViews([new LineToolHorizontalRayPaneView(this, this._chart, this._series)]);

		console.log(`HorizontalRay Tool created with ID: ${this.id()}`);
	}

	// NOTE: All core logic is inherited from LineToolHorizontalLine.
}