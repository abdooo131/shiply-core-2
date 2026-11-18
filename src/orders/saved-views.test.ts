import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@/accounts';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import { deleteSavedView, listSavedViews, saveView } from './saved-views';

let merchantId = '';
let owner: SessionUser;

beforeEach(async () => {
  await resetTestDatabase();
  merchantId = (await makeMerchant()).id;
  owner = await makeSessionUser({ merchantId, access: 'full' });
});

describe('saved views', () => {
  it('saves, lists and deletes the user’s own views', async () => {
    const first = await saveView(owner, merchantId, '  Cairo cash  ', 'tab=all&payment=cash');
    await saveView(owner, merchantId, 'طلبات اليوم', 'created=today');

    const views = await listSavedViews(owner, merchantId);
    expect(views.map((view) => view.name)).toEqual(['Cairo cash', 'طلبات اليوم']);
    expect(views[0]).toMatchObject({ id: first.id, query: 'tab=all&payment=cash' });

    await deleteSavedView(owner, merchantId, first.id);
    expect((await listSavedViews(owner, merchantId)).map((view) => view.name)).toEqual(['طلبات اليوم']);
  });

  it('never shows or deletes another user’s views', async () => {
    const colleague = await makeSessionUser({ merchantId, access: 'orders_pickups' });
    const theirs = await saveView(colleague, merchantId, 'Mine', 'tab=new');

    expect(await listSavedViews(owner, merchantId)).toEqual([]);
    await expect(deleteSavedView(owner, merchantId, theirs.id)).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(deleteSavedView(owner, merchantId, 'not-a-uuid')).rejects.toMatchObject({ code: 'not_found' });
    expect(await db.savedView.count()).toBe(1);
  });

  it('checks the name and query lengths', async () => {
    await expect(saveView(owner, merchantId, '   ', 'tab=all')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveView(owner, merchantId, 'x'.repeat(41), 'tab=all')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveView(owner, merchantId, 'Long', 'q='.padEnd(501, 'x'))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveView(owner, merchantId, 'x'.repeat(40), 'q='.padEnd(500, 'x'))).resolves.toMatchObject({ name: 'x'.repeat(40) });
  });

  it('allows at most 20 views per user and merchant', async () => {
    await db.savedView.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({ userId: owner.id, merchantId, name: `View ${index}`, query: '' })),
    });
    await expect(saveView(owner, merchantId, 'One more', 'tab=all')).rejects.toMatchObject({ code: 'too_many_views' });
    expect(await db.savedView.count()).toBe(20);
  });

  it('refuses a member without order access', async () => {
    const finance = await makeSessionUser({ merchantId, access: 'finance' });
    await expect(listSavedViews(finance, merchantId)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(saveView(finance, merchantId, 'Mine', 'tab=all')).rejects.toMatchObject({ code: 'forbidden' });
  });
});
