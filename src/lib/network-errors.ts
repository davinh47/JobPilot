type ErrorWithCause = Error & {
  cause?: {
    code?: unknown;
    message?: unknown;
  };
};

export function networkRequestError(service: string, error: unknown, aborted = false) {
  if (aborted || (error instanceof Error && error.name === "AbortError")) {
    return new Error(`${service} request timed out.`);
  }

  const cause = error instanceof Error ? (error as ErrorWithCause).cause : undefined;
  const code = typeof cause?.code === "string" ? cause.code : null;
  const causeMessage = typeof cause?.message === "string" ? cause.message : null;
  const originalMessage = error instanceof Error ? error.message : null;
  const detail = causeMessage && causeMessage !== "fetch failed"
    ? causeMessage
    : originalMessage && originalMessage !== "fetch failed"
      ? originalMessage
      : null;
  const diagnostic = [code, detail].filter(Boolean).join(": ");

  return new Error(`${service} network request failed${diagnostic ? ` (${diagnostic})` : ""}.`);
}
