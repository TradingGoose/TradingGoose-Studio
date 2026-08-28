// /src/views/LineToolExtendedLinePaneView.ts

import { LineToolTrendLinePaneView } from '../../shared/lines/views/LineToolTrendLinePaneView'

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
export class LineToolExtendedLinePaneView<
  HorzScaleItem,
> extends LineToolTrendLinePaneView<HorzScaleItem> {
  // NOTE: No need to override the renderer() or _updateImpl() if the parent correctly
  // reads and uses the tool's options() which now contains the 'extend: { left: true, right: true }' property.
}
