import { z } from 'zod';
import { requireMerchantAccess, type SessionUser } from '@/accounts';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

const MAX_VIEW_NAME_LENGTH = 40;
const MAX_VIEW_QUERY_LENGTH = 500;
const MAX_VIEWS_PER_USER = 20;

const ViewInput = z.object({
  name: z.string().trim().min(1).max(MAX_VIEW_NAME_LENGTH),
  // The query string is stored as given; the orders list parses it safely when the view is opened.
  query: z.string().max(MAX_VIEW_QUERY_LENGTH),
});
const ViewId = z.string().uuid();

export type SavedViewSummary = { id: string; name: string; query: string; createdAt: Date };

const VIEW_FIELDS = { id: true, name: true, query: true, createdAt: true } as const;

export async function listSavedViews(user: SessionUser, merchantId: string): Promise<SavedViewSummary[]> {
  requireMerchantAccess(user, merchantId, 'orders');
  return db.savedView.findMany({
    where: { userId: user.id, merchantId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_VIEWS_PER_USER,
    select: VIEW_FIELDS,
  });
}

export async function saveView(user: SessionUser, merchantId: string, name: string, query: string): Promise<SavedViewSummary> {
  requireMerchantAccess(user, merchantId, 'orders');
  const parsed = ViewInput.safeParse({ name, query });
  if (!parsed.success) throw new AppError('invalid_input');

  return db.$transaction(async (tx) => {
    // Lock this user's views for this merchant so two quick saves cannot pass the limit together.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`saved-views:${user.id}:${merchantId}`}))`;
    const count = await tx.savedView.count({ where: { userId: user.id, merchantId } });
    if (count >= MAX_VIEWS_PER_USER) throw new AppError('too_many_views');
    return tx.savedView.create({
      data: { userId: user.id, merchantId, name: parsed.data.name, query: parsed.data.query },
      select: VIEW_FIELDS,
    });
  });
}

export async function deleteSavedView(user: SessionUser, merchantId: string, viewId: string): Promise<void> {
  requireMerchantAccess(user, merchantId, 'orders');
  if (!ViewId.safeParse(viewId).success) throw new AppError('not_found', 404);
  const deleted = await db.savedView.deleteMany({ where: { id: viewId, userId: user.id, merchantId } });
  if (deleted.count === 0) throw new AppError('not_found', 404);
}
