import React, { useRef } from 'react';
import { useAnimate } from 'motion/react';
import { PositionDirection } from '../../types/game';
import { MICRO, useMotionPref } from '../../ui/motion';
import { Icon, SegmentedTabs, type SegmentedTabsItem } from '../../ui/lucky';
import { cn } from '../../ui/cn';

interface DirectionToggleProps {
  value: PositionDirection | null;
  onChange: (direction: PositionDirection) => void;
  className?: string;
}

const PRESS_SCALE = 0.97;
const TAB_SELECTOR = '.lg-tab';

const directionItem = (
  direction: PositionDirection,
  selected: PositionDirection | null
): SegmentedTabsItem<PositionDirection> => {
  const on = direction === selected;
  const toneText = direction === 'LONG' ? 'text-dir-long' : 'text-dir-short';
  return {
    value: direction,
    tone: on ? (direction === 'LONG' ? 'long' : 'short') : 'default',
    icon: <Icon name={direction === 'LONG' ? 'tri-up' : 'tri-down'} size={16} />,
    label: <span className={cn('font-extrabold', on && toneText)}>{direction}</span>,
  };
};

export const DirectionToggle: React.FC<DirectionToggleProps> = ({ value, onChange, className }) => {
  const reduced = useMotionPref();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const pressedRef = useRef<HTMLElement | null>(null);

  const release = () => {
    const el = pressedRef.current;
    pressedRef.current = null;
    if (el) animate(el, { scale: 1 }, MICRO);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(TAB_SELECTOR) : null;
    if (!target) return;
    pressedRef.current = target;
    animate(target, { scale: PRESS_SCALE }, MICRO);
  };

  return (
    <div
      ref={scope}
      onPointerDownCapture={handlePointerDown}
      onPointerUpCapture={release}
      onPointerCancelCapture={release}
      onPointerLeave={release}
      className={className}
    >
      <SegmentedTabs<PositionDirection>
        role="radiogroup"
        surface="sheet"
        ariaLabel="Direction"
        value={value}
        onChange={onChange}
        items={[directionItem('LONG', value), directionItem('SHORT', value)]}
        className="[&_.lg-tab]:h-14 [&_.lg-tab]:justify-center [&_.lg-tab]:px-2 [&_.lg-tab]:py-0"
      />
    </div>
  );
};
