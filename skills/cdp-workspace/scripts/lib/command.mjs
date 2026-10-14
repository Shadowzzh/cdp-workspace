import { execFile } from "node:child_process";

export function runCommand(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        env: options.env ?? process.env,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr, signal: null });
          return;
        }

        resolve({
          code: typeof error.code === "number" ? error.code : 1,
          stdout: stdout ?? "",
          stderr: stderr || error.message,
          signal: error.signal ?? null,
        });
      },
    );
  });
}
