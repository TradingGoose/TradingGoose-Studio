// /src/types.ts

/**
 * This file contains all the core type definitions, interfaces, and enums used by the
 * lightweight-charts-line-tools-core plugin. It mirrors the V3.8 line tools build's
 * structures to ensure compatibility where needed and provides clear definitions for
 * all configuration and data objects.
 */

import { LineStyle, LineWidth, Coordinate, Nominal, Logical, IPriceScaleApi, ISeriesPrimitiveAxisView } from 'lightweight-charts';
import { DeepPartial, OmitRecursively } from './utils/helpers';
import { AnchorPoint } from './rendering/line-anchor-renderer'; 
import { Point } from './utils/geometry';

// #region LWCharts Adapters & Helpers


/**
 * A simplified interface representing the public API of a chart pane.
 * Used to identify which pane a tool is attached to and retrieve its index.
 */
export interface IPaneApi {
    paneIndex(): number;
    // Add other IPaneApi methods if your plugin needs to call them (e.g., addSeries, removeSeries)
    // For dimensions, we will use IChartWidgetBase.paneSize()
}

/**
 * Interface for the internal ChartWidget structure.
 * Provides access to pane dimensions and the underlying chart model.
 */
export interface IChartWidgetBase {

	// This method returns a list of objects that represent individual pane widgets.
    // Each pane widget object will expose a 'getSize()' method for its dimensions.
    paneWidgets(): { getSize(): Size }[]; // Returns array of objects with getSize() method
    // Add other properties/methods from ChartWidget that LineToolsCorePlugin might eventually need
    // For instance, a direct reference to the ChartModel can be useful:
    model(): any; // Return type of model() is ChartModel<HorzScaleItem> (internal type)
                  // We use 'any' here as we're defining this interface abstractly.
                  // This is a trade-off: allows compile without full ChartModel import chain.

    // If you need applyOptions or other chart-level functions on the widget, they should be added here
    // applyOptions(options: any): void; // If core-plugin calls this on _chartWidget
}

/**
 * Defines the margins (in pixels or percentages) to apply above and below
 * the visible price range during autoscaling.
 */
export interface AutoScaleMargins {
    below: number;
    above: number;
}

/**
 * Represents the calculated price range and margins required to display
 * a specific set of data or tools within the current viewport.
 */
export interface AutoscaleInfo {
    priceRange: any; // Simplified: type should be PriceRange, but not strictly necessary here.
    margins?: AutoScaleMargins;
}

/**
 * Internal interface for objects that calculate autoscale information.
 * Includes methods to retrieve the raw `AutoscaleInfo` structure.
 */
export interface AutoscaleInfoImpl {
    priceRange(): any; // Simplified
    margins(): AutoScaleMargins | null;
    toRaw(): AutoscaleInfo;
}

/**
 * Represents the first value in a data series, linking a numerical value
 * to a specific logical time point. Used for percentage-based scaling.
 */
// From LWCharts model/price-data-source.ts
export interface FirstValue {
    value: number;
    timePoint: Logical;
}

/**
 * Interface for formatting price values into strings.
 * Used by axis views to generate the labels displayed on the price scale.
 */
export interface IPriceFormatter {
    format(price: number): string;
    formatTickmarks(prices: readonly number[]): string[];
}

/**
 * Represents a data source attached to the chart model.
 * A data source is responsible for providing renderable views (pane, price axis, time axis)
 * and calculating its own autoscale requirements.
 */
export interface IDataSource {
    priceScale(): IPriceScaleApi | null;
    zorder(): number;
    setZorder(value: number): void;
    updateAllViews(): void;
    priceAxisViews(): readonly IPriceAxisView[];
    paneViews(): readonly IPaneView[];
    timeAxisViews(): readonly ITimeAxisView[];
    visible(): boolean;
    labelPaneViews?(): readonly IPaneView[];
    topPaneViews?(): readonly IPaneView[];
    autoscaleInfo(startTimePoint: Logical, endTimePoint: Logical): AutoscaleInfo | null; // Ensure this line is present and correct
    base(): number;
    firstValue(): FirstValue | null;
    formatter(): IPriceFormatter;
    priceLineColor(lastBarColor: string): string;
    model(): any; // Reference to Chart Model, as needed by PriceDataSource
}

/**
 * A nominal type representing a distinct index within the Time Scale's logical range.
 * Used to ensure type safety when handling time scale indices.
 */
export type TimePointIndex = Nominal<number, 'TimePointIndex'>;

// #endregion LWCharts Adapters & Helpers



// #region Geometric Enums & Basic Types

/**
 * A basic interface representing a 2D point with x and y coordinates.
 */
export interface IPoint {
	x: number;
	y: number;
}

/**
 * Represents the dimensions (width and height) of a canvas or element.
 */
export interface Size {
	width: number;
	height: number;
}

/**
 * Defines vertical alignment options for box-like elements (e.g., text boxes).
 */
export enum BoxVerticalAlignment {
	Top = 'top',
	Middle = 'middle',
	Bottom = 'bottom',
}

/**
 * Defines horizontal alignment options for box-like elements relative to a reference point.
 */
export enum BoxHorizontalAlignment {
	Left = 'left',
	Center = 'center',
	Right = 'right',
}

/**
 * Defines the alignment of text content within its bounding box.
 */
export enum TextAlignment {
	Start = 'start',
	Center = 'center',
	End = 'end',
	Left = 'left',
	Right = 'right',
}

/**
 * Defines the shape used to join two line segments where they meet.
 * Matches standard Canvas API `lineJoin` property.
 */
export enum LineJoin {
	Bevel = 'bevel',
	Round = 'round',
	Miter = 'miter',
}

/**
 * Defines the shape used to draw the end points of lines.
 * Matches standard Canvas API `lineCap` property.
 */
export enum LineCap {
	Butt = 'butt',
	Round = 'round',
	Square = 'square',
}

/**
 * Defines specific decorative shapes to render at the start or end of a line tool
 * (e.g., Arrow heads or Circles).
 */
export enum LineEnd {
	Normal,
	Arrow,
	Circle,
}

// #endregion Geometric Enums & Basic Types


// #region Shared Option Structures

/**
 * Configuration for extending lines infinitely in either direction.
 */
export interface ExtendOptions {
	right: boolean;
	left: boolean;
}

/**
 * Configuration for decorative shapes (like arrows) at the start or end of a line.
 */
export interface EndOptions {
	left: LineEnd;
	right: LineEnd;
}

/**
 * Visual configuration for drop shadows applied to shapes or text boxes.
 */
export interface ShadowOptions {
	blur: number;
	color: string;
	offset: IPoint;
}

/**
 * Configuration for drawing borders around shapes, including stroke style, width, and corner radius.
 */
export interface BorderOptions {
	color: string;
	width: number;
	radius: number | number[];
	highlight: boolean;
	style: LineStyle;
}

/**
 * Configuration for background fills, including color and optional inflation (padding) beyond the defined points.
 */
export interface BackgroundOptions {
	color: string;
	inflation: IPoint;
}

/**
 * Grouping interface for defining both vertical and horizontal alignment of a box.
 */
export interface BoxAlignmentOptions {
	vertical: BoxVerticalAlignment;
	horizontal: BoxHorizontalAlignment;
}

/**
 * Configuration for text typography, including family, size, color, and weight.
 */
export interface TextFontOptions {
	color: string;
	size: number;
	bold: boolean;
	italic: boolean;
	family: string;
}

/**
 * Comprehensive configuration for the container box surrounding text, including borders, background, and alignment.
 */
export interface TextBoxOptions {
	alignment: BoxAlignmentOptions;
	angle: number;
	scale: number;
	offset?: IPoint;
	padding?: IPoint;
	maxHeight?: number;
	shadow?: ShadowOptions;
	border?: BorderOptions;
	background?: BackgroundOptions;
}

/**
 * The master configuration object for text elements, combining the text content value with font and box styling.
 */
export interface TextOptions {
	value: string;
	alignment: TextAlignment;
	font: TextFontOptions;
	box: TextBoxOptions;
	padding: number;
	wordWrapWidth: number;
	forceTextAlign: boolean;
	forceCalculateMaxLineWidth: boolean;
}

/**
 * Standard configuration for line drawing, encompassing color, width, style, end decorations, and infinite extension.
 */
export interface LineOptions {
	color: string;
	width: number;
	style: LineStyle;
	join: LineJoin;
	cap: LineCap;
	end: EndOptions;
	extend: ExtendOptions;
}

/**
 * Configuration specific to rectangle shapes, defining background fill, borders, and horizontal extension.
 */
export interface RectangleOptions {
	background: Omit<BackgroundOptions, 'inflation'>;
	border: Omit<BorderOptions, 'highlight'>;
	extend: ExtendOptions;
}

/**
 * Configuration specific to circle shapes, defining background fill and borders.
 */
export interface CircleOptions {
	background: Omit<BackgroundOptions, 'inflation'>;
	border: Omit<BorderOptions, 'radius' | 'highlight'>;
}

/**
 * Configuration specific to triangle shapes, defining background fill and borders.
 */
export interface TriangleOptions {
	background: Omit<BackgroundOptions, 'inflation'>;
	border: Omit<BorderOptions, 'radius' | 'highlight'>;
}

// #endregion Shared Option Structures



// #region Specific Tool Option Structures


/**
 * Configuration for the Long/Short Position tool.
 * Defines the appearance of the profit/loss rectangles and their associated text labels.
 */
export interface LongShortPositionOptions {
	entryStopLossRectangle: RectangleOptions;
	entryStopLossText: TextOptions;
	entryPtRectangle: RectangleOptions;
	entryPtText: TextOptions;
	showAutoText: boolean;
}

/**
 * Configuration for the Price Range tool.
 * Controls the rectangle, center/boundary lines, and the visibility of price labels.
 */
export interface PriceRangeOptions {
	rectangle: RectangleOptions;
	verticalLine: LineOptions;
	horizontalLine: LineOptions;
	showCenterHorizontalLine: boolean;
	showCenterVerticalLine: boolean;
	showTopPrice: boolean;
	showBottomPrice: boolean;
}

/**
 * Represents a single aggregated data point (price level) for Market Depth visualization.
 */
export interface MarketDepthSingleAggregatesData {
	EarliestTime: string;
	LatestTime: string;
	Side: string;
	Price: string;
	TotalSize: string;
	BiggestSize: string;
	SmallestSize: string;
	NumParticipants: number;
	TotalOrderCount: number;
}

/**
 * Container for the full set of Bids and Asks data used by the Market Depth tool.
 */
export interface MarketDepthAggregatesData {
	Bids: MarketDepthSingleAggregatesData[];
	Asks: MarketDepthSingleAggregatesData[];
}

/**
 * Configuration for the Market Depth tool.
 * Includes visual settings (colors, line widths) and the underlying data source.
 */
export interface MarketDepthOptions {
	lineWidth: number;
	lineStyle: LineStyle;
	lineOffset: number;
	lineLength: number;
	lineBidColor: string;
	lineAskColor: string;
	totalBidAskCalcMethod: string;
	timestampStartOffset: number;
	marketDepthData: MarketDepthAggregatesData;
}

/**
 * Configuration for a single level within a Fibonacci Retracement tool.
 * Defines the coefficient (e.g., 0.618), color, and label settings.
 */
export interface FibRetracementLevel {
	coeff: number;
	color: string;
	opacity: number;
	distanceFromCoeffEnabled: boolean;
	distanceFromCoeff: number;
}

/**
 * Defines a conditional order logic attached to specific Fibonacci levels.
 * Used for strategy planning within the Fibonacci tool.
 */
export interface FibBracketOrder {
	uniqueId: string | null;
	conditionLevelCoeff: number | null;
	conditionLevelPrice: number;
	entryLevelCoeff: number | null;
	entryLevelPrice: number;
	stopMethod: 'fib' | 'price' | 'points';
	stopLevelCoeff: number | null;
	stopPriceInput: number | null;
	stopPointsInput: number | null;
	finalStopPrice: number;
	ptMethod: 'fib' | 'price' | 'points';
	ptLevelCoeff: number | null;
	ptPriceInput: number | null;
	ptPointsInput: number | null;
	finalPtPrice: number;
	isMoveStopToEnabled: boolean;
	moveStopToMethod: 'fib' | 'price' | 'points';
	moveStopToLevelCoeff: number | null;
	moveStopToPriceInput: number | null;
	moveStopToPointsInput: number | null;
	finalMoveStopToPrice: number;
	triggerBracketUniqueId: string | null;
}

/**
 * Encapsulates the complete trading strategy configuration (entries, stops, targets)
 * associated with a Fibonacci Retracement tool.
 */
export interface FibRetracementTradeStrategy {
	enabled: boolean;
	longOrShort: 'long' | 'short' | 'neutral' | '';
	fibBracketOrders: FibBracketOrder[];
}

/**
 * The base configuration interface shared by all line tools.
 * Includes properties for visibility, interactivity (editable), and axis label behavior.
 */
export interface LineToolOptionsCommon {
	visible: boolean;
	editable: boolean;
	ownerSourceId?: string;
	defaultHoverCursor?: PaneCursorType;
	defaultDragCursor?: PaneCursorType;
	defaultAnchorHoverCursor?: PaneCursorType;
	defaultAnchorDragCursor?: PaneCursorType; 
	showPriceAxisLabels: boolean;
	showTimeAxisLabels: boolean;
	priceAxisLabelAlwaysVisible: boolean;
	timeAxisLabelAlwaysVisible: boolean;
	[key: string]: any;
}

/**
 * Specific options for Trend Line tools, combining standard text settings with line styling.
 */
export interface LineToolTrendLineOptions { text: TextOptions; line: Omit<LineOptions, 'join' | 'cap'>; }

/**
 * Specific options for the Callout tool.
 * Configures the text label and the pointer line connecting it to a specific point.
 */
export interface LineToolCalloutOptions { text: TextOptions; line: Omit<LineOptions, 'join' | 'cap'>; }

/**
 * Specific options for the Horizontal Line tool.
 * Configures the infinite horizontal line and its optional text label.
 */
export interface LineToolHorizontalLineOptions { text: TextOptions; line: Omit<LineOptions, 'cap' | 'join'>; }

/**
 * Specific options for the Vertical Line tool.
 * Configures the infinite vertical line and its optional text label.
 */
export interface LineToolVerticalLineOptions { text: TextOptions; line: Omit<LineOptions, 'cap' | 'join' >; }

/**
 * Specific options for the Cross Line tool.
 * Configures the visual style of the intersecting horizontal and vertical lines.
 */
export interface LineToolCrossLineOptions { line: Omit<LineOptions, 'cap' | 'join'>; }

/**
 * Specific options for the Rectangle tool.
 * Configures the rectangle shape (border/fill) and an attached text label.
 */
export interface LineToolRectangleOptions { text: TextOptions; rectangle: RectangleOptions; }

/**
 * Specific options for the Circle tool.
 * Configures the circle shape (border/fill) and an attached text label.
 */
export interface LineToolCircleOptions { text: TextOptions; circle: CircleOptions; }

/**
 * Specific options for the Price Range tool.
 * Configures the range visualization components and the associated text label.
 */
export interface LineToolPriceRangeOptions { text: TextOptions; priceRange: PriceRangeOptions; }

/**
 * Specific options for the Market Depth tool.
 * Configures the depth visualization lines/colors and the text label.
 */
export interface LineToolMarketDepthOptions { text: TextOptions; marketDepth: MarketDepthOptions; }

/**
 * Specific options for the Triangle tool.
 * Configures the triangle shape (border/fill).
 */
export interface LineToolTriangleOptions { triangle: TriangleOptions; }

/**
 * Specific options for the Text tool.
 * Configures the content and styling of the standalone text element.
 */
export interface LineToolTextOptions { text: TextOptions; }

/**
 * Specific options for the Brush tool.
 * Configures the freehand line style and optional background fill.
 */
export interface LineToolBrushOptions { line: Omit<LineOptions, 'end' | 'extend'>; background?: Omit<BackgroundOptions, 'inflation'>; }

/**
 * Specific options for the Highlighter tool.
 * Similar to the Brush tool but typically defaults to translucent colors for highlighting.
 */
export interface LineToolHighlighterOptions { line: Omit<LineOptions, 'end' | 'extend'>; background?: Omit<BackgroundOptions, 'inflation'>; }

/**
 * Specific options for the Path (Polyline) tool.
 * Configures the line style connecting the sequence of points.
 */
export interface LineToolPathOptions { line: Omit<LineOptions, 'cap' | 'extend' | 'join'>; }

/**
 * Specific options for the Fibonacci Retracement tool.
 * Configures the trend line, the retracement levels (coefficients/colors), and optional trading strategy displays.
 */
export interface LineToolFibRetracementOptions { line: Omit<LineOptions, 'extend' | 'join' | 'color' | 'cap' | 'end'>; extend: ExtendOptions; levels: FibRetracementLevel[]; tradeStrategy: FibRetracementTradeStrategy; }

/**
 * Specific options for the Parallel Channel tool.
 * Configures the styling for the channel borders, the middle line, and the channel background.
 */
export interface LineToolParallelChannelOptions { 
	channelLine: Omit<LineOptions, 'cap' | 'extend' | 'join' | 'end'>;
	middleLine: Omit<LineOptions, 'cap' | 'extend' | 'join' | 'end'>;
	showMiddleLine: boolean;
	extend: ExtendOptions;
	background?: Omit<BackgroundOptions, 'inflation'>;
}


/**
 * A utility type that combines the common options (visibility, interactivity)
 * with the specific options structure for a given tool type `T`.
 */
export type LineToolOptions<T> = T & LineToolOptionsCommon;

/**
 * A utility type representing a Deep Partial version of the complete tool options.
 * This is used for input parameters (like `applyOptions`), allowing users to update
 * specific nested properties without providing the entire object.
 */
export type LineToolPartialOptions<T> = DeepPartial<T & LineToolOptionsCommon>;

/**
 * Alias for the complete options structure of a Path tool.
 */
export type PathToolOptions = LineToolOptions<LineToolPathOptions>;

/**
 * Alias for the complete options structure of a Brush tool.
 */
export type BrushToolOptions = LineToolOptions<LineToolBrushOptions>;

/**
 * Alias for the complete options structure of a Highlighter tool.
 */
export type HighlighterToolOptions = LineToolOptions<LineToolHighlighterOptions>;

/**
 * Alias for the complete options structure of a Text tool.
 */
export type TextToolOptions = LineToolOptions<LineToolTextOptions>;

/**
 * Alias for the complete options structure of a Trend Line tool.
 */
export type TrendLineToolOptions = LineToolOptions<LineToolTrendLineOptions>;

/**
 * Alias for the complete options structure of a Callout tool.
 */
export type CalloutToolOptions = LineToolOptions<LineToolCalloutOptions>;

/**
 * Alias for the complete options structure of a Cross Line tool.
 */
export type CrossLineToolOptions = LineToolOptions<LineToolCrossLineOptions>;

/**
 * Alias for the complete options structure of a Vertical Line tool.
 */
export type VerticalLineToolOptions = LineToolOptions<LineToolVerticalLineOptions>;

/**
 * Alias for the complete options structure of a Horizontal Line tool.
 */
export type HorizontalLineToolOptions = LineToolOptions<LineToolHorizontalLineOptions>;

/**
 * Alias for the complete options structure of a Rectangle tool.
 */
export type RectangleToolOptions = LineToolOptions<LineToolRectangleOptions>;

/**
 * Alias for the complete options structure of a Long/Short Position tool.
 */
export type LongShortPositionToolOptions = LineToolOptions<LongShortPositionOptions>;

/**
 * Alias for the complete options structure of a Circle tool.
 */
export type CircleToolOptions = LineToolOptions<LineToolCircleOptions>;

/**
 * Alias for the complete options structure of a Price Range tool.
 */
export type PriceRangeToolOptions = LineToolOptions<LineToolPriceRangeOptions>;

/**
 * Alias for the complete options structure of a Market Depth tool.
 */
export type MarketDepthToolOptions = LineToolOptions<LineToolMarketDepthOptions>;

/**
 * Alias for the complete options structure of a Triangle tool.
 */
export type TriangleToolOptions = LineToolOptions<LineToolTriangleOptions>;

/**
 * Alias for the complete options structure of a Parallel Channel tool.
 */
export type ParallelChannelToolOptions = LineToolOptions<LineToolParallelChannelOptions>;

/**
 * Alias for the complete options structure of a Fibonacci Retracement tool.
 */
export type FibRetracementToolOptions = LineToolOptions<LineToolFibRetracementOptions>;



// #endregion Specific Tool Option Structures


// #region Type Maps for Dynamic Instantiation


/**
 * A central mapping interface that links every valid Line Tool string identifier (key)
 * to its corresponding full options structure (value).
 *
 * This interface is the "source of truth" for the plugin's type system, allowing
 * TypeScript to automatically infer the correct options type based on the tool name provided.
 */
export interface LineToolOptionsMap {
	FibRetracement: FibRetracementToolOptions;
	ParallelChannel: ParallelChannelToolOptions;
	HorizontalLine: HorizontalLineToolOptions;
	VerticalLine: VerticalLineToolOptions;
	Highlighter: HighlighterToolOptions;
	CrossLine: CrossLineToolOptions;
	TrendLine: TrendLineToolOptions;
	Callout: CalloutToolOptions;
	Rectangle: RectangleToolOptions;
	LongShortPosition: LongShortPositionToolOptions;
	Circle: CircleToolOptions;
	PriceRange: PriceRangeToolOptions;
	Triangle: TriangleToolOptions;
	Brush: BrushToolOptions;
	Path: PathToolOptions;
	Text: TextToolOptions;
	Ray: TrendLineToolOptions;
	Arrow: TrendLineToolOptions;
	ExtendedLine: TrendLineToolOptions;
	HorizontalRay: HorizontalLineToolOptions;
	MarketDepth: MarketDepthToolOptions;
}

/**
 * A mapped type that creates a version of {@link LineToolOptionsMap} where all options
 * are deep-partial.
 *
 * This is primarily used for API methods that accept user configuration (like `addLineTool`),
 * allowing users to provide only the specific properties they want to customize without
 * needing to supply the entire configuration object.
 */
export type LineToolPartialOptionsMap = {
	[K in keyof LineToolOptionsMap]: LineToolPartialOptions<LineToolOptionsMap[K]>;
};

/**
 * A utility lookup type that retrieves the full, strict options interface for a specific
 * tool type `T`.
 *
 * @typeParam T - The string identifier of the tool (e.g., 'Rectangle').
 */
export type LineToolOptionsInternal<T extends LineToolType> = LineToolOptionsMap[T];

/**
 * A string union type representing the names of all available line tools registered
 * in the system (e.g., `'TrendLine' | 'Rectangle' | 'FibRetracement'`).
 *
 * Use this type when specifying the `type` argument for methods like `addLineTool`.
 */
export type LineToolType = keyof LineToolOptionsMap;


// #endregion Type Maps for Dynamic Instantiation




// #region Canvas & Rendering Interfaces


/**
 * Defines where in the visual layer stack a renderer should be executed relative to the series.
 *
 * - `'bottom'`: Drawn behind the series data.
 * - `'normal'`: Drawn at the same level as the series (default).
 * - `'top'`: Drawn above the series data.
 */
export type PrimitivePaneViewZOrder = 'bottom' | 'normal' | 'top';

/**
 * The fundamental interface for an object that draws on the chart's pane.
 * This mirrors the Lightweight Charts `IPrimitivePaneRenderer` interface.
 *
 * Specific renderers (like `SegmentRenderer` or `RectangleRenderer`) implement this to
 * handle the actual Canvas 2D API calls.
 */
export interface IPrimitivePaneRenderer {
	/**
	 * Method to draw the main content of the element.
	 * @param target - The rendering target provided by Lightweight Charts.
	 */
	draw(target: CanvasRenderingTarget2D): void;
	/**
	 * Optional method to draw the background.
	 * @param target - The rendering target provided by Lightweight Charts.
	 */
	drawBackground?(target: CanvasRenderingTarget2D): void;
    // Note: hitTest is part of IPaneRenderer in our core-plugin, not IPrimitivePaneRenderer in LWChart's internal definitions
	/**
	 * Optional method to clear/reset the renderer's internal state.
	 * Used during tool destruction to prevent memory leaks or stale references.
	 */
	clear?(): void;
}

/**
 * Interface for a view component that provides a renderer for a specific chart pane.
 *
 * Objects returned by `BaseLineTool.paneViews()` must conform to this interface.
 * It links the tool's data model to a visual renderer and defines the Z-order.
 */
export interface IPaneView { // Renaming to IPrimitivePaneView as per LWCharts standard
	/**
	 * Returns a renderer object to be used for drawing this view.
	 * @returns An `IPrimitivePaneRenderer` object, or `null` if nothing to draw.
	 */
	renderer(): IPrimitivePaneRenderer | null;
	/**
	 * Defines where in the visual layer stack the renderer should be executed.
	 * @returns The desired position in the visual layer stack.
	 */
	zOrder?(): PrimitivePaneViewZOrder;
}

/**
 * An extended `IPaneView` that supports explicit update signals.
 *
 * This allows the tool to notify specific views that their data or options have changed
 * and internal caches (like calculated screen coordinates) should be invalidated before the next draw.
 */
export interface IUpdatablePaneView extends IPaneView {
	/**
	 * Signals that the view's data or state has changed and it needs to be updated.
	 * @param updateType - Optional type of update ('data' | 'other' | 'options').
	 */
	update(updateType?: 'data' | 'other' | 'options'): void;
}


/**
 * Context provided to a renderer callback when drawing in **media coordinates** (CSS pixels).
 *
 * In this scope, 1 unit equals 1 CSS pixel. The canvas logic handles the device pixel ratio scaling
 * automatically. This is the preferred scope for most line tool drawing operations.
 */
export interface MediaCoordinatesRenderingScope {
	context: CanvasRenderingContext2D;
	mediaSize: Size;
}

/**
 * Context provided to a renderer callback when drawing in **bitmap coordinates** (physical device pixels).
 *
 * In this scope, coordinates map 1:1 to the canvas buffer pixels. You must manually account for
 * `horizontalPixelRatio` and `verticalPixelRatio` to ensure sharp rendering on high-DPI screens.
 * Used for crisp rendering of 1px lines or pixel-perfect alignment.
 */
export interface BitmapCoordinatesRenderingScope {
	context: CanvasRenderingContext2D;
	bitmapSize: Size;
	horizontalPixelRatio: number;
	verticalPixelRatio: number;
	mediaSize: Size; // Often included for reference even in bitmap space
}

/**
 * A wrapper around the HTML Canvas 2D Context provided by Lightweight Charts to plugins.
 *
 * It abstracts the complexity of high-DPI rendering by providing methods to execute drawing code
 * in either a "Media" (CSS pixel) or "Bitmap" (Physical pixel) coordinate space.
 */
export interface CanvasRenderingTarget2D {
	/**
	 * Executes drawing logic within the media coordinate space.
	 * @param callback - A function receiving a `MediaCoordinatesRenderingScope`.
	 */
	useMediaCoordinateSpace(callback: (scope: MediaCoordinatesRenderingScope) => void): void;

	/**
	 * Executes drawing logic within the bitmap coordinate space.
	 * @param callback - A function receiving a `BitmapCoordinatesRenderingScope`.
	 */
	useBitmapCoordinateSpace(callback: (scope: BitmapCoordinatesRenderingScope) => void): void;
}

/**
 * An extended renderer interface that adds Hit Testing capabilities.
 *
 * While `IPrimitivePaneRenderer` handles drawing, `IPaneRenderer` allows the plugin's
 * `InteractionManager` to determine if a mouse event occurred over the rendered object
 * via the `hitTest` method.
 */
export interface IPaneRenderer extends IPrimitivePaneRenderer {
	/**
	 * Performs a hit test on the rendered object. Returns a hit-test result if the coordinates fall within the object.
	 * This must be implemented by concrete renderers.
	 * @param x - The X coordinate to test.
	 * @param y - The Y coordinate to test.
	 * @returns A `HitTestResult` object if hit, otherwise `null`.
	 */
	hitTest?(x: Coordinate, y: Coordinate): HitTestResult<any> | null;
}

/**
 * Enum defining the standard CSS cursor styles supported by the chart.
 *
 * These values are returned by `hitTest` to instruct the chart to change the mouse cursor
 * (e.g., to 'pointer', 'grabbing', or 'ew-resize') when hovering over a tool.
 */
export enum PaneCursorType {
	Default = 'default',
	Crosshair = 'crosshair',
	Pointer = 'pointer',
	Grabbing = 'grabbing',
	VerticalResize = 'n-resize',
	HorizontalResize = 'e-resize',
	DiagonalNeSwResize = 'nesw-resize',
	DiagonalNwSeResize = 'nwse-resize',
	NotAllowed = 'not-allowed',
	Move = 'move',
	Auto = 'auto',
	None = 'none',
	ContextMenu = 'context-menu',
	Help = 'help',
	Progress = 'progress',
	Wait = 'wait',
	Cell = 'cell',
	Text = 'text',
	VerticalText = 'vertical-text',
	Alias = 'alias',
	Copy = 'copy',
	NoDrop = 'no-drop',
	Grab = 'grab',
	EResize = 'e-resize',
	NResize = 'n-resize',
	NeResize = 'ne-resize',
	NwResize = 'nw-resize',
	SResize = 's-resize',
	SeResize = 'se-resize',
	SwResize = 'sw-resize',
	WResize = 'w-resize',
	EwResize = 'ew-resize',
	NsResize = 'ns-resize',
	NeswResize = 'nesw-resize',
	NwseResize = 'nwse-resize',
	ColResize = 'col-resize',
	RowResize = 'row-resize',
	AllScroll = 'all-scroll',
	ZoomIn = 'zoom-in',
	ZoomOut = 'zoom-out',	
}

/**
 * Represents the successful result of a hit test on a rendered object.
 *
 * It encapsulates:
 * 1. The `type` of hit (e.g., did we hit an anchor point or the body?).
 * 2. Associated `data` (e.g., which specific anchor point index was clicked?).
 */
export class HitTestResult<T> {
	private _data: T | null;
	private _type: HitTestType;

	public constructor(type: HitTestType, data?: T) {
		this._type = type;
		this._data = data || null;
	}

	public type(): HitTestType {
		return this._type;
	}

	public data(): T | null {
		return this._data;
	}
}

/**
 * Categorizes the nature of a hit test result.
 *
 * - `Regular`: General hover (defaults to pointer).
 * - `MovePoint`: Hit an anchor or handle intended for resizing/moving a specific point.
 * - `MovePointBackground`: Hit the body/background intended for dragging the entire tool.
 * - `ChangePoint`: Specific variation often used for anchor resizing.
 * - `Custom`: Generic fallback for specialized tools.
 */
export enum HitTestType {
    Regular = 1,
    MovePoint = 2,
	MovePointBackground = 3,
    ChangePoint = 4,
    Custom = 5
}

// #endregion Canvas & Rendering Interfaces


// #region Axis Views & Renderers

/**
 * Interface for a text measurement caching utility.
 *
 * Used by axis renderers to optimize performance by avoiding repetitive canvas `measureText` calls
 * for strings that haven't changed (e.g., price labels during a drag operation).
 */
export interface TextWidthCache {
	measureText(ctx: CanvasRenderingContext2D, text: string, optimizationReplacementRe?: RegExp): number;
	reset(): void;
}

/**
 * Shared data required by a Price Axis View renderer.
 *
 * Contains properties that define the physical position and base styling of the label,
 * including the critical `coordinate` and the optional `fixedCoordinate` used for stacking.
 */
export interface PriceAxisViewRendererCommonData {
	activeBackground?: string;
	background: string;
	color: string;
	coordinate: number;
	fixedCoordinate?: number;
}

/**
 * Specific content data for a single Price Axis View label.
 *
 * Defines the actual text to display, visibility flags, and border colors.
 * This is separated from `CommonData` to allow for split views (e.g., axis label vs. pane label).
 */
export interface PriceAxisViewRendererData {
	visible: boolean;
	text: string;
	tickVisible: boolean;
	moveTextToInvisibleTick: boolean;
	borderColor: string;
	lineWidth?: number;
}

/**
 * Visual styling configuration for Price Axis labels.
 *
 * Encapsulates font settings, padding, border sizes, and tick mark dimensions.
 * Typically derived from the chart's global layout options.
 */
export interface PriceAxisViewRendererOptions {
	baselineOffset: number;
	borderSize: number;
	font: string;
	fontFamily: string;
	color: string;
	fontSize: number;
	paddingBottom: number;
	paddingInner: number;
	paddingOuter: number;
	paddingTop: number;
	tickLength: number;
}

/**
 * Interface for a renderer responsible for drawing labels on the Price Axis.
 *
 * Implementing classes must provide a `draw` method to render the label onto the canvas target
 * and a `height` method to assist with layout calculations.
 */
export interface IPriceAxisViewRenderer {
	draw(
		target: CanvasRenderingTarget2D,
		rendererOptions: PriceAxisViewRendererOptions,
		textWidthCache: TextWidthCache,
		width: number,
		align: 'left' | 'right'
	): void;

	height(rendererOptions: PriceAxisViewRendererOptions, useSecondLine: boolean): number;
	// FIX: Make commonData optional to accommodate renderers that might not need it,
	// like PriceAxisBackgroundRenderer.
	setData(data: PriceAxisViewRendererData, commonData?: PriceAxisViewRendererCommonData): void;
}

/**
 * Visual styling configuration for Time Axis labels.
 *
 * Encapsulates font settings, padding, and border sizes specific to the time scale.
 */
export interface TimeAxisViewRendererOptions {
	baselineOffset: number;
	borderSize: number;
	font: string;
	fontSize: number;
	paddingBottom: number;
	paddingTop: number;
	tickLength: number;
	paddingHorizontal: number;
	widthCache?: TextWidthCache;
}

/**
 * Data payload required to render a label on the Time Axis.
 *
 * Includes the text, x-coordinate, dimensions, and colors for the specific time point.
 */
export interface TimeAxisViewRendererData {
	width: number;
	text: string;
	coordinate: number;
	color: string;
	background: string;
	visible: boolean;
}


/**
 * Interface for a renderer responsible for drawing labels on the Time Axis.
 *
 * Implementing classes handle the drawing logic for the time scale labels,
 * typically reacting to the tool's anchor points.
 */
export interface ITimeAxisViewRenderer {
	draw(target: CanvasRenderingTarget2D, rendererOptions: TimeAxisViewRendererOptions): void;
	setData(data: TimeAxisViewRendererData): void;
	height(rendererOptions: TimeAxisViewRendererOptions): number;
}

/**
 * A strictly typed interface for a Price Axis View component.
 *
 * This acts as the bridge between a Line Tool's data model and the visual renderer.
 * It extends the standard `ISeriesPrimitiveAxisView` but enforces the implementation of
 * specific getters (like `text()`, `coordinate()`) and the renderer factory method.
 */
export interface IPriceAxisView extends ISeriesPrimitiveAxisView {
    update(): void;
    getRenderer(): IPriceAxisViewRenderer;
    getPaneRenderer(): IPriceAxisViewRenderer; // For titles on the pane side
    height(rendererOptions: PriceAxisViewRendererOptions, useSecondLine: boolean): number;
    getFixedCoordinate(): Coordinate;
    setFixedCoordinate(value: Coordinate): void;

    // Explicitly re-declare methods from ISeriesPrimitiveAxisView to ensure implementing classes provide them.
    text(): string;
    coordinate(): Coordinate;
    textColor(): string;
    backColor(): string;
    visible(): boolean;
    // tickVisible is optional on ISeriesPrimitiveAxisView, so we don't force it here unless needed internally for all.
}

/**
 * A strictly typed interface for a Time Axis View component.
 *
 * Similar to `IPriceAxisView`, this manages the lifecycle and data provision for
 * labels appearing on the horizontal Time Scale.
 */
export interface ITimeAxisView extends ISeriesPrimitiveAxisView {
    update(): void;
    getRenderer(): ITimeAxisViewRenderer; // For time axis renderer

    // Explicitly re-declare methods from ISeriesPrimitiveAxisView.
    text(): string;
    coordinate(): Coordinate;
    textColor(): string;
    backColor(): string;
    visible(): boolean;
    // tickVisible is optional on ISeriesPrimitiveAxisView.
}


// #endregion Axis Views & Renderers



// #region Pane Renderer Data Structures

/**
 * Data required by the `RectangleRenderer` to draw a rectangular shape.
 *
 * This structure defines the geometry (via two defining points), styling (background/border),
 * and behavior (extensions, cursors) for tools like Rectangles, Price Ranges, or specialized
 * fills like Fibonacci bands.
 */
export interface RectangleRendererData {
	points: [AnchorPoint, AnchorPoint]; // Top-left and bottom-right defining points
	background?: { color: string }; 
	border?: { color: string; width: number; style: LineStyle; radius?: number | number[]; highlight?: boolean };
	extend?: { left: boolean; right: boolean };
	hitTestBackground?: boolean;
	toolDefaultHoverCursor?: PaneCursorType;
	toolDefaultDragCursor?: PaneCursorType;
}

/**
 * Data required by the `CircleRenderer` to draw a circle.
 *
 * The geometry is defined by two points: the Center point and a Radius point (a point on the circumference).
 * It includes options for filling the circle and stroking the border.
 */
export interface CircleRendererData {
	points: [Point, Point]; // [0] Center Point, [1] Radius Point (in screen coordinates)
	background?: { color: string };
	border?: { color: string; width: number; style: LineStyle; };
	hitTestBackground?: boolean;
	toolDefaultHoverCursor?: PaneCursorType;
	toolDefaultDragCursor?: PaneCursorType;
}

/**
 * Data required by the `TextRenderer` to draw advanced text elements.
 *
 * Unlike simple canvas text, this structure supports rich text features including:
 * - A surrounding box with border/background.
 * - Word wrapping.
 * - Rotation.
 * - Custom padding and alignment relative to the anchor points.
 */
export interface TextRendererData {
	text: TextOptions;
	points: Point[];
	hitTestBackground?: boolean;
	toolDefaultHoverCursor?: PaneCursorType;
	toolDefaultDragCursor?: PaneCursorType;
}

/**
 * Configuration used to instantiate interaction anchors (resize handles).
 *
 * This data is passed to the `createLineAnchor` factory method in views. It defines
 * where the anchors are located and what cursor should be displayed when hovering over them.
 */
export interface LineAnchorCreationData {
	points: AnchorPoint[];
	defaultAnchorHoverCursor?: PaneCursorType;
	defaultAnchorDragCursor?: PaneCursorType;
}

// #endregion Pane Renderer Data Structures




// #region  Interaction & Internal Logic


/**
 * Defines the current state of user interaction with a line tool.
 *
 * This is used by the `InteractionManager` and the tool's constraint logic (e.g., `getShiftConstrainedPoint`)
 * to determine how input should be handled.
 *
 * - `Creation`: The user is actively drawing the tool (placing points).
 * - `Editing`: The user is dragging a specific anchor point to resize/reshape the tool.
 * - `Move`: The user is dragging the entire tool body to translate it.
 */
export enum InteractionPhase {
    /** The tool is currently being drawn by the user (ghost point is active). */
    Creation = 'creation',
    /** A point anchor is being dragged to modify the tool's geometry. */
    Editing = 'editing',
    /** The entire tool is being dragged/translated. (Shift constraint usually ignored here). */
    Move = 'move',
}

/**
 * Indicates which logical axis is currently controlling a geometric snap.
 *
 * - `'time'`: Snapping to a vertical time line (X-axis).
 * - `'price'`: Snapping to a horizontal price line (Y-axis).
 * - `'none'`: No specific axis snap is active.
 */
export type SnapAxis = 'time' | 'price' | 'none';

/**
 * The result returned by a geometric constraint calculation.
 *
 * When a user holds Shift while drawing, the tool calculates a corrected position.
 * This object contains:
 * 1. `point`: The new, constrained screen coordinates.
 * 2. `snapAxis`: A hint indicating if the constraint aligned to the Time or Price axis,
 *    allowing the `InteractionManager` to perform perfect logical locking.
 */
export interface ConstraintResult {
    point: Point;
    snapAxis: SnapAxis;
}

/**
 * Defines the user action required to finish creating a specific line tool.
 *
 * - `PointCount`: Automatically finishes when the required number of points (e.g., 2 for a Rectangle) are placed.
 * - `MouseUp`: Finishes immediately when the mouse button is released (used for "Drag-to-Create" or freehand tools like Brush).
 * - `DoubleClick`: Finishes when the user double-clicks (used for Polyline/Path tools with variable point counts).
 */
export enum FinalizationMethod {
	PointCount = 'pointCount',   // Finalize when BaseLineTool.pointsCount is reached (e.g., TrendLine, Rectangle)
	MouseUp = 'mouseUp',         // Finalize on mouse-up event after drag starts (e.g., Brush, Highlighter)
	DoubleClick = 'doubleClick', // Finalize on double-click (e.g., Path)
}

/**
 * The data payload returned when a hit test succeeds on a line tool.
 *
 * It provides context to the `InteractionManager` about what specifically was hit:
 * - `pointIndex`: If an anchor was hit, this is its index. `null` if the body was hit.
 * - `suggestedCursor`: The specific CSS cursor the tool requests for this hit (e.g., 'nwse-resize').
 */
export interface LineToolHitTestData {
	pointIndex: number | null;
	suggestedCursor?: PaneCursorType;
}



/**
 * Advanced configuration for the Culling Engine (Viewability Check).
 *
 * By default, tools are culled based on their bounding box. For complex shapes (like Polylines),
 * a bounding box check might be too aggressive (hiding the tool when a segment passes through the screen
 * but the corners are off-screen).
 *
 * This interface allows tools to define specific `subSegments` to check against the viewport for accurate visibility.
 */
export interface LineToolCullingInfo {
    /**
     * An array of point index pairs [start_index, end_index] that define line segments.
     * The tool is visible if AT LEAST ONE of these segments is visible.
     * This forces the culling engine to use the robust 2-point extension logic on these segments.
     */
    subSegments?: number[][];
    
    // Add other properties later if needed (e.g., area/polygon visibility check)
}



/**
 * Internal data structure used by the `PriceAxisLabelStackingManager`.
 *
 * Contains the geometry and identification of a price axis label, allowing the manager
 * to detect collisions and calculate vertical offsets to prevent overlapping labels.
 */
export interface LabelDataForStacking {
	id: string; // Unique identifier for this specific label instance (e.g., toolId-pointIndex)
	toolId: string; // The ID of the BaseLineTool this label belongs to
	originalCoordinate: Coordinate; // The Y-coordinate the label *wants* to be at (before stacking)
	height: number; // The height of the label in pixels
	// Callback to update the label's fixed coordinate, provided by the view itself.
	// This allows the manager to tell the view where to actually draw itself.
	setFixedCoordinate: (coordinate: Coordinate | undefined) => void;
	isVisible: () => boolean; // Function to check if the label is currently visible
}

/**
 * Defines the active infinite lines for a single-point tool.
 *
 * Used by tools like "Horizontal Line", "Vertical Line", or "Cross Line".
 * Since a single point has no dimensions, this tells the culling engine that the tool actually
 * extends infinitely in the specified directions, ensuring it isn't hidden when the anchor point is off-screen.
 */
export interface SinglePointOrientation {
	horizontal: boolean;
	vertical: boolean;
}

// #endregion  Interaction & Internal Logic
 
