import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { probeEndpoint } from "../skills/cdp-workspace/scripts/lib/probe.mjs";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("probe requests only /json/version and allowlists returned fields", async () => {
  const requests = [];
  await withServer((request, response) => {
    requests.push(request.url);
    if (request.url !== "/json/version") {
      response.writeHead(500);
      response.end("unexpected path");
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        Browser: "Chrome/154",
        "Protocol-Version": "1.3",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/secret",
        url: "https://example.com/private",
      }),
    );
  }, async (endpoint) => {
    const result = await probeEndpoint(endpoint);
    assert.equal(result.healthy, true);
    assert.equal(result.browser, "Chrome/154");
    assert.equal(result.protocolVersion, "1.3");
    assert.deepEqual(requests, ["/json/version"]);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("webSocketDebuggerUrl"), false);
    assert.equal(serialized.includes("example.com"), false);
    assert.equal(serialized.includes("/json/list"), false);
  });
});

test("probe reports malformed metadata without throwing", async () => {
  await withServer((_request, response) => {
    response.end("{}");
  }, async (endpoint) => {
    const result = await probeEndpoint(endpoint);
    assert.equal(result.healthy, false);
    assert.equal(result.reason, "missing_browser_metadata");
  });
});
