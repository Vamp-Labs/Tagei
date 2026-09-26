import React, { useState } from 'react';
import { web3Service } from '../../services/web3Service';
import { Button, Panel } from '../../ui/lucky';

type CopyState = 'idle' | 'copied' | 'failed';

export const GuestKeyCard: React.FC = () => {
  const [key, setKey] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>('idle');

  const reveal = () => {
    setCopy('idle');
    setKey(key ? null : (web3Service.exportGuestKey()?.privateKey ?? null));
  };

  const copyKey = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <Panel title="Guest key" className="flex flex-col gap-3 p-3 pt-4">
      <p className="px-1 text-caption text-ink-soft">
        Your guest account lives in this browser. Save the key to restore it elsewhere. Anyone with it controls your test
        credits.
      </p>
      {key && (
        <p className="break-all rounded-md bg-well px-3 py-2 text-caption tabular-nums text-ink-secondary select-all">
          {key}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="md" block onClick={reveal}>
          {key ? 'Hide key' : 'Show key'}
        </Button>
        {key && (
          <Button variant="secondary" size="md" block onClick={() => void copyKey()}>
            {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed' : 'Copy'}
          </Button>
        )}
      </div>
    </Panel>
  );
};
