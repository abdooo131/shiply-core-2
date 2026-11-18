// An expected failure the caller can show to the user. `messageKey` points at
// the Arabic/English text; `status` is the HTTP status an endpoint should return.
export class AppError extends Error {
  readonly code: string;
  readonly messageKey: string;
  readonly status: number;

  constructor(code: string, status = 400, messageKey = `errors.${code}`) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.messageKey = messageKey;
    this.status = status;
  }
}
