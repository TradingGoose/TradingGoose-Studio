// /src/interaction/interaction-manager.ts

import {
	IChartApiBase,
	ISeriesApi,
	MouseEventParams,
	SeriesType,
	IHorzScaleBehavior,
	Coordinate,
	IPaneApi,
	TouchMouseEventData
} from 'lightweight-charts';
import { LineToolsCorePlugin } from '../core-plugin';
import { BaseLineTool } from '../model/base-line-tool';
import { ToolRegistry } from '../model/tool-registry';
import { LineToolPartialOptionsMap, LineToolType, InteractionPhase, HitTestType, HitTestResult, SnapAxis, FinalizationMethod, PaneCursorType } from '../types';
import { Point, interpolateTimeFromLogicalIndex } from '../utils/geometry';
import { LineToolPoint } from '../api/public-api';
import { ensureNotNull } from '../utils/helpers';


/**
 * Defines the parameters for an active tool waiting for user interaction.
 */
interface ActiveToolParams<T extends LineToolType> {
	type: T;
	options?: LineToolPartialOptionsMap[T];
}

const DRAG_THRESHOLD = 10; // Pixels to classify movement as drag
const CLICK_TIMEOUT = 300; // Milliseconds (max time between down and up for a click)

/**
 * Manages all user interactions with line tools, including creation, selection,
 * editing, and event propagation. It acts as the central router for mouse
 * and touch events.
 */
export class InteractionManager<HorzScaleItem> {
	private _plugin: LineToolsCorePlugin<HorzScaleItem>;
	private _chart: IChartApiBase<HorzScaleItem>;
	private _series: ISeriesApi<SeriesType, HorzScaleItem>;
	private _tools: Map<string, BaseLineTool<HorzScaleItem>>;
	private _toolRegistry: ToolRegistry<HorzScaleItem>;
	private _horzScaleBehavior: IHorzScaleBehavior<HorzScaleItem>;

	// State Management
	private _currentToolCreating: BaseLineTool<HorzScaleItem> | null = null;
	private _selectedTool: BaseLineTool<HorzScaleItem> | null = null;
	private _hoveredTool: BaseLineTool<HorzScaleItem> | null = null;

	// Interaction State (Editing)
	private _isEditing: boolean = false;
	private _draggedTool: BaseLineTool<HorzScaleItem> | null = null;
	private _draggedPointIndex: number | null = null;
	private _originalDragPoints: LineToolPoint[] | null = null;
	private _dragStartPoint: Point | null = null;
	// Store the cursor that started the interaction
    private _activeDragCursor: PaneCursorType | null = null;

	// Interaction State (Creation - Raw DOM Listeners)
	private _isCreationGesture: boolean = false;
	private _creationTool: BaseLineTool<HorzScaleItem> | null = null;
	private _mouseDownPoint: Point | null = null;
	private _mouseDownTime: number = 0;
	private _isDrag: boolean = false;
	private _isShiftKeyDown: boolean = false;

	/**
	 * Initializes the Interaction Manager, setting up all internal references and subscribing
	 * to necessary DOM and Lightweight Charts events.
	 *
	 * This class serves as the central event handler, converting low-level mouse and touch
	 * events into logical interaction commands for line tools (e.g., drag, select, create).
	 *
	 * @param plugin - The root {@link LineToolsCorePlugin} instance for internal updates and event firing.
	 * @param chart - The Lightweight Charts chart API instance.
	 * @param series - The primary series API instance.
	 * @param tools - The map of all registered line tools.
	 * @param toolRegistry - The registry for looking up tool constructors.
	 */
	public constructor(
		plugin: LineToolsCorePlugin<HorzScaleItem>,
		chart: IChartApiBase<HorzScaleItem>,
		series: ISeriesApi<SeriesType, HorzScaleItem>,
		tools: Map<string, BaseLineTool<HorzScaleItem>>,
		toolRegistry: ToolRegistry<HorzScaleItem>,
	) {
		this._plugin = plugin;
		this._chart = chart;
		this._series = series;
		this._tools = tools;
		this._toolRegistry = toolRegistry;
		this._horzScaleBehavior = chart.horzBehaviour();

		this._subscribeToChartEvents();
	}

	/**
	 * Converts raw screen coordinates (in pixels) to a logical {@link LineToolPoint} (timestamp/price).
	 *
	 * This conversion is robust, handling interpolation to return a time and price value
	 * even if the screen point is over an area of the chart without a data bar (blank logical space).
	 *
	 * @param screenPoint - The screen coordinates as a {@link Point} object.
	 * @returns A {@link LineToolPoint} containing a timestamp and price, or `null` if the conversion fails.
	 *
	 * @example
	 * // Used by LineToolsCorePlugin to position the crosshair
	 * const logicalPoint = manager.screenPointToLineToolPoint(new Point(x, y));
	 */
	public screenPointToLineToolPoint(screenPoint: Point): LineToolPoint | null {
		const timeScale = this._chart.timeScale();
		const price = this._series.coordinateToPrice(screenPoint.y as Coordinate);

		const logical = timeScale.coordinateToLogical(screenPoint.x as Coordinate);
	 
		if (logical === null) {
			return null;
		}

		// Use utility function (which uses interpolation) to get a timestamp from the logical index.
		const interpolatedTime = interpolateTimeFromLogicalIndex(this._chart, this._series, logical);

		if (interpolatedTime === null || price === null) {
			return null;
		}

		// Return the final LineToolPoint (timestamp/price).
		return {
			timestamp: this._horzScaleBehavior.key(interpolatedTime as HorzScaleItem) as number,
			price: price as number,
		};
	}

	/**
	 * Sets the specific tool instance that is currently being drawn interactively by the user.
	 *
	 * This is called by the {@link LineToolsCorePlugin.addLineTool} method when initiating an
	 * interactive creation gesture. This tool instance becomes the target for subsequent mouse clicks.
	 *
	 * @param tool - The {@link BaseLineTool} instance currently in creation mode, or `null` to clear.
	 * @internal
	 */
	public setCurrentToolCreating(tool: BaseLineTool<HorzScaleItem> | null): void {
		this._currentToolCreating = tool;

		//console.log(`[InteractionManager] Set _currentToolCreating to ${tool?.id() || 'null'}`);
	}

	/**
	 * Attaches a line tool primitive to the main series for rendering.
	 *
	 * This is an internal helper called by the {@link LineToolsCorePlugin} immediately after a tool is constructed.
	 *
	 * @param tool - The {@link BaseLineTool} to attach.
	 * @private
	 */
	private attachTool(tool: BaseLineTool<HorzScaleItem>): void {
		this._series.attachPrimitive(tool);
	}

	/**
	 * Subscribes to all necessary browser DOM events (`mousedown`, `mousemove`, `mouseup`, `keydown`, `keyup`)
	 * and Lightweight Charts API events (`subscribeDblClick`, `subscribeCrosshairMove`) to capture user input.
	 *
	 * @private
	 */
	private _subscribeToChartEvents(): void {
		const chartElement = this._chart.chartElement();
		
		// 1. Raw DOM Events for Drag/Click Detection and Editing
		chartElement.addEventListener('mousedown', this._handleMouseDown.bind(this));
		chartElement.addEventListener('mousemove', this._handleMouseMove.bind(this));
		window.addEventListener('mouseup', this._handleMouseUp.bind(this)); 
		
		// 2. LWC API Events for Ghosting/Hover/DBLClick
		this._chart.subscribeDblClick(this._handleDblClick.bind(this)); 
		this._chart.subscribeCrosshairMove(this._handleCrosshairMove.bind(this));

		// Global Listeners for Persistent Key State **
		window.addEventListener('keydown', this._handleKey.bind(this));
		window.addEventListener('keyup', this._handleKey.bind(this));
	}

	/**
	 * Handles global `keydown` and `keyup` events, specifically tracking the state of the 'Shift' key.
	 *
	 * The Shift key state is critical for enabling constraint-based drawing (e.g., 45-degree angle locking).
	 *
	 * @param event - The browser's KeyboardEvent.
	 * @private
	 */
	private _handleKey(event: KeyboardEvent): void {
		if (event.key === 'Shift') {
			
			const newState = event.type === 'keydown';
			
			// Only proceed if the state is actually changing
			if (this._isShiftKeyDown !== newState) {
				
				this._isShiftKeyDown = newState;
				
				// CRUCIAL: Only request update IF a tool is currently active/creating.
				// This prevents needless updates when the user is just typing on the page.
				if (this._currentToolCreating || this._selectedTool) {
					// We request update if creating (ghosting needs refresh) 
					// OR if a tool is selected (the editing/hover cursor might change).
					//this._plugin.requestUpdate();
				}
			}
		}
	}	

	/**
	 * Detaches a line tool primitive from the chart's rendering pipeline and cleans up all internal references to it.
	 *
	 * This method is called by the {@link LineToolsCorePlugin} when a tool is removed.
	 *
	 * @param tool - The {@link BaseLineTool} to detach and clean up.
	 * @internal
	 */
	public detachTool(tool: BaseLineTool<HorzScaleItem>): void {
		// 1. Remove from Lightweight Charts rendering pipeline (from its associated pane)
		try {
			tool.getPane().detachPrimitive(tool); 
			console.log(`[InteractionManager] Detached primitive for tool: ${tool.id()} from pane.`);
		} catch (e: any) {
			console.error(`[InteractionManager] Error detaching primitive for tool ${tool.id()}:`, e.message);
		}

		// 2. Clear internal references if this tool was the one being tracked
		if (this._currentToolCreating === tool) {
			this._currentToolCreating = null;
		}
		if (this._selectedTool === tool) {
			this._selectedTool = null;
		}
		if (this._hoveredTool === tool) {
			this._hoveredTool = null;
		}

		// Reset interaction state if the removed tool was being dragged/edited
		if (this._draggedTool === tool || this._creationTool === tool) {
			this._isEditing = false;
			this._isCreationGesture = false;
			this._draggedTool = null;
			this._creationTool = null;
			this._draggedPointIndex = null;
			this._mouseDownPoint = null;
			this._mouseDownTime = 0;
			this._isDrag = false;

			// Re-enable chart's handleScroll if it was disabled for dragging
			this._chart.applyOptions({
				handleScroll: {
					pressedMouseMove: true,
				},
			});
		}
	}

	/**
	 * Finalizes the interactive creation of a tool once its required number of points have been placed.
	 *
	 * This method performs state cleanup, deselects all other tools, selects the new tool,
	 * calls the tool's optional `normalize()` method, and fires the `afterEdit` event.
	 *
	 * @param tool - The {@link BaseLineTool} that has completed its creation.
	 * @private
	 */
	private _finalizeToolCreation(tool: BaseLineTool<HorzScaleItem>): void {
		tool.tryFinish();

		// Ensure the tool's ghost point is cleared, regardless of finalization method
    	tool.clearGhostPoint();

		this._plugin.fireAfterEditEvent(tool, 'lineToolFinished');

		this.deselectAllTools();
		this._selectedTool = tool;
		this._selectedTool.setSelected(true);

		// --- NEW FIX: Call normalize() if implemented by the tool ---
		const toolWithNormalize = tool as BaseLineTool<HorzScaleItem> & { normalize?: () => void };
		if (toolWithNormalize.normalize) {
			toolWithNormalize.normalize();
			console.log(`[InteractionManager] Normalized tool after creation: ${tool.id()}`);
		}
		// --- END NEW FIX ---

		// Reset creation-related state
		this._isCreationGesture = false;
		this._creationTool = null;
		this._isDrag = false;
		this._mouseDownPoint = null;
		this._mouseDownTime = 0;
		this.setCurrentToolCreating(null);
		this._chart.applyOptions({ handleScroll: { pressedMouseMove: true } });
		
		this._plugin.requestUpdate();
		console.log(`[InteractionManager] Tool creation finalized: ${tool.id()}`);
	}

	/**
	 * Handles the initial `mousedown` event on the chart canvas.
	 *
	 * This is the crucial entry point for an interaction gesture, determining if the action is:
	 * 1. The start of an interactive tool creation.
	 * 2. The start of a drag/edit gesture on an existing tool (dragged anchor or body).
	 * 3. An initial click that leads to selection.
	 *
	 * @param event - The browser's MouseEvent.
	 * @private
	 */
	private _handleMouseDown(event: MouseEvent): void {
		const point = this._eventToPoint(event);
		if (!point) { return; }

		// Reset drag/click state
		this._isDrag = false;
		this._mouseDownPoint = point;
		this._mouseDownTime = performance.now();
		
		// --- 1. Tool Creation START/CONTINUATION ---
		if (this._currentToolCreating) {
			this._creationTool = this._currentToolCreating; // The tool instance must exist here
			this._isCreationGesture = true;
			
			// Immediately disable chart scroll as we've captured the gesture
			this._chart.applyOptions({ handleScroll: { pressedMouseMove: false } });
			console.log(`[InteractionManager] Creation gesture started for ${this._creationTool.id()}`);

			// Since the logic for 1-point tools is now in MouseUp, we just return here.
			return;
		}
 
		// --- 2. GESTURE ON EXISTING TOOL START ---
		const hitResult = this._hitTest(point);

		if (hitResult && hitResult.tool) {

			if (!hitResult.tool.options().editable) { return; }

			// A detected hit means this tool must be selected immediately.
			if (!hitResult.tool.isSelected()) {
				this.deselectAllTools();
				this._selectedTool = hitResult.tool;
				this._selectedTool.setSelected(true);
			}

			this._draggedTool = hitResult.tool;
			this._draggedPointIndex = hitResult.pointIndex;

			// Smart Cursor Logic
			// 1. Get the cursor suggested by the renderer (e.g., 'nwse-resize' or 'pointer')
			let capturedCursor = hitResult.suggestedCursor || PaneCursorType.Default;

			// LOG 1: What did the hit test suggest initially?
            //console.log('[Debug] Hit Suggested:', capturedCursor);

			// 2. "Smart Upgrade": If the renderer says "Pointer" (generic hover) or "Default", 
			//    but we are initiating a drag on a tool, upgrade it to the tool's Drag Cursor (Grabbing).
			//    We DO NOT upgrade if it's a specific resize cursor (e.g., 'nwse-resize').
			if (capturedCursor === PaneCursorType.Pointer || capturedCursor === PaneCursorType.Default) {
                const toolDragCursor = hitResult.tool.options().defaultDragCursor;
                // LOG 2: What is the tool's configured drag cursor?
                //console.log('[Debug] Tool Default Drag:', toolDragCursor);
                
				capturedCursor = toolDragCursor || PaneCursorType.Grabbing;
			}

			// 3. Lock this cursor for the duration of the drag
			this._activeDragCursor = capturedCursor;

			let allOriginalPoints: LineToolPoint[] = [];
			
			// If tool is Unbounded (Brush) AND a move is initiated (anchor drag OR background drag)
			// we must capture ALL permanent points for a full path translation.
			if (this._draggedTool.pointsCount === -1) {
				// Captures the full path for translation
				allOriginalPoints = this._draggedTool.getPermanentPointsForTranslation();

				// CRITICAL: We must clear the draggedPointIndex if the hit was on the center anchor
				// to ensure _handleMouseMove enters the correct Translate logic.
				// For Brush, index 0 is the center anchor, which should only ever move the tool.

				if (this._draggedTool.anchor0TriggersTranslation() && this._draggedPointIndex === 0) {
					this._draggedPointIndex = null;
				}
 
			}			
			
			else {
				// --- Standard Handling for Bounded Tools ---
				
				// Determine the maximum anchor index to iterate up to.
				const maxAnchorIndex = hitResult.tool.maxAnchorIndex 
					? hitResult.tool.maxAnchorIndex() 
					: hitResult.tool.pointsCount - 1;

				const originalPointsArray: (LineToolPoint | null)[] = [];
				for (let i = 0; i <= maxAnchorIndex; i++) {
					// Calls tool.getPoint(i), which calculates virtual points for indices > 1
					originalPointsArray.push(hitResult.tool.getPoint(i)); 
				}
				
				// Filter out nulls and store the collected points
				allOriginalPoints = originalPointsArray.filter(p => p !== null) as LineToolPoint[];
			}
			
			// Store the collected points for drag comparison
			this._originalDragPoints = allOriginalPoints;
			// highlight-end
			this._dragStartPoint = point; 

			this._chart.applyOptions({ handleScroll: { pressedMouseMove: false } });

			console.log(`[InteractionManager] Mouse Down: Starting gesture on tool ${hitResult.tool.id()}`);
		}
	}	

	/**
	 * Handles the `mousemove` event, which primarily manages dragging/editing or ghost-point drawing.
	 *
	 * This logic handles:
	 * 1. Applying drag/edit updates to a selected tool's points, including calculating **Shift-key constraints**.
	 * 2. Translating the entire tool if the drag started on the body.
	 * 3. Updating the "ghost" point of a tool currently in `Creation` phase.
	 * 4. Applying the correct custom cursor style during the drag.
	 *
	 * @param event - The browser's MouseEvent.
	 * @private
	 */
	private _handleMouseMove(event: MouseEvent): void {
		const point = this._eventToPoint(event);
		if (!point) { return; }

		// --- 1. Check for Drag Threshold (If any gesture is active) ---
		if (this._isCreationGesture || this._draggedTool) {
			if (this._mouseDownPoint && point.subtract(this._mouseDownPoint).length() > DRAG_THRESHOLD) {
				this._isDrag = true; // Drag threshold met
			}
		}

		// --- 2. Creation Drag/Ghosting Flow (Single-Drag Creation) ---
		if (this._isCreationGesture && this._creationTool && this._mouseDownPoint) {
			const tool = this._creationTool;
			// Check if the tool supports drag creation AND the constraint is supported
			const isDragCreationSupported = tool.supportsClickDragCreation?.() === true;
			const isShiftConstraintSupported = tool.supportsShiftClickDragConstraint?.() === true;
 
			// Safety check: If not supported, rely on _handleCrosshairMove for ghosting and exit
			if (!isDragCreationSupported && !this._isDrag) {
				return; 
			}

			if (this._isDrag && isDragCreationSupported) {
				const p0LocationLogical = this.screenPointToLineToolPoint(this._mouseDownPoint);
				let constrainedScreenPoint: Point = point;

				// ADDED: Variable to capture the axis hint
                let snapAxis: SnapAxis = 'none';
 
				// --- SHIFT CONSTRAINT LOGIC FOR CREATION DRAG (P1 is being placed) ---
				if (this._isShiftKeyDown && isShiftConstraintSupported) {
					const anchorIndexBeingDragged = 1; // Always P1 during the first drag creation
					const phase: InteractionPhase = InteractionPhase.Creation;
 
					// P0's original position is the original logical point in this context
					const originalP0 = p0LocationLogical;

					if (originalP0 && tool.getShiftConstrainedPoint) {
						// The logical points array is either empty or contains just P0 at this moment
						const allOriginalLogicalPointsForCreation = this._originalDragPoints || (originalP0 ? [originalP0] : []);

                        const constraintResult = tool.getShiftConstrainedPoint(
							anchorIndexBeingDragged,
							point,
							phase,
							originalP0, // P0's original position is the constraint source
							allOriginalLogicalPointsForCreation as LineToolPoint[]
						);
                        constrainedScreenPoint = constraintResult.point;
						snapAxis = constraintResult.snapAxis;
					}
				}
 
				// Use the (potentially) constrained screen point for the logical conversion
				let constrainedLogicalPoint = this.screenPointToLineToolPoint(constrainedScreenPoint);

				// --- SYNCHRONOUS LOGICAL SNAP (APPLIED CONTINUOUSLY DURING DRAG) ---
                if (constrainedLogicalPoint && snapAxis !== 'none') {
                    const P0 = p0LocationLogical; // P0 is the point at the start of the drag
                    
                    if (P0) {
                        if (snapAxis === 'time') {
                            constrainedLogicalPoint = {
                                timestamp: P0.timestamp,
                                price: constrainedLogicalPoint.price,
                            };
                        } else if (snapAxis === 'price') {
                            constrainedLogicalPoint = {
                                timestamp: constrainedLogicalPoint.timestamp,
                                price: P0.price,
                            };
                        }
                    }
                }
                // --- END SYNCHRONOUS LOGICAL SNAP ---

				if (p0LocationLogical && constrainedLogicalPoint) {

					const toolPoints = tool.points();

					if (tool.pointsCount === -1) { 
						// --- FREEHAND TOOL LOGIC (Brush/Highlighter) ---
						// This tool is unbounded, so we call addPoint() continuously
						tool.addPoint(constrainedLogicalPoint);
					} else {
						if (tool.points().length === 0) {
							// First time drag is detected, add both points
							tool.addPoint(p0LocationLogical); // Commit P0 permanently at mousedown location
							tool.addPoint(constrainedLogicalPoint); // Add P1 (to be updated/ghosted)
						} else if (tool.points().length === 2) {
							// Already dragging, update P1
							tool.setPoint(1, constrainedLogicalPoint);
						}
					}
				}
			}
 
			this._creationTool.updateAllViews();
			this._plugin.requestUpdate();
			return;
		}

		// --- 3. Editing Drag Flow (Final Logic for Shift Constraint) ---
		if (this._draggedTool && this._dragStartPoint) {
			// Check if the overall gesture has exceeded the drag threshold
			if (this._isDrag) {
				this._isEditing = true;
				
				// Lock the cursor to whatever we captured in MouseDown
                if (this._activeDragCursor) {
                    this._draggedTool.setOverrideCursor(this._activeDragCursor);
                }
			}

			if (this._isEditing) {
				const tool = this._draggedTool;
				const isAnchorDrag = this._draggedPointIndex !== null;

				// Phase is used for the Model's getShiftConstrainedPoint logic
				const phase: InteractionPhase = isAnchorDrag ? InteractionPhase.Editing : InteractionPhase.Move;

				// --- Bug 1 Fix: Check if an Anchor Drag should be treated as a Translate ---
				//let shouldTranslateInsteadOfReshape = false;
				//if (isAnchorDrag && tool.pointsCount === -1 && this._draggedPointIndex === 0) {
					// Condition: Anchor drag on an unbounded tool's first (and only visible) anchor (index 0)
				//	shouldTranslateInsteadOfReshape = true;
				//}

				// --- Anchor Drag Logic (Resizing) ---
				if (isAnchorDrag) {
					const anchorIndex = ensureNotNull(this._draggedPointIndex);

					// --- Determine the Screen Point: Raw Mouse OR Shift-Constrained ---
					let constrainedScreenPoint: Point = point;

					// Apply Shift Constraint (This is where the N/S, E/W lock logic is applied)
					if (this._isShiftKeyDown) {
						const originalLogicalPoint = this._originalDragPoints![anchorIndex];
						if (originalLogicalPoint && tool.getShiftConstrainedPoint) {

							const constraintResult = tool.getShiftConstrainedPoint( // <<< CHANGE 3: Capture ConstraintResult
								anchorIndex,
								point,
								phase,
								originalLogicalPoint,
								this._originalDragPoints!
							);
							constrainedScreenPoint = constraintResult.point;
						}
					}

					// FINAL STEP: Convert the (potentially) constrained screen point to a fully snapped logical point
					const targetLogicalPoint = this.screenPointToLineToolPoint(constrainedScreenPoint);

					// Final update call
					if (targetLogicalPoint) {
						tool.setPoint(anchorIndex, targetLogicalPoint);
					}

				} else {
					// --- Tool Translate Logic (Move Phase) ---
					
					if (!this._originalDragPoints || this._originalDragPoints.length === 0) return;
 
					// Calculate new screen points based on delta
					const delta = point.subtract(this._dragStartPoint);
					
					// highlight-start
					// --- FIX for Stable Logical Translation Vector ---
					
					const tool = this._draggedTool;

					// 1. Get the Initial Logical P0 and Initial Screen Point
					// We must use the point at which the drag initiated to calculate the vector
					const initialLogicalP0 = this._originalDragPoints[0]; // The logical P0 at the moment of click
					const initialScreenP0 = tool.pointToScreenPoint(initialLogicalP0); // The screen P0 at the moment of click

					// If we cannot resolve the starting screen point, something is wrong.
					if (!initialScreenP0) return;

					// 2. Calculate the intended New Screen Point for P0
					// This is simply the initial P0 screen position + the cumulative pixel delta
					const newScreenP0 = initialScreenP0.add(delta);
					
					// 3. Convert the intended new Screen Point back to a Logical Point
					const newLogicalP0 = tool.screenPointToPoint(newScreenP0);
					
					if (!newLogicalP0) {
						console.warn(`[InteractionManager] Failed to determine new logical P0.`);
						return;
					}
					
					// 4. Calculate the Stable Translation Vector in Logical Space (Time and Price)
					// This vector is the difference between the intended P0 and the original P0.
					const timeTranslationVector = newLogicalP0.timestamp - initialLogicalP0.timestamp;
					const priceTranslationVector = newLogicalP0.price - initialLogicalP0.price;

					const newLogicalPoints: LineToolPoint[] = [];

					// 5. Apply the Stable Translation Vector to all original points.
					for (const originalLogicalPoint of this._originalDragPoints) {
						
						const translatedLogicalPoint: LineToolPoint = {
							// Apply the stable logical vectors
							timestamp: originalLogicalPoint.timestamp + timeTranslationVector,
							price: originalLogicalPoint.price + priceTranslationVector,
						};

						newLogicalPoints.push(translatedLogicalPoint);
					}
					
					// 6. Update the tool with the full array of new translated points
					tool.setPoints(newLogicalPoints);



				}

				this._draggedTool.updateAllViews();
				this._plugin.requestUpdate();
			}
		}		
	}

	/**
	 * Handles the `mouseup` event, finalizing any active interaction (creation or editing).
	 *
	 * This method is responsible for:
	 * 1. Committing the final point in a click-click creation sequence.
	 * 2. Finalizing a drag-based creation (e.g., Rectangle, Brush).
	 * 3. Finalizing an editing drag (resizing or translation) and resetting the editing state.
	 * 4. Handling standalone clicks for selection/deselection.
	 *
	 * @param event - The browser's MouseEvent.
	 * @private
	 */
	private _handleMouseUp(event: MouseEvent): void {

		const point = this._eventToPoint(event);

		// Early exit if mouseup is outside chart and not part of an ongoing drag
		const chartElement = this._chart.chartElement();
		const clickedInsideChartElement = chartElement.contains(event.target as Node);

		// If mouseup occurred outside the chart's element, AND we're NOT currently dragging a tool
		// (either for creation or editing), then this mouseup is irrelevant to our chart interaction logic.
		if (!clickedInsideChartElement && !this._isDrag && !this._isCreationGesture && !this._draggedTool) {
			// A true "mouseup" on an external button or element that doesn't affect active chart interactions.
			this._resetCommonGestureState(); // Clear _mouseDownPoint etc.
			return;
		}

		// Flag to indicate if a specific interaction flow was handled.
		let handledInteraction = false;
 
		// --- 1. Finalize Creation Click/Drag ---
		if (this._isCreationGesture && this._creationTool && this._mouseDownPoint) {

			handledInteraction = true; // Mark as handled
			const tool = this._creationTool;
			const timeDelta = performance.now() - this._mouseDownTime;
			const distanceMoved = point ? point.subtract(this._mouseDownPoint).length() : 0;



			// Determine finalization method once
			const finalizationMethod = tool.getFinalizationMethod();
 
			const endPoint = point || this._mouseDownPoint;
 
			// Start with the raw screen point
			let finalScreenPoint: Point = endPoint;


			let isDiscreteClick = timeDelta < CLICK_TIMEOUT && distanceMoved <= DRAG_THRESHOLD && !this._isDrag;
			//console.log('isDiscreteClick', isDiscreteClick)

			// --- 1-POINT TOOLS ---
			if (tool.pointsCount === 1) {
				// For a 1-point tool, the first MouseUp event is the final action.
				
				// 1. Get the final logical point for the click location
				const finalScreenPoint = endPoint;
				const finalLogicalPoint = this.screenPointToLineToolPoint(finalScreenPoint);
				
				if (finalLogicalPoint) {
					// 2. Add the single permanent point
					tool.addPoint(finalLogicalPoint);
					// 3. Finalize and clean up
					this._finalizeToolCreation(tool);

					// Exit the function here: tool creation complete
					return; 
				} else {
					// Point conversion failed (e.g., clicked far off-screen). Cancel creation.
					this.detachTool(tool);
					this._tools.delete(tool.id());
					this.setCurrentToolCreating(null);
					this._resetCreationGestureStateOnly();
					return;
				}
			}

			// Downgrade Accidental Drag to Click for fixed-point tools placing a subsequent point.
			if (this._creationTool && !isDiscreteClick) {
				
				const tool = this._creationTool;
				const permanentPointsCount = tool.getPermanentPointsCount();
				const isFixedPointTool = tool.pointsCount > 0;
				
				// Downgrade if it's a fixed-point tool placing Point 2, 3, etc. OR if it's a click-only tool (Path)
				const isSubsequentPointOfFixedTool = isFixedPointTool && permanentPointsCount > 0;

				// this will also downgrade the path tool as well since tool.supportsClickDragCreation = false for that
				if (isSubsequentPointOfFixedTool || tool.supportsClickDragCreation?.() === false) {
					// We override the drag state to false. This forces the upcoming check for 
					// "isDiscreteClick" to evaluate as true, effectively treating the quick drag as a point click.
					isDiscreteClick = true; 
					console.log(`[InteractionManager] Downgrade: Drag treated as discrete click to add point ${permanentPointsCount + 1}.`);
				}
			}			

			// Check creation method preferences
			const supportsClickClick = tool.supportsClickClickCreation?.() !== false; 
			const supportsClickDrag = tool.supportsClickDragCreation?.() === true; 


			if (finalizationMethod === FinalizationMethod.MouseUp) {
				// --- Freehand (Brush/Highlighter) Finalization Logic ---
				// Tool creation is handled on MouseUp if it supports Drag Creation
				if (supportsClickDrag) {
					// Finalize only if at least two points were drawn (P0 + P1 or more)
					if (tool.getPermanentPointsCount() >= 2) {
						this._finalizeToolCreation(tool);
					} else {
						// If user just clicks and releases quickly without dragging, treat as failed creation
						this.detachTool(tool);
						this._tools.delete(tool.id());
					}
					this._resetCreationGestureStateOnly();
					return;
				}
			}

			if (isDiscreteClick) {

				// Case A: Discrete Click (Click-Click Mode)
				if (!supportsClickClick) {
					console.warn(`[InteractionManager] Tool ${tool.toolType} does not support click-click creation.`);
					this.setCurrentToolCreating(null);
					this.deselectAllTools();
					this._plugin.requestUpdate();
					this._resetCreationGestureStateOnly();
					return;
				}

				// --- SHIFT CONSTRAINT LOGIC FOR DISCRETE CLICK FINALIZATION ---
				const isShiftKeyDown = this._isShiftKeyDown;
				const isShiftConstraintSupported = tool.supportsShiftClickClickConstraint?.() === true;
                
                // VARIABLE TO CAPTURE HINT
                let snapAxis: SnapAxis = 'none';
 
				if (isShiftKeyDown && isShiftConstraintSupported) {

					// Determine the index of the point that is *about to be added* (P1 if P0 exists)
					const anchorIndexBeingAdded = tool.getPermanentPointsCount();
 
					// The constraint source point is always P0 (index 0)
					const anchorIndexUsedForConstraint = 0;
 
					// Retrieve the original Logical P0 point for the constraint calculation
					const originalLogicalPoint = tool.getPoint(anchorIndexUsedForConstraint);
 
					// We need a safe points array to pass to the method
					const allOriginalLogicalPoints = [originalLogicalPoint] as LineToolPoint[];

					if (originalLogicalPoint && tool.getShiftConstrainedPoint) {

                        // Call the method returning ConstraintResult
						const constraintResult = tool.getShiftConstrainedPoint(
							anchorIndexBeingAdded,
							endPoint, // Pass the raw mouse point
							InteractionPhase.Creation,
							originalLogicalPoint, // P0's original position
							allOriginalLogicalPoints
						);
                        // 1. Get the constrained SCREEN point
						finalScreenPoint = constraintResult.point; 
                        // 2. CAPTURE HINT
                        snapAxis = constraintResult.snapAxis;
					}
				}
				// --- END SHIFT CONSTRAINT LOGIC ---

                // --- START SYNCHRONOUS LOGICAL SNAP FIX ---
				// 1. Convert the (potentially) constrained screen point into a logical point
				let finalLogicalPoint: LineToolPoint | null = this.screenPointToLineToolPoint(finalScreenPoint);
				console.log('finalLogicalPoint after let', JSON.parse(JSON.stringify(finalLogicalPoint)))

                // Check if we are placing P1 (point index 1) which is where the constraint applies
                const isP1Click = tool.getPermanentPointsCount() === 1; 

				if (finalLogicalPoint && isP1Click && snapAxis !== 'none') {
                    
                    // Clear ghost point since we are committing a snapped point
                    tool.setLastPoint(null); 
                    
                    const P0 = tool.getPoint(0);
                    
                    // Synchronously perform the final logical snap based on the hint
                    if (P0) {
                        if (snapAxis === 'time') {
                            // X-axis snap (Time) - Overwrite the interpolated time with the reference time
                            finalLogicalPoint = {
                                timestamp: P0.timestamp,
                                price: finalLogicalPoint.price, // Keep the interpolated price
                            };
                        } else if (snapAxis === 'price') {
                            // Y-axis snap (Price) - Overwrite the interpolated price with the reference price
                            finalLogicalPoint = {
                                timestamp: finalLogicalPoint.timestamp, // Keep the interpolated time
                                price: P0.price,
                            };
                        }
                    }
				} else {
                    // If no snap needed (P0 or unconstrained P1), clear the ghost point
                    if (finalLogicalPoint) {
                        tool.setLastPoint(null);
                    }
                }
				// --- END SYNCHRONOUS LOGICAL SNAP FIX ---


				// Case A: Discrete Click (Click-Click Mode)

				//GOTCHA i suspect that since the ghost creation of a tool for point1 (then 2nd point) actually modifies _points.
				//meaning the ghost does inject the ghost point into _points index 1 (2nd entry), so if we then tool.addPoint, then the constrained point
				// would be actually index 2 (3rd entry) in _points which is not what we want.
				console.log('finalLogicalPoint before if statement', JSON.parse(JSON.stringify(finalLogicalPoint)))
				if (finalLogicalPoint) {
					tool.addPoint(finalLogicalPoint);
				} else {
					console.warn(`[InteractionManager] Final logical point conversion failed. Click discarded.`);
				}




				if (finalizationMethod === FinalizationMethod.PointCount && tool.isFinished()) {
					this._finalizeToolCreation(tool);
					// --- FIX: Return immediately after finalization ---
					return;
				} else {
					console.log(`[InteractionManager] Click-Click: Placed Point ${tool.points().length}. Waiting for next point.`);
				}

			} else if (this._isDrag) {
				// Case B: Commit Click-and-Drag Creation



				if (!supportsClickDrag) {
					console.warn(`[InteractionManager] Tool ${tool.toolType} does not support click-drag creation.`);
					this.setCurrentToolCreating(null);
					this.deselectAllTools();
					this._plugin.requestUpdate();
					this._resetCreationGestureStateOnly();
					return;
				}

				// The point logic is handled inside _handleMouseMove/drag, which commits the points.
				// We just need to check if the final state is 'finished'.
				// Finalization for Bounded Drag Tools (e.g., Rectangle)
				if (finalizationMethod === FinalizationMethod.PointCount && tool.pointsCount === 2) {
					if (tool.points().length === 2) { 
						this._finalizeToolCreation(tool);
						return;
					}
				}
			}

			// Always reset gesture-specific flags after a creation mouseup
			this._resetCreationGestureStateOnly();
			return; // Handled creation flow
 
		}

		// --- 2. Finalize Editing Click/Drag ---
		if (this._draggedTool && this._dragStartPoint) {
			if (this._isEditing) { // It was an EDITING DRAG
				console.log(`[InteractionManager] Mouse Up after edit drag: Finalizing for tool ${this._draggedTool.id()}`);
				this._plugin.fireAfterEditEvent(this._draggedTool, 'lineToolEdited');

				const tool = this._draggedTool as BaseLineTool<HorzScaleItem> & { normalize?: () => void };
				if (tool.normalize) { tool.normalize(); }
			} else { // It was a discrete CLICK ON AN EXISTING TOOL (selection)
				console.log(`[InteractionManager] Mouse Up: Discrete click on existing tool ${this._draggedTool.id()}. Attempting selection.`);
				this._handleStandaloneClick(this._dragStartPoint); 
			}

			// Always reset editing-specific flags after an editing mouseup
			this._resetEditingGestureStateOnly(); 
			return; // Handled editing flow
		}
 
		// --- 3. Standalone Click (in empty space or on external UI) ---
		// This block is reached ONLY if no creation or editing gesture was active.
		const timeDeltaFinal = performance.now() - this._mouseDownTime;
		const distanceMovedFinal = this._mouseDownPoint && point ? point.subtract(this._mouseDownPoint).length() : 0;
 
		// This handles short clicks. Long clicks (non-drag, non-create, non-edit) also fall through here.
		// If it's a short click, we need to decide if it was on the chart.
		const wasAShortClick = (timeDeltaFinal < CLICK_TIMEOUT && distanceMovedFinal <= DRAG_THRESHOLD && point);

		if (wasAShortClick) {
			const chartElement = this._chart.chartElement();
			const clickedInsideChartElement = chartElement.contains(event.target as Node);

			if (clickedInsideChartElement) {
				handledInteraction = true; // Mark as handled because it's a valid click *inside* the chart
				this._handleStandaloneClick(point);
			} else {
				// Click outside chart. We consider it handled in the sense that we decided to ignore it.
				handledInteraction = true; // Still marked as handled for the purpose of the final fallback reset
			}
		} else {
			// This was a drag that fell through creation/editing. Likely a drag in empty space.
			// Such a drag should typically deselect.
			if (this._isDrag) { // If it was a drag gesture
				handledInteraction = true;
				this.deselectAllTools();
				this._plugin.requestUpdate();
			}
		}


		// --- Final Fallback Reset ---
		// This ensures all interaction state is cleared if the mouseup wasn't part of any recognized gesture,
		// and it shouldn't clear _currentToolCreating if a multi-point tool is awaiting its next point.
		if (!handledInteraction) {
			this._resetInteractionStateFully(); // This version clears everything safely.
		} else {
			// Even if an interaction was handled, we need to clear common gesture state
			this._resetCommonGestureState();
		}
	}

	/**
	 * Clears flags related only to a one-time mouse gesture (drag state, mouse position/time).
	 *
	 * This is used during multi-point creation to reset the interaction flags *without* ending the
	 * overall `_currentToolCreating` process.
	 *
	 * @private
	 */
	private _resetCreationGestureStateOnly(): void {
		this._isDrag = false;
		this._mouseDownPoint = null;
		this._mouseDownTime = 0;
		this._isCreationGesture = false;
		// IMPORTANT: Does NOT touch _currentToolCreating or _activeTool
	}

	/**
	 * Clears flags and state related to an active tool editing/dragging session.
	 *
	 * This includes clearing the dragged tool reference, clearing the cursor override, and
	 * re-enabling the chart's built-in scroll/pan functionality.
	 *
	 * @private
	 */
	private _resetEditingGestureStateOnly(): void {
		
		// Clear Override
        // Important: Clear the override BEFORE nulling _draggedTool
		if (this._draggedTool) {
			this._draggedTool.setOverrideCursor(null);
		}
		// Clear the stored cursor state so the next click starts fresh
        this._activeDragCursor = null;
		
		this._isEditing = false;
		this._draggedTool = null;
		this._draggedPointIndex = null;
		this._dragStartPoint = null;
		this._originalDragPoints = null;
		this._chart.applyOptions({ handleScroll: { pressedMouseMove: true } });
	}

	/**
	 * Clears the most fundamental mouse gesture state variables: drag flag, mouse down point, and time.
	 *
	 * @private
	 */
    private _resetCommonGestureState(): void {
        this._isDrag = false;
        this._mouseDownPoint = null;
        this._mouseDownTime = 0;
    }

	/**
	 * Performs a complete reset of all interaction state flags, including clearing the tool in creation,
	 * deselecting all tools, and requesting a chart update.
	 *
	 * This is typically used as a fallback for unhandled interactions or external API calls (e.g., context menus).
	 *
	 * @private
	 */
	private _resetInteractionStateFully(): void {
		this._resetCreationGestureStateOnly();
		this._resetEditingGestureStateOnly();
		this.setCurrentToolCreating(null); // This also sets _activeTool = null
		this.deselectAllTools(); // Ensures no tool remains selected
		this._plugin.requestUpdate();
	}
	

	/**
	 * Processes a discrete click that occurred outside of an active creation or editing gesture.
	 *
	 * This logic handles selection: if a tool was clicked, it becomes selected; otherwise, all tools are deselected.
	 *
	 * @param point - The screen coordinates of the click event.
	 * @private
	 */
	private _handleStandaloneClick(point: Point): void {
		const clickedTool = point ? this._hitTest(point)?.tool : null;

		if (clickedTool) {
			if (this._selectedTool === clickedTool) return;
			this.deselectAllTools();
			this._selectedTool = clickedTool;
			this._selectedTool.setSelected(true);
		} else {
			this.deselectAllTools();
		}
	}
	
	/**
	 * Handles the chart's double-click event broadcast.
	 *
	 * This method checks for two conditions:
	 * 1. **Creation Finalization:** Ends the drawing process for tools that use `FinalizationMethod.DoubleClick` (e.g., Path tool).
	 * 2. **Event Firing:** Triggers the public `fireDoubleClickEvent` if an existing tool was hit.
	 *
	 * @param params - The event parameters provided by Lightweight Charts.
	 * @private
	 */
	private _handleDblClick(params: MouseEventParams<HorzScaleItem>): void {
		const point = params.point ? new Point(params.point.x, params.point.y) : null;
		if (!point) return;

		// --- 1. Tool Creation Finalization (Path Tool Logic) ---
		// Future Path Tool Logic: End creation on DBLCLICK
		if (this._currentToolCreating) {
			const tool = this._currentToolCreating;

			if (tool.getFinalizationMethod() === FinalizationMethod.DoubleClick) {
				// Tool creation is complete on double-click
				if (tool.getPermanentPointsCount() > 0) {
					// Allow the tool to perform its finalization cleanup (e.g., removing the rogue point)
					tool.handleDoubleClickFinalization();

					this._finalizeToolCreation(tool);
					// Reset the creation state after finalization
					this._resetCreationGestureStateOnly(); 
				} else {
					// If a tool using DoubleClick finalization had no points placed, 
					// treat it as a cancelled creation.
					this.detachTool(tool);
					this._tools.delete(tool.id());
					this.setCurrentToolCreating(null);
				}
				return;
			}
		}

		// --- 2. Hover/Hit Test Logic (Existing Tool Logic) ---
		const hitResult = this._hitTest(point);
		if (hitResult && hitResult.tool) {
			this._plugin.fireDoubleClickEvent(hitResult.tool);
		}
	}
	

	/**
	 * Handles the chart's crosshair move event, used for hover state and ghost-point drawing.
	 *
	 * This method:
	 * 1. Manages the visual state of the tool currently being created (the "ghosting" point), applying Shift-key constraints.
	 * 2. Updates the `_hoveredTool` property and sets its hover state, allowing views to draw hover effects.
	 *
	 * @param params - The event parameters provided by Lightweight Charts.
	 * @private
	 */
	private _handleCrosshairMove(params: MouseEventParams<HorzScaleItem>): void {
		// --- Ghosting Logic ---
		const toolBeingCreated = this._currentToolCreating;
		if (toolBeingCreated) {
			const rawScreenPoint = params.point ? new Point(params.point.x, params.point.y) : null;

            // --- Single-Point Tool Ghosting (Pre-Click Ghosting) ---
            if (rawScreenPoint && toolBeingCreated.pointsCount === 1) {
                // Single point tools are immediately completed on the first click.
                // We use setLastPoint to visualize the *final* tool location pre-click.
                const logicalPoint = this.screenPointToLineToolPoint(rawScreenPoint);
                if (logicalPoint) {
                    toolBeingCreated.setLastPoint(logicalPoint);
                    this._plugin.requestUpdate();
                }
                
                // We SKIP the complex multi-point ghosting and constraint logic below.
                return; 
            }			
 
			// GOTCHA if i used the crosshair subscribe via sourceEvent , TouchMouseEventData, shiftKey it is spotty
			// it will only sometime show shift is true, so i use true browser events to get a reliable stream of shift data
			const isShiftKeyDown = this._isShiftKeyDown;
 
			let finalScreenPoint: Point | null = rawScreenPoint;

			// NEW: Check if the tool supports click-click creation (ghosting is part of this)
			const supportsClickClick = toolBeingCreated.supportsClickClickCreation?.() !== false;

			if (!supportsClickClick) {
				// If the tool does not support click-click, then no ghosting should occur.
				toolBeingCreated.setLastPoint(null); // Clear any ghost
				this._plugin.requestUpdate();
				return;
			}			
			
			// Note: Ghosting only happens *after* the first point (P0) is committed.
			// toolBeingCreated.points().length will be 2 after the 1st click because .points() also looks at _lastPoint to make the length.

			// Only apply constraint if the tool has placed P1 (length is 1) and the Shift key is down
			if (toolBeingCreated.points().length > 0 && rawScreenPoint && isShiftKeyDown && toolBeingCreated.supportsShiftClickClickConstraint?.() === true) {

				// Anchor being dragged is conceptually the second anchor (index 1)
				const anchorIndexBeingDragged = 1;
				const phase: InteractionPhase = InteractionPhase.Creation; // Phase is Creation

				// 1. P0 is the constraint source. It's the first permanent point.
				const anchorIndexUsedForConstraint = 0;
				const originalLogicalPoint = toolBeingCreated.getPoint(anchorIndexUsedForConstraint);
 
				// 2. Construct the full points array needed by the constraint method (just P0 here)
				const allOriginalLogicalPoints: LineToolPoint[] = [originalLogicalPoint as LineToolPoint];

				// Check if the tool implements the optional constraint method
				if (toolBeingCreated.getShiftConstrainedPoint && originalLogicalPoint) {
					// Apply the constraint logic using the correct anchor index
					const constraintResult = toolBeingCreated.getShiftConstrainedPoint( // <<< CHANGE: Capture ConstraintResult
						anchorIndexBeingDragged, 
						rawScreenPoint, 
						phase,
						originalLogicalPoint,
						allOriginalLogicalPoints
					);
					// Extract the Point from the result for ghosting
					finalScreenPoint = constraintResult.point; // <<< CHANGE: Extract Point property
				}
			}

			if (finalScreenPoint) {
				const logicalPoint = this.screenPointToLineToolPoint(finalScreenPoint);

				if (logicalPoint) {
					// We use setLastPoint for ghosting until the final point is committed.
					if (toolBeingCreated.points().length > 0) {
						toolBeingCreated.setLastPoint(logicalPoint);
					}
				} else {
					toolBeingCreated.setLastPoint(null);
				}
			} else {
				toolBeingCreated.setLastPoint(null);
			}

			this._plugin.requestUpdate(); 
			return;
		}

		// --- Hover Logic ---
		const point = params.point ? new Point(params.point.x, params.point.y) : null;
		const hitResult = point ? this._hitTest(point) : null;
		const hoveredTool = hitResult ? hitResult.tool : null;

		if (this._hoveredTool && this._hoveredTool !== hoveredTool) {
			this._hoveredTool.setHovered(false);
		}

		this._hoveredTool = hoveredTool;
		if (hoveredTool) {
			hoveredTool.setHovered(true);
		}
	}

	/**
	 * Performs a hit test on all visible line tools, iterating them in reverse Z-order (top-most first).
	 *
	 * @param point - The screen coordinates to test against all tools.
	 * @returns An object containing the hit tool, the hit point index, and the suggested cursor type, or `null` if no tool was hit.
	 * @private
	 */
	private _hitTest(point: Point): { tool: BaseLineTool<HorzScaleItem>, pointIndex: number | null, suggestedCursor: PaneCursorType | null } | null {
		// Iterate in reverse for Z-order (topmost first)
		const tools = Array.from(this._tools.values()).reverse();

		for (const tool of tools) {
			if(!tool.options().visible) {
				continue;
			}
 
			const hitResult = tool._internalHitTest(point.x, point.y);

			if (hitResult) {
				return { 
					tool: tool,
					// The data() method gives us the payload, which is { pointIndex, cursorType }
					pointIndex: hitResult.data()?.pointIndex ?? null,
                    // [NEW] Pass the cursor through
                    suggestedCursor: hitResult.data()?.suggestedCursor ?? null
				};
			}
		}
		return null;
	}	

	/**
	 * Clears the selection state of the currently selected tool, if one exists.
	 *
	 * This is a public utility often called by the {@link LineToolsCorePlugin} or by the `InteractionManager`'s internal logic.
	 *
	 * @returns void
	 */
	public deselectAllTools(): void { // MODIFIED: Made public with a clear name
		//console.log('inside deselectAll for CorePlugin call')
		if (this._selectedTool) {
			//console.log('inside selectedTool')
			this._selectedTool.setSelected(false);
			this._selectedTool = null;
			this._plugin.requestUpdate();
		}
	}

	/**
	 * Converts a raw browser `MouseEvent` (which uses screen coordinates) into a chart-relative
	 * {@link Point} object (CSS pixels relative to the chart canvas).
	 *
	 * @param event - The browser's MouseEvent.
	 * @returns A chart-relative {@link Point} object, or `null` if the chart element bounding box cannot be retrieved.
	 * @private
	 */
	private _eventToPoint(event: MouseEvent): Point | null {
		const rect = this._chart.chartElement().getBoundingClientRect();
		return new Point(event.clientX - rect.left, event.clientY - rect.top);
	}
}