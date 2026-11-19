import { randomInt } from 'node:crypto';
import type { Prisma, SupportAuthorKind, SupportTicketStatus, SupportTopic } from '@prisma/client';
import { z } from 'zod';
import type { SessionUser } from '@/accounts';
import { writeAudit } from '@/platform/audit-log';
import { runOnce } from '@/platform/idempotency';
import { AppError } from '@/shared/app-error';
import { db } from '@/shared/db';

export const SUPPORT_TOPICS = ['order', 'pickup', 'payment', 'account', 'other'] as const;
export const SUPPORT_PAGE_SIZE = 25;
export const SUBJECT_MIN_LENGTH = 3;
export const SUBJECT_MAX_LENGTH = 120;
export const BODY_MAX_LENGTH = 2000;

const SUPPORT_STAFF_ROLES: ReadonlySet<string> = new Set(['admin', 'operations', 'finance']);
// "T" + 6 digits, first digit 1–9, random so numbers cannot be guessed in sequence.
const SMALLEST_SIX_DIGIT = 100_000;
const LARGEST_SIX_DIGIT = 999_999;
const TICKET_NUMBER_TRIES = 8;

const Body = z.string().trim().min(1).max(BODY_MAX_LENGTH);

const OpenTicketInput = z.object({
  topic: z.enum(SUPPORT_TOPICS),
  orderNumber: z.string().trim().max(40).nullish().transform((value) => (value ? value : null)),
  subject: z.string().trim().min(SUBJECT_MIN_LENGTH).max(SUBJECT_MAX_LENGTH),
  body: Body,
});

export type OpenTicketInput = z.input<typeof OpenTicketInput>;

const ListQuery = z.object({ status: z.enum(['open', 'closed']), page: z.number().int().min(1) });

export type TicketListRow = {
  id: string;
  number: string;
  subject: string;
  topic: SupportTopic;
  status: SupportTicketStatus;
  orderNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TicketListResult = { rows: TicketListRow[]; page: number; pageCount: number; total: number };

export type TicketMessage = { id: string; authorKind: SupportAuthorKind; body: string; createdAt: Date };

export type TicketThread = TicketListRow & { messages: TicketMessage[] };

const LIST_FIELDS = {
  id: true, number: true, subject: true, topic: true, status: true, orderNumber: true, createdAt: true, updatedAt: true,
} as const;

// Support is open to every member of the merchant, whatever their access level.
function requireMembership(user: SessionUser, merchantId: string): void {
  if (!user.memberships.some((member) => member.merchantId === merchantId)) throw new AppError('forbidden', 403);
}

function requireSupportStaff(user: SessionUser): void {
  if (!user.staffRoles.some((role) => SUPPORT_STAFF_ROLES.has(role))) throw new AppError('forbidden', 403);
}

function parseBody(body: string): string {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new AppError('invalid_input');
  return parsed.data;
}

export function generateTicketNumber(): string {
  return `T${randomInt(SMALLEST_SIX_DIGIT, LARGEST_SIX_DIGIT + 1)}`;
}

async function uniqueTicketNumber(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < TICKET_NUMBER_TRIES; attempt += 1) {
    const number = generateTicketNumber();
    if (!(await tx.supportTicket.findUnique({ where: { number }, select: { id: true } }))) return number;
  }
  throw new Error('Could not find a free ticket number after several tries; try again.');
}

export async function openTicket(
  user: SessionUser,
  merchantId: string,
  input: OpenTicketInput,
  idempotencyKey: string,
): Promise<{ id: string; number: string }> {
  requireMembership(user, merchantId);
  const parsed = OpenTicketInput.safeParse(input);
  if (!parsed.success) throw new AppError('invalid_input');
  const { topic, orderNumber, subject, body } = parsed.data;
  if (orderNumber) {
    const order = await db.order.findFirst({ where: { number: orderNumber, merchantId }, select: { id: true } });
    if (!order) throw new AppError('not_found', 404);
  }

  return runOnce(idempotencyKey, `support.open:${merchantId}`, async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: { number: await uniqueTicketNumber(tx), merchantId, createdBy: user.id, topic, orderNumber, subject },
      select: { id: true, number: true },
    });
    await tx.supportMessage.create({ data: { ticketId: ticket.id, authorUserId: user.id, authorKind: 'merchant', body } });
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'support.ticket_opened',
      entityType: 'SupportTicket',
      entityId: ticket.id,
      before: null,
      after: { merchantId, topic },
    });
    return ticket;
  });
}

// Open covers tickets waiting for us and tickets we answered; newest activity first.
export async function listTickets(
  user: SessionUser,
  merchantId: string,
  rawQuery: { status: 'open' | 'closed'; page: number },
): Promise<TicketListResult> {
  requireMembership(user, merchantId);
  const parsed = ListQuery.safeParse(rawQuery);
  if (!parsed.success) throw new AppError('invalid_input');
  const where: Prisma.SupportTicketWhereInput = {
    merchantId,
    status: parsed.data.status === 'closed' ? 'closed' : { in: ['open', 'answered'] },
  };
  const total = await db.supportTicket.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / SUPPORT_PAGE_SIZE));
  const page = Math.min(parsed.data.page, pageCount);
  const rows = await db.supportTicket.findMany({
    where,
    select: LIST_FIELDS,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * SUPPORT_PAGE_SIZE,
    take: SUPPORT_PAGE_SIZE,
  });
  return { rows, page, pageCount, total };
}

async function findThread(where: Prisma.SupportTicketWhereInput): Promise<TicketThread> {
  const ticket = await db.supportTicket.findFirst({
    where,
    select: {
      ...LIST_FIELDS,
      messages: { select: { id: true, authorKind: true, body: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!ticket) throw new AppError('not_found', 404);
  return ticket;
}

export async function getTicket(user: SessionUser, merchantId: string, ticketId: string): Promise<TicketThread> {
  requireMembership(user, merchantId);
  if (!z.string().uuid().safeParse(ticketId).success) throw new AppError('not_found', 404);
  return findThread({ id: ticketId, merchantId });
}

export async function getTicketByNumber(user: SessionUser, merchantId: string, number: string): Promise<TicketThread> {
  requireMembership(user, merchantId);
  return findThread({ number, merchantId });
}

async function findOwnTicket(merchantId: string, ticketId: string) {
  if (!z.string().uuid().safeParse(ticketId).success) throw new AppError('not_found', 404);
  const ticket = await db.supportTicket.findFirst({ where: { id: ticketId, merchantId }, select: { id: true, status: true } });
  if (!ticket) throw new AppError('not_found', 404);
  return ticket;
}

async function addReply(
  tx: Prisma.TransactionClient,
  actor: SessionUser,
  ticketId: string,
  authorKind: SupportAuthorKind,
  body: string,
): Promise<void> {
  // Locks the ticket row so a reply cannot slip in after a concurrent close.
  const [locked] = await tx.$queryRaw<{ status: SupportTicketStatus }[]>`
    SELECT "status" FROM "SupportTicket" WHERE "id" = ${ticketId}::uuid FOR UPDATE`;
  if (!locked) throw new AppError('not_found', 404);
  if (locked.status === 'closed') throw new AppError('ticket_closed', 409);
  const message = await tx.supportMessage.create({ data: { ticketId, authorUserId: actor.id, authorKind, body }, select: { id: true } });
  // A staff reply marks the ticket answered; a merchant reply puts it back in our queue.
  const status: SupportTicketStatus = authorKind === 'staff' ? 'answered' : 'open';
  await tx.supportTicket.update({ where: { id: ticketId }, data: { status } });
  await writeAudit(tx, {
    actorUserId: actor.id,
    action: 'support.reply_added',
    entityType: 'SupportTicket',
    entityId: ticketId,
    before: { status: locked.status },
    after: { status, messageId: message.id, authorKind },
  });
}

// With a key, a resent reply (double click) is stored once.
export async function replyAsMerchant(
  user: SessionUser,
  merchantId: string,
  ticketId: string,
  body: string,
  idempotencyKey?: string,
): Promise<void> {
  requireMembership(user, merchantId);
  const text = parseBody(body);
  const ticket = await findOwnTicket(merchantId, ticketId);
  if (ticket.status === 'closed') throw new AppError('ticket_closed', 409);
  const work = (tx: Prisma.TransactionClient) => addReply(tx, user, ticket.id, 'merchant', text);
  if (idempotencyKey) {
    await runOnce(idempotencyKey, `support.reply:${ticket.id}`, work);
    return;
  }
  await db.$transaction(work);
}

// Closing twice is harmless: the second call finds it closed and changes nothing.
export async function closeTicket(user: SessionUser, merchantId: string, ticketId: string): Promise<void> {
  requireMembership(user, merchantId);
  const ticket = await findOwnTicket(merchantId, ticketId);
  if (ticket.status === 'closed') return;
  await db.$transaction(async (tx) => {
    const closed = await tx.supportTicket.updateMany({ where: { id: ticket.id, status: { not: 'closed' } }, data: { status: 'closed' } });
    if (closed.count === 0) return;
    await writeAudit(tx, {
      actorUserId: user.id,
      action: 'support.ticket_closed',
      entityType: 'SupportTicket',
      entityId: ticket.id,
      before: { status: ticket.status },
      after: { status: 'closed' },
    });
  });
}

// With a key, a resent reply (double click) is stored once.
export async function replyAsStaff(staffUser: SessionUser, ticketId: string, body: string, idempotencyKey?: string): Promise<void> {
  requireSupportStaff(staffUser);
  const text = parseBody(body);
  if (!z.string().uuid().safeParse(ticketId).success) throw new AppError('not_found', 404);
  const work = (tx: Prisma.TransactionClient) => addReply(tx, staffUser, ticketId, 'staff', text);
  if (idempotencyKey) {
    await runOnce(idempotencyKey, `support.staff_reply:${ticketId}`, work);
    return;
  }
  await db.$transaction(work);
}
