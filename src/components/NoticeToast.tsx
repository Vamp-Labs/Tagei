import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { STANDARD } from '../ui/motion';
import { Button } from '../ui/lucky';

export interface NoticeToastProps {
  notice: { id: number; title: string; body: string } | null;
  onDismiss: (id: number) => void;
}

const AUTO_DISMISS_MS = 4_200;

export const NoticeToast: React.FC<NoticeToastProps> = ({ notice, onDismiss }) => {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => onDismissRef.current(notice.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div aria-live="assertive" className="contents">
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice.id}
            role="alert"
            initial={{ opacity: 0, x: '-50%', y: -24 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%', y: -24 }}
            transition={STANDARD}
            className="fixed left-1/2 z-50 w-[92%] max-w-sm pointer-events-auto"
            style={{ top: 'calc(var(--sa-top) + 0.5rem)' }}
          >
            <div className="lg-card rounded-lg flex items-start gap-3 p-3 pl-4">
              <div className="min-w-0 flex-1 py-1">
                <p className="text-label font-extrabold uppercase tracking-[0.06em] text-ink">{notice.title}</p>
                {notice.body && <p className="text-caption text-ink-soft">{notice.body}</p>}
              </div>
              <Button variant="icon" size="md" icon="close" aria-label="Dismiss" onClick={() => onDismiss(notice.id)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
