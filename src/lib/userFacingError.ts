const UNEXPECTED_ERROR_MESSAGE = 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie.';

/** An error whose message is written in Polish for the user and is safe to display. */
export class UserFacingError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'UserFacingError';
  }
}

/** The message to show for any thrown value; unknown errors never leak their details. */
export function toUserMessage(error: unknown): string {
  return error instanceof UserFacingError ? error.message : UNEXPECTED_ERROR_MESSAGE;
}
