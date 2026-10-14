import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const CLI = path.resolve("skills/cdp-workspace/scripts/cdp-workspace.mjs");

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        encoding: "utf8",
        env: options.env ?? process.env,
        timeout: 10_000,
      },
      (error, stdout, stderr) => {
        resolve({
          code: error === null ? 0 : Number(error.code ?? 1),
          stdout,
          stderr,
        });
      },
    );
  });
}

test("CLI initializes and validates a catalog without browser or MCP dependencies", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-workspace-cli-"));
  const config = path.join(root, "config", "workspaces.json");
  try {
    const initialized = await runCli(["init", "--config", config, "--json"]);
    assert.equal(initialized.code, 0, initialized.stderr);
    assert.equal(JSON.parse(initialized.stdout).action, "init");
    assert.equal(fs.existsSync(config), true);

    const validated = await runCli(["validate", "--config", config, "--json"]);
    assert.equal(validated.code, 0, validated.stderr);
    const payload = JSON.parse(validated.stdout);
    assert.equal(payload.valid, true);
    assert.equal(payload.workspaceCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI lists an external workspace by probing /json/version only", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url !== "/json/version") {
      response.writeHead(500);
      response.end();
      return;
    }
    response.end(JSON.stringify({ Browser: "Chromium/154" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-workspace-list-"));
  const config = path.join(root, "workspaces.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      default: "clean",
      mcpProfiles: {},
      workspaces: {
        clean: {
          purpose: "Clean environment",
          endpoint: `http://127.0.0.1:${address.port}`,
          lifecycle: { provider: "external" },
        },
      },
    }),
  );

  try {
    const result = await runCli(["list", "--config", config, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.workspaces[0].status, "active");
    assert.equal(payload.workspaces[0].browser, "Chromium/154");
    assert.deepEqual(requests, ["/json/version"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repository runtime contains no former private paths or labels", () => {
  const roots = ["README.md", "examples", "skills", "tests"];
  const files = [];

  function collect(entry) {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(entry)) {
        collect(path.join(entry, child));
      }
      return;
    }
    files.push(entry);
  }

  roots.forEach(collect);
  const content = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const formerHome = ["/Users", ["zhang", "ziheng"].join("")].join("/");
  const formerLabel = ["dev", "zzheng"].join(".");
  const formerHostPath = ["hosts", "macmini"].join("/");
  const formerSourcePath = ["infra", "cdp-workspace"].join("/");
  assert.equal(content.includes(formerHome), false);
  assert.equal(content.includes(formerLabel), false);
  assert.equal(content.includes(formerHostPath), false);
  assert.equal(content.includes(formerSourcePath), false);
});
