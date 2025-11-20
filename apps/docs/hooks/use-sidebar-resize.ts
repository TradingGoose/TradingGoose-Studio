import { useCallback, useEffect, useMemo, useRef } from 'react';

export interface UseSidebarResizeProps {
  /**
   * Direction of the resize handle
   * - 'left': Handle is on left side (for right-positioned panels)
   * - 'right': Handle is on right side (for left-positioned panels)
   */
  direction?: 'left' | 'right';

  /**
   * Current width of the panel
   */
  currentWidth: string;

  /**
   * Callback to update width when resizing
   */
  onResize: (width: string) => void;

  /**
   * Callback to toggle panel visibility
   */
  onToggle?: () => void;

  /**
   * Whether the panel is currently collapsed
   */
  isCollapsed?: boolean;

  /**
   * Minimum resize width
   */
  minResizeWidth?: string;

  /**
   * Maximum resize width
   */
  maxResizeWidth?: string;

  /**
   * Whether to enable auto-collapse when dragged below threshold
   */
  enableAutoCollapse?: boolean;

  /**
   * Auto-collapse threshold as percentage of minResizeWidth
   * A value of 1.0 means the panel will collapse when dragged to minResizeWidth
   * A value of 0.5 means the panel will collapse when dragged to 50% of minResizeWidth
   * A value of 1.5 means the panel will collapse when dragged to 50% beyond minResizeWidth
   * Can be any positive number, not limited to the range 0.0-1.0
   */
  autoCollapseThreshold?: number;

  /**
   * Threshold to expand when dragging in opposite direction (0.0-1.0)
   * Percentage of distance needed to drag back to expand
   */
  expandThreshold?: number;

  /**
   * Whether to enable drag functionality
   */
  enableDrag?: boolean;

  /**
   * Callback to update dragging rail state
   */
  setIsDraggingRail?: (isDragging: boolean) => void;

  /**
   * Cookie name for persisting width
   */
  widthCookieName?: string;

  /**
   * Cookie max age in seconds
   */
  widthCookieMaxAge?: number;

  /**
   * Whether this is a nested sidebar (not at the edge of the screen)
   */
  isNested?: boolean;

  /**
   * Whether to enable toggle functionality
   */
  enableToggle?: boolean;
}

interface WidthUnit {
  value: number;
  unit: 'rem' | 'px';
}

function parseWidth(width: string): WidthUnit {
  const unit = width.endsWith('rem') ? 'rem' : 'px';
  const value = Number.parseFloat(width);
  return { value, unit };
}

function toPx(width: string): number {
  const { value, unit } = parseWidth(width);
  return unit === 'rem' ? value * 16 : value;
}

function formatWidth(value: number, unit: 'rem' | 'px'): string {
  return `${unit === 'rem' ? value.toFixed(1) : Math.round(value)}${unit}`;
}

/**
 * A versatile hook for handling resizable sidebar (or inset) panels
 * Works for both sidebar (left side) and artifacts (right side) panels
 * Supports VS Code-like continuous drag to collapse/expand
 */
export function useSidebarResize({
  direction = 'right',
  currentWidth,
  onResize,
  onToggle,
  isCollapsed = false,
  minResizeWidth = '14rem',
  maxResizeWidth = '24rem',
  enableToggle = true,
  enableAutoCollapse = true,
  autoCollapseThreshold = 1.5,
  expandThreshold = 0.2,
  enableDrag = true,
  setIsDraggingRail = () => {},
  widthCookieName,
  widthCookieMaxAge = 60 * 60 * 24 * 7,
  isNested = false,
}: UseSidebarResizeProps) {
  const dragRef = useRef<HTMLButtonElement>(null);
  const startWidth = useRef(0);
  const startX = useRef(0);
  const isDragging = useRef(false);
  const isInteractingWithRail = useRef(false);
  const lastWidth = useRef(0);
  const lastLoggedWidth = useRef(0);
  const dragStartPoint = useRef(0);
  const lastDragDirection = useRef<'expand' | 'collapse' | null>(null);
  const lastTogglePoint = useRef(0);
  const lastToggleWidth = useRef(0);
  const toggleCooldown = useRef(false);
  const lastToggleTime = useRef(0);
  const dragDistanceFromToggle = useRef(0);
  const dragOffset = useRef(0);
  const railRect = useRef<DOMRect | null>(null);
  const autoCollapseThresholdPx = useRef(0);

  const minWidthPx = useMemo(() => toPx(minResizeWidth), [minResizeWidth]);
  const maxWidthPx = useMemo(() => toPx(maxResizeWidth), [maxResizeWidth]);

  const isIncreasingWidth = useCallback(
    (currentX: number, referenceX: number): boolean => {
      return direction === 'left'
        ? currentX < referenceX
        : currentX > referenceX;
    },
    [direction],
  );

  const calculateWidth = useCallback(
    (
      e: MouseEvent,
      initialX: number,
      initialWidth: number,
      currentRailRect: DOMRect | null,
    ): number => {
      if (isNested && currentRailRect) {
        const deltaX = e.clientX - initialX;
        if (direction === 'left') return initialWidth - deltaX;
        return initialWidth + deltaX;
      }
      if (direction === 'left') {
        return window.innerWidth - e.clientX;
      }
      return e.clientX;
    },
    [direction, isNested],
  );

  useEffect(() => {
    autoCollapseThresholdPx.current = enableAutoCollapse
      ? minWidthPx * autoCollapseThreshold
      : 0;
  }, [minWidthPx, enableAutoCollapse, autoCollapseThreshold]);

  const persistWidth = useCallback(
    (width: string) => {
      if (widthCookieName) {
        document.cookie = `${widthCookieName}=${width}; path=/; max-age=${widthCookieMaxAge}`;
      }
    },
    [widthCookieName, widthCookieMaxAge],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isInteractingWithRail.current = true;
      if (!enableDrag) return;

      const currentWidthPx = isCollapsed ? 0 : toPx(currentWidth);
      startWidth.current = currentWidthPx;
      startX.current = e.clientX;
      dragStartPoint.current = e.clientX;
      lastWidth.current = currentWidthPx;
      lastLoggedWidth.current = currentWidthPx;
      lastTogglePoint.current = e.clientX;
      lastToggleWidth.current = currentWidthPx;
      lastDragDirection.current = null;
      toggleCooldown.current = false;
      lastToggleTime.current = 0;
      dragDistanceFromToggle.current = 0;
      dragOffset.current = 0;

      railRect.current = isNested && dragRef.current
        ? dragRef.current.getBoundingClientRect()
        : null;

      e.preventDefault();
    },
    [enableDrag, isCollapsed, currentWidth, isNested],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isInteractingWithRail.current) return;

      const deltaX = Math.abs(e.clientX - startX.current);
      if (!isDragging.current && deltaX > 5) {
        isDragging.current = true;
        setIsDraggingRail(true);
      }

      if (!isDragging.current) return;

      const { unit } = parseWidth(currentWidth);
      const currentRailRect = isNested && dragRef.current
        ? dragRef.current.getBoundingClientRect()
        : railRect.current;

      const currentDragDirection = isIncreasingWidth(
        e.clientX,
        lastTogglePoint.current,
      )
        ? 'expand'
        : 'collapse';

      if (lastDragDirection.current !== currentDragDirection) {
        lastDragDirection.current = currentDragDirection;
      }

      dragDistanceFromToggle.current = Math.abs(
        e.clientX - lastTogglePoint.current,
      );

      const now = Date.now();
      if (toggleCooldown.current && now - lastToggleTime.current > 200) {
        toggleCooldown.current = false;
      }

      if (!toggleCooldown.current) {
        if (enableAutoCollapse && onToggle && !isCollapsed) {
          const currentDragWidth = calculateWidth(
            e,
            startX.current,
            startWidth.current,
            currentRailRect,
          );

          let shouldCollapse = false;
          if (autoCollapseThreshold <= 1.0) {
            shouldCollapse =
              currentDragWidth <= minWidthPx * autoCollapseThreshold;
          } else if (currentDragWidth <= minWidthPx) {
            const extraDragNeeded = minWidthPx * (autoCollapseThreshold - 1.0);
            const distanceBeyondMin = minWidthPx - currentDragWidth;
            shouldCollapse = distanceBeyondMin >= extraDragNeeded;
          }

          if (currentDragDirection === 'collapse' && shouldCollapse) {
            onToggle();
            lastTogglePoint.current = e.clientX;
            lastToggleWidth.current = 0;
            toggleCooldown.current = true;
            lastToggleTime.current = now;
            return;
          }
        }

        if (
          onToggle &&
          isCollapsed &&
          currentDragDirection === 'expand' &&
          dragDistanceFromToggle.current > minWidthPx * expandThreshold
        ) {
          onToggle();

          const initialWidth = calculateWidth(
            e,
            startX.current,
            startWidth.current,
            currentRailRect,
          );
          const clampedWidth = Math.max(
            minWidthPx,
            Math.min(maxWidthPx, initialWidth),
          );
          const formattedWidth = formatWidth(
            unit === 'rem' ? clampedWidth / 16 : clampedWidth,
            unit,
          );
          onResize(formattedWidth);
          persistWidth(formattedWidth);

          lastTogglePoint.current = e.clientX;
          lastToggleWidth.current = clampedWidth;
          toggleCooldown.current = true;
          lastToggleTime.current = now;
          return;
        }
      }

      if (isCollapsed) return;

      const newWidthPx = calculateWidth(
        e,
        startX.current,
        startWidth.current,
        currentRailRect,
      );
      const clampedWidthPx = Math.max(
        minWidthPx,
        Math.min(maxWidthPx, newWidthPx),
      );
      const newWidth = unit === 'rem' ? clampedWidthPx / 16 : clampedWidthPx;
      const formattedWidth = formatWidth(newWidth, unit);
      onResize(formattedWidth);
      persistWidth(formattedWidth);

      lastWidth.current = clampedWidthPx;
    };

    const handleMouseUp = () => {
      if (!isInteractingWithRail.current) return;

      if (!isDragging.current && onToggle && enableToggle) {
        onToggle();
      }

      isDragging.current = false;
      isInteractingWithRail.current = false;
      lastWidth.current = 0;
      lastLoggedWidth.current = 0;
      lastDragDirection.current = null;
      lastTogglePoint.current = 0;
      lastToggleWidth.current = 0;
      toggleCooldown.current = false;
      lastToggleTime.current = 0;
      dragDistanceFromToggle.current = 0;
      dragOffset.current = 0;
      railRect.current = null;
      setIsDraggingRail(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    onResize,
    onToggle,
    isCollapsed,
    currentWidth,
    persistWidth,
    setIsDraggingRail,
    minWidthPx,
    maxWidthPx,
    isIncreasingWidth,
    calculateWidth,
    isNested,
    enableAutoCollapse,
    autoCollapseThreshold,
    expandThreshold,
    enableToggle,
  ]);

  return {
    dragRef,
    isDragging,
    handleMouseDown,
  };
}
