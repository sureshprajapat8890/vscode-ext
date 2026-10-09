/**
 * An error whose message is written for the user: what happened, why, and what to do.
 * `safeCommand` shows these verbatim instead of a generic failure notice.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
