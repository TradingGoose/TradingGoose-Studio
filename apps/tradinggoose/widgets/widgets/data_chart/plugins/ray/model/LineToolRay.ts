// /src/model/LineToolRay.ts

import {
	IChartApiBase,
	ISeriesApi,
	IHorzScaleBehavior,
	SeriesType,
} from 'lightweight-charts';

import {
	BaseLineTool,
	LineToolPoint,
	LineToolOptionsInternal,
	LineToolType,
	DeepPartial,
	LineToolsCorePlugin,
	merge,
	deepCopy,
	PriceAxisLabelStackingManager
} from '../../core';

// Import the base class model and its default options structure
import { LineToolTrendLine, TrendLineOptionDefaults } from '../../shared/lines/model/LineToolTrendLine';
import { LineToolRayPaneView } from '../views/LineToolRayPaneView';


/**
 * Defines the specific configuration overrides that transform a standard Trend Line into a Ray.
 *
 * **Tutorial Note:**
 * A Ray is a line that starts at a specific point (P1) and passes through a second point (P2),
 * extending infinitely in that direction.
 *
 * This override sets `line.extend.right` to `true`. The underlying renderer detects this
 * and calculates the intersection with the right edge of the chart viewport.
 */
const RaySpecificOverrides = {
	line: {
		extend: { right: true }, // Key change: Extended to the right
	}
};


/**
 * Concrete implementation of the Ray drawing tool.
 *
 * **Inheritance:**
 * It extends {@link LineToolTrendLine} directly. This is because a Ray shares the exact same
 * 2-point geometry, hit-testing, and user interaction logic as a Trend Line.
 * The only difference is the visual property of extending to infinity on one side.
 */
export class LineToolRay<HorzScaleItem> extends LineToolTrendLine<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('Ray').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'Ray';

	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * Like the Trend Line, a Ray is defined by exactly **2 points** (Origin and Direction).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 2; // Still a 2-point tool

	/**
	 * Initializes the Ray tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. **Base Defaults:** Start with `TrendLineOptionDefaults`.
	 * 2. **Subclass Overrides:** Merge `RaySpecificOverrides` (forcing `extend.right = true`).
	 * 3. **User Options:** Merge the `options` passed by the user.
	 *
	 * **View Assignment:**
	 * It assigns the `LineToolRayPaneView`. While this view currently acts just like a TrendLine view,
	 * using a specific class allows future customization of how the Ray is rendered (e.g., adding
	 * a specific end-cap only to the infinite end) without breaking the standard Trend Line.
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
		options: DeepPartial<LineToolOptionsInternal<'Ray'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// 1. Start with a deep copy of the base TrendLine defaults.
		const finalOptions = deepCopy(TrendLineOptionDefaults) as LineToolOptionsInternal<'Ray'>;
 
		// 2. Merge the RaySpecificOverrides over the base defaults.
		//    This sets the default behavior to extend right.
		merge(finalOptions, deepCopy(RaySpecificOverrides));

		// 3. Merge the user's provided options last (User wins).
		//    This ensures user options can override the default extensions if desired.
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'Ray'>>);


		// 4. Call the parent (LineToolTrendLine) constructor.
		super(
			coreApi,
			chart,
			series,
			horzScaleBehavior,
			finalOptions,
			points,
			priceAxisLabelStackingManager
		);

		// 5. Set the specific PaneView for this tool.
		this._setPaneViews([new LineToolRayPaneView(this, this._chart, this._series)]);

		console.log(`Ray Tool created with ID: ${this.id()}`);
	}

	// NOTE: All core logic (hitTest, shift constraints, normalize) is inherited from LineToolTrendLine.
}