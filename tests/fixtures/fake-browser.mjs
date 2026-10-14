#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";

const portArgument = process.argv.find((argument) =>
  argument.startsWith("--remote-debugging-port="),
);
if (!portArgument) {
  process.stderr.write("missing --remote-debugging-port\n");
  process.exit(2);
}

const port = Number(portArgument.slice("--remote-debugging-port=".length));
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  process.stderr.write("invalid --remote-debugging-port\n");
  process.exit(2);
}

const requestLog = process.env.FAKE_BROWSER_REQUEST_LOG;
const server = http.createServer((request, response) => {
  if (requestLog) {
    fs.appendFileSync(requestLog, `${request.method} ${request.url}\n`);
  }
  if (request.method !== "GET" || request.url !== "/json/version") {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      Browser: "FakeBrowser/1.0",
      "Protocol-Version": "1.3",
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/should-not-be-exposed`,
    }),
  );
});

server.listen(port, "127.0.0.1");

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
