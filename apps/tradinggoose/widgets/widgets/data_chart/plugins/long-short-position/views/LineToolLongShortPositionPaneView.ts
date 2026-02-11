// /lightweight-charts-line-tools-long-short-position/src/views/LineToolLongShortPositionPaneView.ts

/**
 * The Pane View for the LineToolLongShortPosition tool.
 * It coordinates the rendering of the two rectangles (Risk and Reward) and the
 * associated dynamic text labels, managed by the core plugin's renderers.
 */

import {
	IChartApiBase,
	ISeriesApi,
	SeriesType,
	Coordinate,
	LineStyle,
} from 'lightweight-charts';

import {
	BaseLineTool,
	IPaneRenderer,
	RectangleRenderer,
	TextRenderer,
	CompositeRenderer,
	LineToolPaneView,
	AnchorPoint,
	LineToolOptionsInternal,
	TextRendererData,
	RectangleRendererData,
	PaneCursorType,
	LineToolHitTestData,
	HitTestResult,
	deepCopy,
	TextAlignment,
	BoxHorizontalAlignment,
	BoxVerticalAlignment,
	Point,
	DeepPartial,
	TextOptions,
	merge,
	getToolCullingState,
	OffScreenState,
	LineToolPoint,
	LineToolCullingInfo,
	RectangleOptions,
	ensureNotNull
} from '../../core';

import { LineToolLongShortPosition } from '../model/LineToolLongShortPosition';



/**
 * The Pane View for the Long/Short Position tool.
 *
 * **Tutorial Note on Logic:**
 * This view coordinates a complex multi-part visualization:
 * 1. **Risk Rectangle:** Red box defining the loss zone (Entry to Stop).
 * 2. **Reward Rectangle:** Green box defining the profit zone (Entry to Target).
 * 3. **Dynamic Labels:** Two separate text renderers that auto-calculate and display
 *    prices, distances, and R:R ratios based on the current geometry.
 *
 * It manages independent culling for the two halves to optimize performance when zooming.
 */
export class LineToolLongShortPositionPaneView<HorzScaleItem> extends LineToolPaneView<HorzScaleItem> {
	// Custom renderers for the tool's components
	/**
	 * Internal renderer for the Stop Loss (Risk) rectangle.
	 * @protected
	 */
	protected _riskRenderer: RectangleRenderer<HorzScaleItem> = new RectangleRenderer();

	/**
	 * Internal renderer for the Profit Target (Reward) rectangle.
	 * @protected
	 */
	protected _rewardRenderer: RectangleRenderer<HorzScaleItem> = new RectangleRenderer();

	/**
	 * Internal renderer for the text statistics in the Risk zone.
	 * @protected
	 */
	protected _riskLabelRenderer: TextRenderer<HorzScaleItem> = new TextRenderer();

	/**
	 * Internal renderer for the text statistics in the Reward zone.
	 * @protected
	 */
	protected _rewardLabelRenderer: TextRenderer<HorzScaleItem> = new TextRenderer();

	/**
	 * Initializes the Position Tool View.
	 *
	 * @param tool - The specific Long/Short model instance.
	 * @param chart - The Chart API.
	 * @param series - The Series API.
	 */
	public constructor(
		tool: LineToolLongShortPosition<HorzScaleItem>,
		chart: IChartApiBase<any>,
		series: ISeriesApi<SeriesType, any>,
	) {
		// Call the super constructor (LineToolPaneView) to initialize common properties
		super(tool as BaseLineTool<HorzScaleItem>, chart, series);
	}

	/**
	 * The core update logic.
	 *
	 * This method calculates the geometry for both rectangles, performs granular culling,
	 * and generates the dynamic text strings for the labels.
	 *
	 * @param height - The height of the pane.
	 * @param width - The width of the pane.
	 * @protected
	 * @override
	 */
	protected override _updateImpl(height: number, width: number): void {
		this._invalidated = false;
		this._renderer.clear();

		const tool = this._tool as LineToolLongShortPosition<HorzScaleItem>;
		const options = tool.options() as LineToolOptionsInternal<'LongShortPosition'>;

		if (!options.visible) return;

		// 1. Coordinate Conversion
		// This populates this._points based on tool.points(). 
		// Because we overrode points() in the Model, this will contain [Entry, Stop, VirtualPT]
		// even during the creation/ghosting phase.
		if (!this._updatePoints()) return;
		
		// We need at least Entry and Stop (2 points) to draw anything meaningful
		if (this._points.length < 2) return;
 

		// --- CULLING START ---
		// We check visibility for both rectangles independently to support different extension settings
		// and to optimize rendering by skipping off-screen halves.
		
		let isRiskVisible = true;
		let isRewardVisible = true;

		// Only run culling if finished and not editing (smoothing)
		/**
		 * GRANULAR CULLING CHECK
		 *
		 * Unlike simple tools, this tool spans two distinct directions.
		 * We check the visibility of the Risk Rectangle and Reward Rectangle *independently*.
		 *
		 * - If the PT is off-screen (e.g., way up high), we still draw the Risk box.
		 * - If the Stop is off-screen, we still draw the Reward box.
		 * - We only abort completely if *both* are invisible.
		 */
		if (tool.isFinished() && !tool.isEditing()) {
			/**
			 * POINT RETRIEVAL
			 *
			 * We fetch:
			 * 1. Logical Points (P0, P1, P2) for calculating text stats (Prices, R:R).
			 * 2. Screen Points for drawing the rectangles.
			 *
			 * Note: P2 (PT) might be null during the very first click of creation, so we guard against that.
			 */
			const P0_log = tool.getPoint(0)!;
			const P1_log = tool.getPoint(1)!;
			const P2_log = tool.getPoint(2)!;

			isRiskVisible = this._isRectangleVisible(P0_log, P1_log, options.entryStopLossRectangle);
			isRewardVisible = this._isRectangleVisible(P0_log, P2_log, options.entryPtRectangle);

			// Total Cull: If neither part is visible, stop here.
			if (!isRiskVisible && !isRewardVisible) {
				return;
			}
		}
		// --- CULLING END ---

		const compositeRenderer = this._renderer as CompositeRenderer<HorzScaleItem>;

		// --- GET LOGICAL POINTS (For Text Values) ---
		const P0_logical = tool.getPoint(0)!; // Entry
		const P1_logical = tool.getPoint(1)!; // Stop
		const P2_logical = tool.getPoint(2);  // PT (Logical) - might be null if not enough points
		
		// --- GET SCREEN POINTS (For Drawing) ---
		const P_Entry_Screen = this._points[0];
		const P_Stop_Screen = this._points[1];
		
		// FIX: Safe retrieval of PT Screen point. Defined as AnchorPoint | null.
		const P_PT_Screen = this._points.length >= 3 ? this._points[2] : null;
		
		const isLong = tool.isCurrentLong();
 
		// --- 2. Risk Rectangle (Entry <-> Stop Loss) ---
		/**
		 * RISK RECTANGLE RENDERER SETUP
		 *
		 * We configure the Red box.
		 * - `points`: From Entry (Screen) to Stop (Screen).
		 * - `options`: Derived from `entryStopLossRectangle`.
		 */
		const riskPoints: [AnchorPoint, AnchorPoint] = [P_Entry_Screen, P_Stop_Screen];
 
		this._riskRenderer.setData({
			...deepCopy(options.entryStopLossRectangle),
			points: riskPoints,
			hitTestBackground: false,
		});
		compositeRenderer.append(this._riskRenderer);

		// --- 3. Reward Rectangle (Entry <-> PT) ---
		// FIX: Type Guard ensures P_PT_Screen is AnchorPoint inside the block
		if (P_PT_Screen) {
			const rewardPoints: [AnchorPoint, AnchorPoint] = [P_Entry_Screen, P_PT_Screen];

			/**
			 * REWARD RECTANGLE RENDERER SETUP
			 *
			 * We configure the Green box.
			 * - `points`: From Entry (Screen) to Profit Target (Screen).
			 * - `options`: Derived from `entryPtRectangle`.
			 * This block only runs if P2 (Target) exists.
			 */
			this._rewardRenderer.setData({
				...deepCopy(options.entryPtRectangle),
				points: rewardPoints,
				hitTestBackground: false,
			});
			compositeRenderer.append(this._rewardRenderer);
		}

		// --- 4. Dynamic Auto-Text Labels ---
		if (options.showAutoText) {

			// 1. Define Theme Defaults (Fallback styles if user provided nothing)
			const defaultAutoTextStyle: DeepPartial<TextOptions> = {
				font: { color: 'white', size: 12, bold: true, family: 'sans-serif' },
				box: {
					background: { color: 'rgba(0, 0, 0, 0)' },
					alignment: { vertical: BoxVerticalAlignment.Middle, horizontal: BoxHorizontalAlignment.Center }
				},
				padding: 4,
			};

			const priceFormatter = this._series.priceFormatter();
			const riskDistance = Math.abs(P0_logical.price - P1_logical.price);

			// ============================================================
			// 4.1. Risk Label (Stop Loss Zone)
			// Source: options.entryStopLossText
			// ============================================================
			
			// A. Merge Defaults + User Options
			const finalRiskTextOptions = merge(deepCopy(defaultAutoTextStyle), options.entryStopLossText) as TextOptions;
			
			// B. Set Dynamic Text (Preserving User Note)
			const riskStats = `Entry: ${priceFormatter.format(P0_logical.price)}\nStop: ${priceFormatter.format(P1_logical.price)}\nRisk: ${priceFormatter.format(riskDistance)}`;
			
			// Capture user text (if any) from the merged options before we overwrite it
			const riskUserNote = finalRiskTextOptions.value;
			
			// Append user note on a new line if it exists
			finalRiskTextOptions.value = (riskUserNote && riskUserNote.trim().length > 0) 
				? `${riskStats}\n${riskUserNote}` 
				: riskStats;

			// C. Apply Smart Alignment Logic
			// If the final alignment is 'Middle' (the generic default), we assume the user wants Auto-Alignment.
			// If the user explicitly set 'Top' or 'Bottom', we respect it.
			if (finalRiskTextOptions.box.alignment.vertical === BoxVerticalAlignment.Middle) {
				finalRiskTextOptions.box.alignment.vertical = isLong ? BoxVerticalAlignment.Bottom : BoxVerticalAlignment.Top;
			}

			/**
			 * RISK LABEL GENERATION
			 *
			 * 1. **Formatting:** We format Entry, Stop, and Risk amount using the series formatter.
			 * 2. **Merging:** We merge these stats with any custom text provided by the user.
			 * 3. **Auto-Alignment:** We dynamically set the vertical alignment ('Top' or 'Bottom')
			 *    based on the trade direction (Long/Short) to keep text inside the box.
			 */
			this._riskLabelRenderer.setData({
				text: finalRiskTextOptions,
				points: riskPoints, 
				hitTestBackground: true,
				toolDefaultHoverCursor: options.defaultHoverCursor,
				toolDefaultDragCursor: options.defaultDragCursor,
			});
			compositeRenderer.append(this._riskLabelRenderer);


			// ============================================================
			// 4.2. Reward Label (PT Zone)
			// Source: options.entryPtText  <-- FIX: Now using correct options source
			// ============================================================
			
			if (P_PT_Screen && P2_logical) {
				const rewardDistance = Math.abs(P0_logical.price - P2_logical.price);
				const rrValue = riskDistance !== 0 ? (rewardDistance / riskDistance).toFixed(2) : '0.00';

				// A. Merge Defaults + User Options
				const finalRewardTextOptions = merge(deepCopy(defaultAutoTextStyle), options.entryPtText) as TextOptions;

				// B. Set Dynamic Text (Preserving User Note)
				const rewardStats = `PT: ${priceFormatter.format(P2_logical.price)}\nReward: ${priceFormatter.format(rewardDistance)}\nR:R: ${rrValue}`;
				
				// Capture user text (if any) from the merged options
				const rewardUserNote = finalRewardTextOptions.value;

				// Append user note on a new line if it exists
				finalRewardTextOptions.value = (rewardUserNote && rewardUserNote.trim().length > 0)
					? `${rewardStats}\n${rewardUserNote}`
					: rewardStats;

				// C. Apply Smart Alignment Logic
				// If 'Middle', apply Auto-Alignment (Opposite of Risk label)
				if (finalRewardTextOptions.box.alignment.vertical === BoxVerticalAlignment.Middle) {
					finalRewardTextOptions.box.alignment.vertical = isLong ? BoxVerticalAlignment.Top : BoxVerticalAlignment.Bottom;
				}

				// Pass the Reward points (Entry + PT)
				const rewardPoints: [AnchorPoint, AnchorPoint] = [P_Entry_Screen, P_PT_Screen];

				/**
				 * REWARD LABEL GENERATION
				 *
				 * Similar to the Risk label, but calculates the R:R ratio.
				 * 1. **Calculation:** `RewardDist / RiskDist`.
				 * 2. **Alignment:** Uses the opposite vertical alignment of the Risk label to ensure
				 *    symmetry (e.g., if Risk text is at the bottom of its box, Reward text is at the top of its box).
				 */
				this._rewardLabelRenderer.setData({
					text: finalRewardTextOptions,
					points: rewardPoints, 
					hitTestBackground: true,
					toolDefaultHoverCursor: options.defaultHoverCursor,
					toolDefaultDragCursor: options.defaultDragCursor,
				});
				compositeRenderer.append(this._rewardLabelRenderer);
			}
		}		

		// --- 5. Anchors ---
		// Anchors should only appear when the tool is actually fully finished (clicked twice).
		//if (this.areAnchorsVisible() && tool.isFinished()) {
			this._addAnchors(compositeRenderer);
		//}
	}

	/**
	 * Adds the three interactive anchor points (Entry, Stop, Target).
	 *
	 * We assign `VerticalResize` cursors to all three because the primary interaction mode
	 * for adjusting this tool is dragging the price levels up and down.
	 *
	 * @param renderer - The composite renderer to append anchors to.
	 * @protected
	 * @override
	 */
	protected override _addAnchors(renderer: CompositeRenderer<any>): void {
		if (this._points.length < 3) return;

		// Entry, Stop, PT
		const entryAnchor = this._points[0];
		const stopAnchor = this._points[1];
		const ptAnchor = this._points[2];
		
		entryAnchor.specificCursor = PaneCursorType.VerticalResize;
		stopAnchor.specificCursor = PaneCursorType.VerticalResize;
		ptAnchor.specificCursor = PaneCursorType.VerticalResize;

		renderer.append(this.createLineAnchor({
			points: [entryAnchor, stopAnchor, ptAnchor],
			defaultAnchorHoverCursor: PaneCursorType.VerticalResize,
			defaultAnchorDragCursor: PaneCursorType.VerticalResize,
		}, 0));
	}

	/**
	 * Helper to determine visibility of a specific rectangle component (Risk or Reward).
	 *
	 * It constructs a bounding box from the two defining logical points and uses
	 * `getToolCullingState` with specific sub-segment checks to handle infinite extensions
	 * properly if they are enabled in the options.
	 *
	 * @param pA - Start point of the rectangle part.
	 * @param pB - End point of the rectangle part.
	 * @param rectOptions - The options containing extension settings.
	 * @returns `true` if this part of the tool is visible.
	 * @private
	 */
	private _isRectangleVisible(pA: LineToolPoint, pB: LineToolPoint, rectOptions: RectangleOptions): boolean {
		// 1. Calculate Geometry
		const minTime = Math.min(pA.timestamp, pB.timestamp);
		const maxTime = Math.max(pA.timestamp, pB.timestamp);
		const minPrice = Math.min(pA.price, pB.price);
		const maxPrice = Math.max(pA.price, pB.price);

		const P_TL: LineToolPoint = { timestamp: minTime, price: maxPrice };
		const P_TR: LineToolPoint = { timestamp: maxTime, price: maxPrice };
		const P_BL: LineToolPoint = { timestamp: minTime, price: minPrice };
		const P_BR: LineToolPoint = { timestamp: maxTime, price: minPrice };

		const cullingPoints = [P_TL, P_TR, P_BL, P_BR];

		// 2. Define Sub-Segments for Infinite Extension Check
		// 0-1 is Top Edge, 2-3 is Bottom Edge
		const cullingInfo: LineToolCullingInfo = {
			subSegments: [[0, 1], [2, 3]]
		};

		const extendOptions = rectOptions.extend;

		// 3. Get State
		// The helper uses the subSegments + extendOptions to perform the full geometric intersection test.
		const cullingState = getToolCullingState(cullingPoints, this._tool, extendOptions, undefined, cullingInfo);

		// 4. Interpret State
		// Since we provided subSegments, the helper returns 'Visible' if *any* part intersects,
		// or 'FullyOffScreen' if nothing intersects. We don't need manual directional checks.
		return cullingState === OffScreenState.Visible;
	}
}