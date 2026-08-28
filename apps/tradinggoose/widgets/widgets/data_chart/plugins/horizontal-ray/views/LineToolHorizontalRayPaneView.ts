// /src/views/LineToolHorizontalRayPaneView.ts

import { LineToolHorizontalLinePaneView } from '../../shared/lines/views/LineToolHorizontalLinePaneView'

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
export class LineToolHorizontalRayPaneView<
  HorzScaleItem,
> extends LineToolHorizontalLinePaneView<HorzScaleItem> {
  // NOTE: No methods are overridden as the inherited logic is fully reusable.
}
