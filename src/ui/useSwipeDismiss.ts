import { useRef } from 'react';
import { useDragControls } from 'motion/react';
import type { PanInfo } from 'motion/react';
import { DISMISS_OFFSET, DISMISS_VELOCITY } from './motion';

type Axis = 'x' | 'y';

interface SwipeDismissOptions {
  axis?: Axis;
  /** 1 dismisses toward positive offset (down / right), -1 the other way. */
  direction?: 1 | -1;
  offsetThreshold?: number;
  velocityThreshold?: number;
  onDismiss: () => void;
}

/**
 * Drag-to-dismiss for panels that also scroll internally. The drag is started
 * manually so a swipe inside a scrolled body scrolls instead of dismissing —
 * it only takes over once the scroll container is back at the top.
 */
export const useSwipeDismiss = ({
  axis = 'y',
  direction = 1,
  offsetThreshold = DISMISS_OFFSET,
  velocityThreshold = DISMISS_VELOCITY,
  onDismiss,
}: SwipeDismissOptions) => {
  const dragControls = useDragControls();
  const scrollRef = useRef<HTMLDivElement>(null);

  const startDrag = (event: React.PointerEvent) => {
    if ((scrollRef.current?.scrollTop ?? 0) > 0) return;
    dragControls.start(event);
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const offset = info.offset[axis] * direction;
    const velocity = info.velocity[axis] * direction;
    if (offset > offsetThreshold || velocity > velocityThreshold) onDismiss();
  };

  return {
    scrollRef,
    dragControls,
    startDrag,
    dragProps: {
      drag: axis,
      dragListener: false,
      dragControls,
      dragElastic: 0.18,
      dragSnapToOrigin: true,
      dragConstraints:
        axis === 'y'
          ? direction === 1
            ? { top: 0, bottom: 0 }
            : { top: 0, bottom: 0 }
          : { left: 0, right: 0 },
      onDragEnd: handleDragEnd,
    } as const,
  };
};
