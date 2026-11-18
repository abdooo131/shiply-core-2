'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Toast } from '@/ui/toast';

// Copy the bank reference and print the proof, like the mockup's transferProof footer.
export function ProofActions({ bankReference }: { bankReference: string | null }) {
  const t = useTranslations('wallet.proof');
  const [message, setMessage] = useState<string | null>(null);

  const copyReference = async () => {
    if (!bankReference) return;
    try {
      await navigator.clipboard.writeText(bankReference);
      setMessage(t('copied'));
    } catch {
      setMessage(t('referenceIs', { reference: bankReference }));
    }
  };

  return (
    <>
      {bankReference ? (
        <Button onClick={copyReference}>
          <Icon name="doc" size={15} /> {t('copyReference')}
        </Button>
      ) : null}
      <Button variant="primary" onClick={() => window.print()} data-testid="print-proof">
        <Icon name="print" size={15} /> {t('print')}
      </Button>
      <Toast key={message ?? ''} message={message} />
    </>
  );
}
