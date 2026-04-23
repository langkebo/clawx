export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.slice(0, 200);
  }
  return "internal error";
}
