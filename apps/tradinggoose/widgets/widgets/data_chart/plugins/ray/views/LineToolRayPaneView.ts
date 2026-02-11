// /src/views/LineToolRayPaneView.ts

import {
	BaseLineTool,
} from '../../core';

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
} from 'lightweight-charts';

import { LineToolTrendLinePaneView } from '../../shared/lines/views/LineToolTrendLinePaneView';
import { LineToolRay } from '../model/LineToolRay';


/**
 * Pane View for the Ray tool.
 *
 * **Inheritance Note:**
 * This class inherits directly from {@link LineToolTrendLinePaneView}.
 *
 * The core logic for drawing a 2-point line (whether segment, ray, or extended line)
 * is fully encapsulated in the parent class. The distinction for the Ray (infinite extension
 * to the right) is defined in the tool's options (`extend.right = true`). The parent view
 * reads these options and configures the renderer automatically.
 */
export class LineToolRayPaneView<HorzScaleItem> extends LineToolTrendLinePaneView<HorzScaleItem> {

	/**
	 * Initializes the Ray View.
	 *
	 * @param source - The specific Ray model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolRay<HorzScaleItem>, // Use the specific model class for strong typing
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
	) {
		// Call the parent constructor (LineToolTrendLinePaneView)
		super(source, chart, series);
	}

	// NOTE: No need to override the renderer() or _updateImpl() as the parent's logic is fully reusable.
}