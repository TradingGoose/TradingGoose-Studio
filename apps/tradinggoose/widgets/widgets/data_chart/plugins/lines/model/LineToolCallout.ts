// /src/model/LineToolCallout.ts

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
	PriceAxisLabelStackingManager,
	LineEnd,
	TextOptions,
	BackgroundOptions,
	PaneCursorType
} from '../../core';

// Import the base class model and its default options structure
import { LineToolTrendLine, TrendLineOptionDefaults } from './LineToolTrendLine';
import { LineToolCalloutPaneView } from '../views/LineToolCalloutPaneView';

/**
 * Defines the specific configuration overrides that shape a Trend Line into a Callout tool.
 *
 * **Tutorial Note:**
 * A Callout is distinct from a simple line because it emphasizes text over geometry.
 * These overrides:
 * 1. **Disable Axis Labels:** Callouts are usually for annotation, not price measurement.
 * 2. **Set Cursors:** Configures distinct pointers for hovering/dragging.
 * 3. **Configure Text Defaults:** Sets up a visible background box, border, and specific padding/alignment
 *    to ensure the text is readable and "pop-out" style by default.
 * 4. **Disable Extensions:** Ensures the line is strictly a segment between the pointer and text.
 */
const CalloutSpecificOverrides = {

	defaultHoverCursor: PaneCursorType.Pointer,
	defaultDragCursor: PaneCursorType.Grabbing,
	defaultAnchorHoverCursor: PaneCursorType.Pointer,
	defaultAnchorDragCursor: PaneCursorType.Grabbing,
	notEditableCursor: PaneCursorType.NotAllowed,
	showPriceAxisLabels: false,
	showTimeAxisLabels: false,
	priceAxisLabelAlwaysVisible: false,
	timeAxisLabelAlwaysVisible: false,

	line: {
		end: { left: LineEnd.Normal, right: LineEnd.Normal }, // Default to Normal ends
		extend: { left: false, right: false }, // Callout is always a segment (the stem)
	},
	text: {
		value: 'this is some text',
		padding: 0,
		wordWrapWidth: 150,
		font: {
			color: 'rgba(255,255,255,1)',
			size: 14,
			bold: false,
			italic: false,
		},
		// Default to a visible text box background for clarity/design
		box: {
			shadow: {
				blur: 0,
				color: 'rgba(255,255,255,1)',
				offset: {
					x: 0,
					y: 0,
				},
			},
			border: {
				color: 'rgba(74,144,226,1)',
				width: 1,
				radius: 20,
				highlight: false,
				style: 0,
			},
			background: {
				color: 'rgba(19,73,133,1)',
				inflation: {
					x: 10,
					y: 10,
				},
			},
			padding: { x: 5, y: 5 },
			alignment: { vertical: 'middle', horizontal: 'center' },
			maxHeight: 500,
		}
	}
};

/**
 * Concrete implementation of the Callout drawing tool.
 *
 * **What is a Callout?**
 * A Callout connects a specific point of interest on the chart (P0, the "Pointer")
 * to a text label (P1, the "Anchor"). Unlike a Trend Line, the relationship between
 * these points is directional and semantic, not just geometric.
 *
 * **Inheritance:**
 * It extends {@link LineToolTrendLine} to inherit the underlying 2-point data structure and
 * generic text capability, but uses a specialized View (`LineToolCalloutPaneView`) to render
 * the specific "Stem + Text Box" visual style.
 */
export class LineToolCallout<HorzScaleItem> extends LineToolTrendLine<HorzScaleItem> {
	/**
	 * The unique identifier for this tool type ('Callout').
	 *
	 * @override
	 */
	public override readonly toolType: LineToolType = 'Callout';
	
	/**
	 * Defines the number of anchor points required to draw this tool.
	 *
	 * A Callout requires exactly **2 points**:
	 * 1. The target point (where the arrow/line points to).
	 * 2. The text box anchor point (where the label sits).
	 *
	 * @override
	 */
	public override readonly pointsCount: number = 2; // Inherits 2-point behavior

	/**
	 * Initializes the Callout tool.
	 *
	 * **Tutorial Note on Construction:**
	 * 1. We start with `TrendLineOptionDefaults` as a base.
	 * 2. We apply `CalloutSpecificOverrides` to turn off axis labels and set up the text box styling.
	 * 3. We apply user `options` last.
	 * 4. Crucially, we assign `LineToolCalloutPaneView` instead of the standard Trend Line view.
	 *    This swap is what actually makes the tool look like a Callout on the canvas.
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
		options: DeepPartial<LineToolOptionsInternal<'Callout'>> = {},
		points: LineToolPoint[] = [],
		priceAxisLabelStackingManager: PriceAxisLabelStackingManager<HorzScaleItem>
	) {
		// 1. Start with a deep copy of the base TrendLine defaults.
		const finalOptions = deepCopy(TrendLineOptionDefaults) as LineToolOptionsInternal<'Callout'>;
		
		// 2. Deep-copy the overrides before merging them.
		merge(finalOptions, deepCopy(CalloutSpecificOverrides));

		// 3. Merge the user's provided options last (User wins).
		merge(finalOptions, options as DeepPartial<LineToolOptionsInternal<'Callout'>>);

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
		this._setPaneViews([new LineToolCalloutPaneView(this, this._chart, this._series)]);

		console.log(`Callout Tool created with ID: ${this.id()}`);
	}

	/**
	 * Overrides the base normalization logic to **prevent** point swapping.
	 *
	 * **Why override this?**
	 * In a standard Trend Line, the order of points doesn't matter visually, so we sort them by time
	 * to simplify math. However, a Callout has strict directionality:
	 * - Point 0 is *always* the Pointer (Target).
	 * - Point 1 is *always* the Text Box location.
	 *
	 * If we allowed normalization, dragging the text box to the left of the target would swap
	 * the points, causing the text box to suddenly jump to the target's position and the pointer
	 * to jump to the text's position. Overriding this with an empty function preserves the
	 * logical relationship between the two points.
	 *
	 * @override
	 */
	public override normalize(): void {
		// Do nothing. Prevent the callout points from being swapped based on time.
	}

	// NOTE: All core logic (hitTest, shift constraints, normalize, etc.) is inherited from LineToolTrendLine.
}