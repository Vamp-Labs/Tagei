import { useState } from 'react';
import { motion } from 'motion/react';
import { Send } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { MICRO, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import { SheetHeader } from '../ui/lucky';
import { PixAvatar } from './pix/PixAvatar';
import { PixAIService } from '../services/pixAI';
import { AssetSymbol } from '../types/market';

interface PixChatProps {
  currentAsset: AssetSymbol;
  change24h: number;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  "What's the trend for BNB?",
  'Is it a good time to go long?',
  'Explain this chart',
  'Show key support levels',
];

interface Message {
  from: 'pix' | 'user';
  title?: string;
  text: string;
}

const EMPTY_AVATAR_SIZE = 72;
const CHIP_PRESS_SCALE = 0.97;

/**
 * docs/UI_UX_SPEC.md §10. No real chat backend exists in this app, so this
 * stays a scripted demo of the screen's shape: quick prompts fire canned
 * replies drawn from pixAI.ts's getPreTradeInsight — a real, previously
 * orphaned service (confirmed dead code earlier this session), not fake
 * copy invented for this screen.
 */
export const PixChat: React.FC<PixChatProps> = ({ currentAsset, change24h, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const reduced = useMotionPref();

  const ask = (prompt: string) => {
    const insight = PixAIService.getPreTradeInsight(currentAsset, change24h);
    setMessages((prev) => [
      ...prev,
      { from: 'user', text: prompt },
      { from: 'pix', title: insight.headline, text: insight.summary },
    ]);
  };

  return (
    <Sheet onClose={onClose} className="h-[70vh]">
      <div className="flex min-h-full flex-col">
        <SheetHeader
          title={
            <>
              <span className="text-brand">PIX</span> AI
            </>
          }
          subtitle="your trading co-pilot"
        />

        <div role="log" aria-live="polite" aria-label="PIX conversation" className="flex flex-1 flex-col gap-3 px-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <PixAvatar mood="neutral" size={EMPTY_AVATAR_SIZE} />
              <p className="text-section text-ink">Hey, I'm PIX</p>
              <p className="text-caption text-ink-soft">Your AI co-pilot for smarter trades.</p>
            </div>
          ) : (
            messages.map((m, i) => (
              <motion.div
                key={i}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={MICRO}
                className={cn(
                  'max-w-[85%] rounded-md px-4 py-3 text-caption',
                  m.from === 'user'
                    ? 'self-end bg-lucky-tint text-ink font-semibold'
                    : 'self-start bg-panel border border-line text-ink-soft',
                )}
              >
                {m.title && <p className="font-semibold text-ink">{m.title}</p>}
                <p>{m.text}</p>
              </motion.div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-3 px-6 pt-4 pb-2">
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((prompt, i) => (
              <motion.button
                key={prompt}
                type="button"
                onClick={() => ask(prompt)}
                whileTap={reduced ? undefined : { scale: CHIP_PRESS_SCALE }}
                transition={MICRO}
                data-scene-target={i === 0 ? 'pix-prompt' : undefined}
                className="h-11 rounded-md bg-control px-4 text-caption font-semibold text-ink-secondary transition-colors hover:bg-control-hover hover:text-ink cursor-pointer"
              >
                {prompt}
              </motion.button>
            ))}
          </div>

          <label className="flex h-12 items-center gap-3 rounded-md bg-well px-4 border border-line cursor-not-allowed">
            <input
              type="text"
              disabled
              aria-disabled="true"
              aria-label="Message PIX"
              placeholder="Ask me anything…"
              className="min-w-0 flex-1 bg-transparent text-caption text-ink placeholder:text-ink-muted outline-none cursor-not-allowed"
            />
            <Send className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
          </label>
        </div>
      </div>
    </Sheet>
  );
};
