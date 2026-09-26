import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { Sheet } from '../ui/Sheet';
import { MICRO, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import { Icon, SheetHeader } from '../ui/lucky';
import { PixAvatar } from './pix/PixAvatar';
import type { PixExpression } from './pix/expressions';
import { PIX_DISCLAIMER, PixAIService } from '../services/pixAI';
import type { PixChatMessage } from '../api/schemas';
import { AssetSymbol } from '../types/market';

interface PixChatProps {
  currentAsset: AssetSymbol;
  change24h: number;
  onClose: () => void;
}

const quickPrompts = (asset: AssetSymbol) => [
  `What's the trend for ${asset}?`,
  'Is it a good time to go long?',
  'Explain this chart',
  'Show key support levels',
];

interface Message {
  id: number;
  from: 'pix' | 'user';
  text: string;
  streaming?: boolean;
}

const EMPTY_AVATAR_SIZE = 72;
const CHIP_PRESS_SCALE = 0.97;
const MAX_PROMPT_LENGTH = 500;
const WAVE_DURATION_MS = 1200;

const toHistory = (messages: readonly Message[]): PixChatMessage[] =>
  messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => ({ role: message.from === 'user' ? 'user' : 'assistant', content: message.text }));

export const PixChat: React.FC<PixChatProps> = ({ currentAsset, change24h, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [waving, setWaving] = useState(true);
  const reduced = useMotionPref();
  const abortRef = useRef<AbortController | null>(null);
  const nextIdRef = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setWaving(false), WAVE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const faceExpression: PixExpression = busy ? 'thinking' : waving ? 'wave' : 'idle';

  const ask = async (prompt: string) => {
    const text = prompt.trim().slice(0, MAX_PROMPT_LENGTH);
    if (!text || busy) return;
    const user: Message = { id: nextIdRef.current++, from: 'user', text };
    const replyId = nextIdRef.current++;
    const history = toHistory([...messagesRef.current, user]);
    setMessages((prev) => [...prev, user, { id: replyId, from: 'pix', text: '', streaming: true }]);
    setDraft('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const append = (delta: string) =>
      setMessages((prev) => prev.map((message) => (message.id === replyId ? { ...message, text: message.text + delta } : message)));
    try {
      await PixAIService.chat(history, { asset: currentAsset, change24h }, append, { signal: controller.signal });
    } finally {
      if (!controller.signal.aborted) {
        setMessages((prev) => prev.map((message) => (message.id === replyId ? { ...message, streaming: false } : message)));
        setBusy(false);
      }
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
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
              <PixAvatar mood="neutral" size={EMPTY_AVATAR_SIZE} expression={faceExpression} />
              <p className="text-section text-ink">Hey, I'm PIX</p>
              <p className="text-caption text-ink-soft">Your AI co-pilot for smarter trades.</p>
            </div>
          ) : (
            messages.map((m) => (
              <motion.div
                key={m.id}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={MICRO}
                aria-busy={m.streaming || undefined}
                className={cn(
                  'max-w-[85%] rounded-md px-4 py-3 text-caption whitespace-pre-wrap',
                  m.from === 'user' ? 'self-end bg-lucky-tint text-ink font-semibold' : 'self-start bg-panel border border-line text-ink-soft',
                )}
              >
                {m.text || (m.streaming ? <span className="text-ink-muted">thinking…</span> : null)}
              </motion.div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-3 px-6 pt-4 pb-2">
          <div className="flex flex-wrap gap-2">
            {quickPrompts(currentAsset).map((prompt, i) => (
              <motion.button
                key={prompt}
                type="button"
                onClick={() => void ask(prompt)}
                disabled={busy}
                whileTap={reduced ? undefined : { scale: CHIP_PRESS_SCALE }}
                transition={MICRO}
                data-scene-target={i === 0 ? 'pix-prompt' : undefined}
                className="h-11 rounded-md bg-control px-4 text-caption font-semibold text-ink-secondary transition-colors hover:bg-control-hover hover:text-ink cursor-pointer disabled:cursor-default disabled:opacity-60"
              >
                {prompt}
              </motion.button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="flex h-12 items-center gap-2 rounded-md bg-well pl-4 pr-1 border border-line">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={MAX_PROMPT_LENGTH}
              aria-label="Message PIX"
              placeholder="Ask me anything…"
              className="min-w-0 flex-1 bg-transparent text-caption text-ink placeholder:text-ink-muted outline-none"
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0}
              aria-label="Send message"
              className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-secondary disabled:text-ink-muted cursor-pointer disabled:cursor-default"
            >
              <Icon name="send" size={20} />
            </button>
          </form>
          <p className="text-micro text-ink-muted">{PIX_DISCLAIMER}</p>
        </div>
      </div>
    </Sheet>
  );
};
