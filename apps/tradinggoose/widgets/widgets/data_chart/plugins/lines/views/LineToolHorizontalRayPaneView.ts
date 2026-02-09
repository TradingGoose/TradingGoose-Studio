// /src/views/LineToolHorizontalRayPaneView.ts

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
} from 'lightweight-charts';

import {
	BaseLineTool,
} from '../../core';

import { LineToolHorizontalLinePaneView } from './LineToolHorizontalLinePaneView';
import { LineToolHorizontalRay } from '../model/LineToolHorizontalRay';


/**
 * Pane View for the Horizontal Ray tool.
 *
 * **Inheritance Note:**
 * This class inherits directly from {@link LineToolHorizontalLinePaneView}.
 *
 * The rendering logic in the parent view is generic enough to handle both full lines and rays.
 * It checks the `options.line.extend` property (which the Horizontal Ray model sets to `{ left: false, right: true }`)
 * and calculates the start/end points of the segment accordingly. Therefore, no custom drawing logic is needed here.
 */
export class LineToolHorizontalRayPaneView<HorzScaleItem> extends LineToolHorizontalLinePaneView<HorzScaleItem> {

	/**
	 * Initializes the Horizontal Ray View.
	 *
	 * @param source - The specific Horizontal Ray model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolHorizontalRay<HorzScaleItem>, // Use the specific model class for strong typing
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
	) {
		// Call the parent constructor (LineToolHorizontalLinePaneView)
		// The parent is designed to handle the core BaseLineTool<HorzScaleItem> type.
		super(source, chart, series);
	}

	// NOTE: No methods are overridden as the inherited logic is fully reusable.
}