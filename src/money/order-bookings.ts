import type { Prisma } from '@prisma/client';
import { getSettingValues } from '@/pricing/settings-values';
import { basisPointsOfPiasters } from '@/shared/money';
import { LEDGER_ACCOUNTS, postEntry, walletAccount } from './ledger';

export type OrderOutcome = 'delivered' | 'returned';

// Books what an order's final outcome means for money (design §7.5 "What gets booked").
// Runs inside the status-change transaction; the idempotency key makes a retry a no-op.
export async function postOrderOutcome(tx: Prisma.TransactionClient, orderId: string, outcome: OrderOutcome): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      merchantId: true,
      codAmountPiasters: true,
      refundPiasters: true,
      shippingPiasters: true,
      openPackagePiasters: true,
      codFeePiasters: true,
      insurancePiasters: true,
      vatPiasters: true,
      totalFeePiasters: true,
    },
  });
  const wallet = walletAccount(order.merchantId);
  const base = { key: `order:${order.id}:${outcome}`, orderId: order.id, merchantId: order.merchantId };

  if (outcome === 'delivered') {
    // Cash taken from the customer is owed to the merchant; cash handed to the customer
    // (refund, cash given) comes out of the wallet; Shiply's frozen fees are charged.
    const otherFeesPiasters = order.openPackagePiasters + order.codFeePiasters + order.insurancePiasters;
    await postEntry(tx, {
      ...base,
      reason: 'order_delivered',
      lines: [
        { account: LEDGER_ACCOUNTS.cashInTransit, amountPiasters: order.codAmountPiasters - order.refundPiasters },
        { account: wallet, amountPiasters: -order.codAmountPiasters + order.refundPiasters + order.totalFeePiasters },
        { account: LEDGER_ACCOUNTS.revenueShipping, amountPiasters: -order.shippingPiasters },
        { account: LEDGER_ACCOUNTS.revenueFees, amountPiasters: -otherFeesPiasters },
        { account: LEDGER_ACCOUNTS.vatPayable, amountPiasters: -order.vatPiasters },
      ],
    });
    return;
  }

  // Returned for good: shipping plus the return fee (a share of shipping), VAT on both, no cash.
  const settings = await getSettingValues(['return_fee_basis_points', 'vat_basis_points'], order.merchantId);
  const returnFeePiasters = basisPointsOfPiasters(order.shippingPiasters, settings.return_fee_basis_points);
  const vatPiasters = basisPointsOfPiasters(order.shippingPiasters + returnFeePiasters, settings.vat_basis_points);
  await postEntry(tx, {
    ...base,
    reason: 'order_returned',
    lines: [
      { account: wallet, amountPiasters: order.shippingPiasters + returnFeePiasters + vatPiasters },
      { account: LEDGER_ACCOUNTS.revenueShipping, amountPiasters: -order.shippingPiasters },
      { account: LEDGER_ACCOUNTS.revenueReturnFees, amountPiasters: -returnFeePiasters },
      { account: LEDGER_ACCOUNTS.vatPayable, amountPiasters: -vatPiasters },
    ],
  });
}
