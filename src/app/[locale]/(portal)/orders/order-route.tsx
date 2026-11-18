import type { OrderStatus } from '@prisma/client';
import { Fragment } from 'react';

const STOP_COUNT = 4;
const CANCELED_STAGE = -1;

// How far along the four stops (created, collected, on the way, done) each status is, as in the mockup.
const STAGE_OF: Record<OrderStatus, number> = {
  new: 0,
  pickup_requested: 0,
  picked_up: 1,
  in_progress: 1,
  attempt_failed: 1,
  rescheduled: 2,
  awaiting_merchant_action: 2,
  out_for_delivery: 2,
  returning: 2,
  delivered: 3,
  returned: 3,
  canceled: CANCELED_STAGE,
};

function routeTone(status: OrderStatus): string {
  if (status === 'delivered') return 'ok';
  if (status === 'returning' || status === 'awaiting_merchant_action' || status === 'attempt_failed') return 'back';
  if (status === 'returned' || status === 'canceled') return 'grey';
  return '';
}

// The brand motif: stops on a line, filled up to where the order is now. Decorative only.
export function OrderRoute({ status }: { status: OrderStatus }) {
  const stage = STAGE_OF[status];
  const stops = Array.from({ length: STOP_COUNT }, (_, index) => index);
  return (
    <span className={`route ${routeTone(status)}`} aria-hidden="true">
      {stops.map((index) => (
        <Fragment key={index}>
          {index > 0 ? <b className={index <= stage ? 'f' : undefined} /> : null}
          <i className={index <= stage ? 'f' : undefined} />
        </Fragment>
      ))}
    </span>
  );
}
