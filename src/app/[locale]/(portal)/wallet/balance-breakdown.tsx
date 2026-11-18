'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/ui/icon';

const GAP_PX = 8;
const EDGE_PX = 8;

export type BreakdownView = {
  processingText: string;
  inNextCashOutText: string;
  paidOutText: string;
  paidOutCount: number;
  balanceText: string;
};

// "View breakdown" on the balance card: what makes up the balance, like the mockup's balancePop.
export function BalanceBreakdown({ view }: { view: BreakdownView }) {
  const t = useTranslations('wallet.breakdown');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const button = buttonRef.current;
    const pop = popRef.current;
    if (!button || !pop) return;
    const rect = button.getBoundingClientRect();
    const isRtl = document.documentElement.dir === 'rtl';
    const wantedLeft = isRtl ? rect.right - pop.offsetWidth : rect.left;
    const left = Math.max(EDGE_PX, Math.min(wantedLeft, window.innerWidth - pop.offsetWidth - EDGE_PX));
    setPosition({ top: rect.bottom + GAP_PX, left });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (popRef.current?.contains(target) || buttonRef.current?.contains(target))) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn outline-w sm"
        aria-expanded={isOpen}
        onClick={() => {
          setPosition(null);
          setIsOpen((open) => !open);
        }}
        data-testid="balance-breakdown"
      >
        {t('open')} <Icon name="chev" size={13} strokeWidth={2.4} />
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={popRef}
              className="menu"
              role="dialog"
              aria-label={t('title')}
              style={position ? { top: position.top, left: position.left } : { visibility: 'hidden', top: 0, left: 0 }}
            >
              <div className="bd-pop">
                <div className="bd-col">
                  <div className="bd-h">
                    <span className="bd-ic in">+</span>
                    <div className="cell2">
                      <b>{t('inWallet')}</b>
                      <span>{t('inWalletHint')}</span>
                    </div>
                  </div>
                  <div className="bd-g">
                    <div className="bd-r"><b>{t('processing')}</b><b className="num"><bdi>{view.processingText}</bdi></b></div>
                    <div className="bd-r sub"><span>{t('processingHint')}</span></div>
                  </div>
                  <div className="bd-g">
                    <div className="bd-r"><b>{t('inNextCashOut')}</b><b className="num"><bdi>{view.inNextCashOutText}</bdi></b></div>
                    <div className="bd-r sub"><span>{t('inNextCashOutHint')}</span></div>
                  </div>
                </div>
                <div className="bd-col">
                  <div className="bd-h">
                    <span className="bd-ic out">−</span>
                    <div className="cell2">
                      <b>{t('paidOut')}</b>
                      <span>{t('paidOutHint')}</span>
                    </div>
                  </div>
                  <div className="bd-g">
                    <div className="bd-r"><b>{t('paidOutTotal')}</b><b className="num"><bdi>{view.paidOutText}</bdi></b></div>
                    <div className="bd-r sub"><span>{t('paidOutCount', { count: view.paidOutCount })}</span></div>
                  </div>
                </div>
                <div className="bd-foot">
                  <span>{t('foot')}</span>
                  <b className="num"><bdi>{view.balanceText}</bdi></b>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
