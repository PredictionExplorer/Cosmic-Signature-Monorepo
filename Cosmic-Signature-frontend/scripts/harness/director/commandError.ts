/** Feedback from known command validation failures that can safely be sent to a client. */
export class HarnessCommandError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
  }
}

export function publicCommandFailure(error: unknown): string {
  return error instanceof HarnessCommandError
    ? error.publicMessage
    : 'The harness request failed. See the director log for details.';
}
