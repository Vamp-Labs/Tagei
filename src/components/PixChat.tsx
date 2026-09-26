import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
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
  text: string;
}

/**
 * docs/UI_UX_SPEC.md §10. No real chat backend exists in this app, so this
 * stays a scripted demo of the screen's shape: quick prompts fire canned
 * replies drawn from pixAI.ts's getPreTradeInsight — a real, previously
 * orphaned service (confirmed dead code earlier this session), not fake
 * copy invented for this screen.
 */
export const PixChat: React.FC<PixChatProps> = ({ currentAsset, change24h, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);

  const ask = (prompt: string) => {
    const insight = PixAIService.getPreTradeInsight(currentAsset, change24h);
    setMessages((prev) => [
      ...prev,
      { from: 'user', text: prompt },
      { from: 'pix', text: `${insight.headline}. ${insight.summary}` },
    ]);
  };

  return (
    <Sheet onClose={onClose} className="h-[70vh]">
      <div className="flex items-center gap-2 px-5 pt-1 pb-4">
        <Sparkles className="w-4 h-4 text-[color:var(--color-bnb-yellow)]" />
        <h2 className="text-[length:var(--text-screen-title)] font-black text-[color:var(--color-text-1)]">
          PIX AI
        </h2>
      </div>

      <div className="flex-1 px-5 flex flex-col gap-3">
        {messages.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-[length:var(--text-body)] font-bold text-[color:var(--color-text-1)] mb-1">
              Hey, I'm PIX 👋
            </p>
            <p className="text-[length:var(--text-metadata)] text-[color:var(--color-text-2)]">
              Your AI co-pilot for smarter trades.
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] px-3.5 py-2.5 rounded-[var(--radius-md)] text-[length:var(--text-metadata)] ${
                m.from === 'user'
                  ? 'self-end bg-[color:var(--color-bnb-yellow)] text-black font-semibold'
                  : 'self-start bg-[color:var(--color-panel-soft)] border border-[color:var(--color-line)] text-[color:var(--color-text-1)]'
              }`}
            >
              {m.text}
            </div>
          ))
        )}
      </div>

      <div className="px-5 py-4 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => ask(prompt)}
              className="px-3 h-9 rounded-full border border-[color:var(--color-line)] text-[length:var(--text-micro)] font-semibold text-[color:var(--color-text-2)] hover:text-[color:var(--color-text-1)] hover:border-[color:var(--color-bnb-yellow)]/40 transition-colors cursor-pointer"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 h-[var(--tap-min)] px-3 rounded-[var(--radius-md)] bg-[color:var(--color-bg-1)] border border-[color:var(--color-line)] opacity-60">
          <span className="flex-1 text-[length:var(--text-body)] text-[color:var(--color-text-3)]">
            Ask me anything…
          </span>
          <Send className="w-4 h-4 text-[color:var(--color-text-3)]" />
        </div>
      </div>
    </Sheet>
  );
};
