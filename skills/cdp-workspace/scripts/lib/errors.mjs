export class WorkspaceError extends Error {
  constructor(code, message, details = undefined, exitCode = 1) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function fail(code, message, details = undefined, exitCode = 1) {
  throw new WorkspaceError(code, message, details, exitCode);
}

export function errorPayload(error) {
  if (error instanceof WorkspaceError) {
    const payload = {
      error: error.code,
      message: error.message,
    };
    if (error.details !== undefined) {
      payload.details = error.details;
    }
    return payload;
  }

  return {
    error: "unexpected_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
