// /src/views/LineToolArrowPaneView.ts

import {
	BaseLineTool,
} from '../../core';

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
} from 'lightweight-charts';

import { LineToolTrendLinePaneView } from './LineToolTrendLinePaneView';
import { LineToolArrow } from '../model/LineToolArrow';


/**
 * Pane View for the Arrow tool.
 *
 * **Inheritance Note:**
 * This class extends {@link LineToolTrendLinePaneView} directly.
 *
 * **Why no rendering logic?**
 * The Arrow tool is geometrically identical to a Trend Line (2 points). The distinction
 * (the arrow head) is defined purely in the Model's options (`line.end.right`).
 * The parent view's `_updateImpl` reads these options and passes them to the
 * `SegmentRenderer`, which handles drawing the arrow cap automatically. Therefore,
 * this class requires no custom drawing code.
 */
export class LineToolArrowPaneView<HorzScaleItem> extends LineToolTrendLinePaneView<HorzScaleItem> {

	/**
	 * Initializes the Arrow Pane View.
	 *
	 * @param source - The specific Arrow model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolArrow<HorzScaleItem>, // Use the specific model class for strong typing
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
	) {
		// Call the parent constructor (LineToolTrendLinePaneView)
		// We cast 'source' to the common parent type if needed, but since LineToolArrow extends 
		// LineToolTrendLine, and the pane view is designed to handle this inheritance, 
		// passing the specific model instance is fine.
		super(source, chart, series);
	}

	// NOTE: No need to override the renderer() or _updateImpl() as the parent's logic is fully reusable.
}