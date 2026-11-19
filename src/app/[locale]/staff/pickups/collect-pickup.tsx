'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { markPickupCollectedAction } from '../actions';

// Every attached order starts ticked; the courier unticks what they did not take.
export function CollectPickup({
  pickupId,
  number,
  orders,
}: {
  pickupId: string;
  number: string;
  orders: { id: string; number: string; customerName: string }[];
}) {
  const t = useTranslations('staff');
  const locale = useLocale();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(orders.map((order) => order.id)));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (orderId: string, isOn: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (isOn) next.add(orderId);
      else next.delete(orderId);
      return next;
    });

  const collect = () =>
    startTransition(async () => {
      const result = await markPickupCollectedAction(locale, pickupId, [...picked]);
      if (result.status === 'error') {
        setError(t(`errors.${result.errorKey}`));
        return;
      }
      router.refresh();
    });

  return (
    <div className="grid" style={{ gap: 10 }}>
      <span className="small muted">{t('pickups.ordersInPickup', { count: orders.length })}</span>
      {orders.length > 0 ? (
        <ul className="staff-pick">
          {orders.map((order) => (
            <li key={order.id}>
              <label>
                <input
                  type="checkbox"
                  className="cb"
                  checked={picked.has(order.id)}
                  onChange={(event) => toggle(order.id, event.target.checked)}
                  data-testid={`pick-${order.number}`}
                />
                <span className="mono">{order.number}</span>
                <bdi className="muted">{order.customerName}</bdi>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn sm primary" disabled={pending} onClick={collect} data-testid={`collect-${number}`}>
          {t('pickups.markCollected')}
        </button>
        <span className="small muted">{t('pickups.collectedOf', { picked: picked.size, total: orders.length })}</span>
        {error ? <span role="status" className="err-msg">{error}</span> : null}
      </div>
    </div>
  );
}
