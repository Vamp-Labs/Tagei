import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import '../index.css';
import { cn } from '../ui/cn';
import { PixAvatar } from '../components/pix/PixAvatar';
import type { PixExpression } from '../components/pix/expressions';
import type { PixMood } from '../components/pix/mood';

// Headless Chrome's software compositor mis-paints page text black once ~15+ Motion SVG trees mount at once under forced reduced motion, so cells mount lazily.
const LAZY_MOUNT_MARGIN = '150px';

interface Entry {
  expression: PixExpression;
  mood: PixMood;
  label: string;
  direction?: 'LONG' | 'SHORT';
}

const ENTRIES: Entry[] = [
  { expression: 'idle', mood: 'neutral', label: 'idle' },
  { expression: 'ready', mood: 'neutral', label: 'ready (LONG)', direction: 'LONG' },
  { expression: 'ready', mood: 'neutral', label: 'ready (SHORT)', direction: 'SHORT' },
  { expression: 'happy', mood: 'happy', label: 'happy' },
  { expression: 'alert', mood: 'concerned', label: 'alert' },
  { expression: 'celebrate', mood: 'happy', label: 'celebrate' },
  { expression: 'concerned', mood: 'concerned', label: 'concerned' },
  { expression: 'loading', mood: 'neutral', label: 'loading' },
  { expression: 'thinking', mood: 'neutral', label: 'thinking' },
  { expression: 'wave', mood: 'neutral', label: 'wave' },
];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-micro font-bold uppercase tracking-[0.08em] text-lucky">{title}</h2>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">{children}</div>
  </section>
);

const Cell: React.FC<{ entry: Entry; size: number }> = ({ entry, size }) => (
  <div className="flex flex-col items-center gap-2 rounded-md bg-well p-4">
    <PixAvatar mood={entry.mood} expression={entry.expression} direction={entry.direction} size={size} />
    <span className="text-micro text-ink-muted">{entry.label}</span>
  </div>
);

const LazyCell: React.FC<{ entry: Entry; size: number }> = ({ entry, size }) => {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      ([firstEntry]) => {
        if (firstEntry.isIntersecting) setVisible(true);
      },
      { rootMargin: LAZY_MOUNT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref}>
      {visible ? (
        <Cell entry={entry} size={size} />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-md bg-well p-4">
          <span className="rounded-full bg-tile" style={{ width: size, height: size }} />
          <span className="text-micro text-ink-muted">{entry.label}</span>
        </div>
      )}
    </div>
  );
};

const PixGallery: React.FC = () => {
  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) document.documentElement.dataset.sceneReady = '1';
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className={cn('mx-auto flex min-h-full max-w-2xl flex-col gap-8 bg-sheet px-6 pb-16 pt-6 font-sans')}>
        <header className="flex flex-col gap-1">
          <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-muted">dev gallery</span>
          <h1 className="text-display">
            <span className="text-brand">PIX</span> Expressions
          </h1>
        </header>

        <Section title="40px">
          {ENTRIES.map((entry, i) => (
            <LazyCell key={`40-${i}`} entry={entry} size={40} />
          ))}
        </Section>

        <Section title="72px">
          {ENTRIES.map((entry, i) => (
            <LazyCell key={`72-${i}`} entry={entry} size={72} />
          ))}
        </Section>
      </main>
    </MotionConfig>
  );
};

const root = document.getElementById('root');
if (root) {
  document.documentElement.style.overflow = 'auto';
  document.body.style.overflow = 'auto';
  document.body.style.height = 'auto';
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <PixGallery />
    </React.StrictMode>
  );
}
