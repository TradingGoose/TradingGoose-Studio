// /src/views/LineToolRayPaneView.ts

import { LineToolTrendLinePaneView } from '../../shared/lines/views/LineToolTrendLinePaneView'

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
  // NOTE: No need to override the renderer() or _updateImpl() as the parent's logic is fully reusable.
}
