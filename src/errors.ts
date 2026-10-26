/** A failure with a stable machine code, safe to surface in a command result. */
export class HandoffError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'HandoffError'
  }
}

/** Render any thrown value as a short, user-facing line. */
export function describeError(error: unknown): string {
  if (error instanceof HandoffError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
