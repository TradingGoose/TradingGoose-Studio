// /src/views/LineToolArrowPaneView.ts

import { LineToolTrendLinePaneView } from '../../shared/lines/views/LineToolTrendLinePaneView'

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
  // NOTE: No need to override the renderer() or _updateImpl() as the parent's logic is fully reusable.
}
