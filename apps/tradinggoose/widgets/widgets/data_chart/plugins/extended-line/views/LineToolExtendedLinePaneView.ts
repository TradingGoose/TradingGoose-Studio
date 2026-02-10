// /src/views/LineToolExtendedLinePaneView.ts

import {
	BaseLineTool,
	LineToolPaneView,
	CompositeRenderer,
	LineAnchorRenderer,
	SegmentRenderer,
	TextRenderer,
	Point,
	LineToolHitTestData,
	LineToolOptionsInternal,
	LineToolType,
	ExtendOptions,
	LineOptions
} from '../../core';

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
	Coordinate,
} from 'lightweight-charts';

import { LineToolTrendLinePaneView } from '../../shared/lines/views/LineToolTrendLinePaneView';
import { LineToolTrendLine } from '../../shared/lines/model/LineToolTrendLine';


/**
 * Pane View for the Extended Line tool.
 *
 * **Inheritance Note:**
 * This class inherits directly from {@link LineToolTrendLinePaneView}.
 *
 * **Why no rendering logic?**
 * An Extended Line is geometrically identical to a Trend Line (defined by 2 points).
 * The visual difference (infinite extension in both directions) is controlled entirely
 * by the tool's options (`extend: { left: true, right: true }`).
 *
 * The parent view's `_updateImpl` method passes these options to the `SegmentRenderer`,
 * which contains the mathematical logic to clip infinite lines to the viewport.
 * Therefore, this view requires no custom drawing code.
 */
export class LineToolExtendedLinePaneView<HorzScaleItem> extends LineToolTrendLinePaneView<HorzScaleItem> {

	/**
	 * Initializes the Extended Line View.
	 *
	 * @param source - The specific Extended Line model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		source: LineToolTrendLine<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
	) {
		// Call the parent constructor (LineToolTrendLinePaneView)
		super(source, chart, series);
	}

	// NOTE: No need to override the renderer() or _updateImpl() if the parent correctly
	// reads and uses the tool's options() which now contains the 'extend: { left: true, right: true }' property.
}