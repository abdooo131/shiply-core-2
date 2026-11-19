// Why a delivery attempt failed. Stored as these keys (never as text) so every screen can show
// them in the reader's language and Analytics can group them.
export const FAILURE_REASONS = [
  'customer_not_answering',
  'wrong_address',
  'customer_refused',
  'rescheduled_by_customer',
  'unclear_address',
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export function isFailureReason(value: string | null | undefined): value is FailureReason {
  return (FAILURE_REASONS as readonly string[]).includes(value ?? '');
}
