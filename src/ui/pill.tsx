import type { ReactNode } from 'react';

export type PillTone = 'ok' | 'info' | 'warn' | 'bad' | 'grey' | 'blue';

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`pill p-${tone}`}>{children}</span>;
}
