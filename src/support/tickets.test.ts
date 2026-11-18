import { beforeEach, describe, expect, it } from 'vitest';
import { makeMerchant, makeSessionUser } from '@/merchants/merchants-test-fixtures';
import { insertTestOrder } from '@/orders/orders-test-fixtures';
import { db } from '@/shared/db';
import { resetTestDatabase } from '@/shared/test-db';
import {
  closeTicket,
  getTicket,
  getTicketByNumber,
  listTickets,
  openTicket,
  replyAsMerchant,
  replyAsStaff,
  SUPPORT_PAGE_SIZE,
} from './tickets';

const FIRST_MESSAGE = { topic: 'other' as const, subject: 'Change my pickup address', body: 'Please move pickups to our new warehouse.' };

async function merchantWithOwner() {
  const merchant = await makeMerchant();
  const owner = await makeSessionUser({ merchantId: merchant.id, access: 'full' });
  return { merchant, owner };
}

describe('support tickets', () => {
  beforeEach(resetTestDatabase);

  it('opens a ticket with a T number and the first message', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const opened = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    expect(opened.number).toMatch(/^T\d{6}$/);
    const ticket = await getTicket(owner, merchant.id, opened.id);
    expect(ticket).toMatchObject({ number: opened.number, subject: FIRST_MESSAGE.subject, topic: 'other', status: 'open', orderNumber: null });
    expect(ticket.messages).toEqual([expect.objectContaining({ authorKind: 'merchant', body: FIRST_MESSAGE.body })]);
  });

  it('lets any member open a ticket, whatever their access level', async () => {
    const { merchant } = await merchantWithOwner();
    const finance = await makeSessionUser({ merchantId: merchant.id, access: 'finance' });
    const opened = await openTicket(finance, merchant.id, FIRST_MESSAGE, 'ticket-1');
    expect((await getTicket(finance, merchant.id, opened.id)).status).toBe('open');
  });

  it('refuses someone who is not a member of the merchant', async () => {
    const { merchant } = await merchantWithOwner();
    const stranger = await makeSessionUser({});
    await expect(openTicket(stranger, merchant.id, FIRST_MESSAGE, 'ticket-1')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('creates one ticket when the same request is sent twice', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const first = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    const second = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    expect(second).toEqual(first);
    expect(await db.supportTicket.count()).toBe(1);
    expect(await db.supportMessage.count()).toBe(1);
  });

  it('links a ticket to one of the merchant’s own orders only', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const order = await insertTestOrder(merchant.id);
    const other = await makeMerchant('Other Shop', 'متجر تاني');
    const otherOrder = await insertTestOrder(other.id);

    const opened = await openTicket(owner, merchant.id, { ...FIRST_MESSAGE, topic: 'order', orderNumber: ` ${order.number} ` }, 'ticket-1');
    expect((await getTicket(owner, merchant.id, opened.id)).orderNumber).toBe(order.number);
    await expect(
      openTicket(owner, merchant.id, { ...FIRST_MESSAGE, topic: 'order', orderNumber: otherOrder.number }, 'ticket-2'),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      openTicket(owner, merchant.id, { ...FIRST_MESSAGE, orderNumber: '0000000000' }, 'ticket-3'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('treats an empty order number as no order', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const opened = await openTicket(owner, merchant.id, { ...FIRST_MESSAGE, orderNumber: '  ' }, 'ticket-1');
    expect((await getTicket(owner, merchant.id, opened.id)).orderNumber).toBeNull();
  });

  it('refuses a subject or message of the wrong length, and an unknown topic', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const cases = [
      { ...FIRST_MESSAGE, subject: 'ab' },
      { ...FIRST_MESSAGE, subject: 'x'.repeat(121) },
      { ...FIRST_MESSAGE, body: '   ' },
      { ...FIRST_MESSAGE, body: 'x'.repeat(2001) },
      { ...FIRST_MESSAGE, topic: 'refund' as unknown as 'other' },
    ];
    for (const [index, input] of cases.entries()) {
      await expect(openTicket(owner, merchant.id, input, `bad-${index}`)).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(await db.supportTicket.count()).toBe(0);
  });

  it('keeps Arabic text exactly as written', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const subject = 'الشحنة اتأخرت عند العميل';
    const body = 'المندوب قال إن العميل مش بيرد، بس العميل بيقول محدش كلّمه. ممكن تراجعوا المكالمات؟';
    const opened = await openTicket(owner, merchant.id, { topic: 'order', subject, body }, 'ticket-1');
    await replyAsMerchant(owner, merchant.id, opened.id, 'لسه مستني ردكم 🙏');
    const ticket = await getTicket(owner, merchant.id, opened.id);
    expect(ticket.subject).toBe(subject);
    expect(ticket.messages.map((message) => message.body)).toEqual([body, 'لسه مستني ردكم 🙏']);
  });

  it('hides another merchant’s ticket', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const opened = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    const other = await makeMerchant('Other Shop', 'متجر تاني');
    const otherOwner = await makeSessionUser({ merchantId: other.id, access: 'full' });
    await expect(getTicket(otherOwner, other.id, opened.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(getTicketByNumber(otherOwner, other.id, opened.number)).rejects.toMatchObject({ code: 'not_found' });
    await expect(replyAsMerchant(otherOwner, other.id, opened.id, 'hello')).rejects.toMatchObject({ code: 'not_found' });
    await expect(closeTicket(otherOwner, other.id, opened.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await listTickets(otherOwner, other.id, { status: 'open', page: 1 })).total).toBe(0);
  });

  it('shows messages oldest first, staff replies mark the ticket answered, merchant replies reopen it', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const staff = await makeSessionUser({ staffRole: 'operations' });
    const opened = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');

    await replyAsStaff(staff, opened.id, 'Done, your pickups now go to the new address.');
    expect((await getTicket(owner, merchant.id, opened.id)).status).toBe('answered');

    await replyAsMerchant(owner, merchant.id, opened.id, 'Thank you!');
    const ticket = await getTicket(owner, merchant.id, opened.id);
    expect(ticket.status).toBe('open');
    expect(ticket.messages.map((message) => message.authorKind)).toEqual(['merchant', 'staff', 'merchant']);
  });

  it('refuses a staff reply from someone without a support staff role', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const opened = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    await expect(replyAsStaff(owner, opened.id, 'I am not staff')).rejects.toMatchObject({ code: 'forbidden' });
    const staff = await makeSessionUser({ staffRole: 'finance' });
    await expect(replyAsStaff(staff, '00000000-0000-0000-0000-000000000000', 'hi')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('closes a ticket, then refuses replies from either side', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const staff = await makeSessionUser({ staffRole: 'admin' });
    const opened = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    await closeTicket(owner, merchant.id, opened.id);
    await closeTicket(owner, merchant.id, opened.id);
    expect((await getTicket(owner, merchant.id, opened.id)).status).toBe('closed');
    await expect(replyAsMerchant(owner, merchant.id, opened.id, 'one more thing')).rejects.toMatchObject({ code: 'ticket_closed' });
    await expect(replyAsStaff(staff, opened.id, 'late reply')).rejects.toMatchObject({ code: 'ticket_closed' });
  });

  it('refuses an empty or too long reply', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const opened = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    await expect(replyAsMerchant(owner, merchant.id, opened.id, '  ')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(replyAsMerchant(owner, merchant.id, opened.id, 'x'.repeat(2001))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('adds one reply when the same reply is sent twice with one key', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const opened = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    await replyAsMerchant(owner, merchant.id, opened.id, 'Any news?', 'reply-1');
    await replyAsMerchant(owner, merchant.id, opened.id, 'Any news?', 'reply-1');
    expect((await getTicket(owner, merchant.id, opened.id)).messages).toHaveLength(2);
  });

  it('lists open and answered tickets under Open and closed ones under Closed, newest activity first', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const staff = await makeSessionUser({ staffRole: 'operations' });
    const first = await openTicket(owner, merchant.id, { ...FIRST_MESSAGE, subject: 'First ticket' }, 'ticket-1');
    const second = await openTicket(owner, merchant.id, { ...FIRST_MESSAGE, subject: 'Second ticket' }, 'ticket-2');
    const third = await openTicket(owner, merchant.id, { ...FIRST_MESSAGE, subject: 'Third ticket' }, 'ticket-3');
    await replyAsStaff(staff, first.id, 'We are on it.');
    await closeTicket(owner, merchant.id, third.id);

    const open = await listTickets(owner, merchant.id, { status: 'open', page: 1 });
    expect(open.rows.map((row) => row.number)).toEqual([first.number, second.number]);
    expect(open.rows[0]).toMatchObject({ status: 'answered', subject: 'First ticket' });
    const closed = await listTickets(owner, merchant.id, { status: 'closed', page: 1 });
    expect(closed.rows.map((row) => row.number)).toEqual([third.number]);
  });

  it('pages the list in pages of 25', async () => {
    const { merchant, owner } = await merchantWithOwner();
    for (let index = 0; index < SUPPORT_PAGE_SIZE + 2; index += 1) {
      await openTicket(owner, merchant.id, { ...FIRST_MESSAGE, subject: `Ticket ${index}` }, `ticket-${index}`);
    }
    const firstPage = await listTickets(owner, merchant.id, { status: 'open', page: 1 });
    const secondPage = await listTickets(owner, merchant.id, { status: 'open', page: 2 });
    expect(firstPage.rows).toHaveLength(SUPPORT_PAGE_SIZE);
    expect(secondPage.rows).toHaveLength(2);
    expect(firstPage).toMatchObject({ total: SUPPORT_PAGE_SIZE + 2, pageCount: 2 });
    const numbers = new Set([...firstPage.rows, ...secondPage.rows].map((row) => row.number));
    expect(numbers.size).toBe(SUPPORT_PAGE_SIZE + 2);
  });

  it('records each change in the audit log with ids only', async () => {
    const { merchant, owner } = await merchantWithOwner();
    const opened = await openTicket(owner, merchant.id, FIRST_MESSAGE, 'ticket-1');
    await replyAsMerchant(owner, merchant.id, opened.id, 'A private detail: 01001234567');
    await closeTicket(owner, merchant.id, opened.id);
    const audit = await db.auditLog.findMany({ where: { entityId: opened.id }, orderBy: { at: 'asc' } });
    expect(audit.map((row) => row.action)).toEqual(['support.ticket_opened', 'support.reply_added', 'support.ticket_closed']);
    const text = JSON.stringify(audit);
    expect(text).not.toContain(FIRST_MESSAGE.subject);
    expect(text).not.toContain('01001234567');
  });
});
