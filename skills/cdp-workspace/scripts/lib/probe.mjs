import http from "node:http";

const MAX_RESPONSE_BYTES = 64 * 1024;

export function requestVersion(endpoint, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const request = options.request ?? http.get;
  const url = new URL("/json/version", `${endpoint}/`);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };

    const req = request(
      url,
      {
        headers: { Accept: "application/json" },
        timeout: timeoutMs,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(reject, new Error(`HTTP ${response.statusCode ?? "unknown"}`));
          return;
        }

        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) {
            return;
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            finish(resolve, parsed);
          } catch {
            finish(reject, new Error("invalid_json"));
          }
        });
        response.on("error", (error) => finish(reject, error));
      },
    );

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => finish(reject, error));
  });
}

function safeReason(error) {
  if (!(error instanceof Error)) {
    return "probe_failed";
  }
  if (error.message === "timeout") {
    return "timeout";
  }
  if (error.message === "invalid_json") {
    return "invalid_json";
  }
  if (error.message === "response_too_large") {
    return "response_too_large";
  }
  if (error.message.startsWith("HTTP ")) {
    return error.message.toLowerCase().replace(" ", "_");
  }
  if (typeof error.code === "string") {
    return error.code.toLowerCase();
  }
  return "unreachable";
}

export async function probeEndpoint(endpoint, options = {}) {
  const observedAt = new Date().toISOString();
  try {
    const payload = await requestVersion(endpoint, options);
    if (
      payload === null ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.Browser !== "string" ||
      payload.Browser.length === 0
    ) {
      return {
        healthy: false,
        observedAt,
        reason: "missing_browser_metadata",
      };
    }

    const result = {
      healthy: true,
      observedAt,
      browser: payload.Browser,
    };
    if (typeof payload["Protocol-Version"] === "string") {
      result.protocolVersion = payload["Protocol-Version"];
    }
    return result;
  } catch (error) {
    return {
      healthy: false,
      observedAt,
      reason: safeReason(error),
    };
  }
}

export async function waitForProbe(endpoint, expectation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 200;
  const startedAt = Date.now();
  let result = await probeEndpoint(endpoint, options);

  while (result.healthy !== expectation && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    result = await probeEndpoint(endpoint, options);
  }
  return result;
}
