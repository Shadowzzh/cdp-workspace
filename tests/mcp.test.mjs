import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCatalog } from "../skills/cdp-workspace/scripts/lib/catalog.mjs";
import { renderMcpSnippets } from "../skills/cdp-workspace/scripts/lib/mcp.mjs";

function configuredCatalog() {
  return normalizeCatalog({
    version: 1,
    default: "general",
    mcpProfiles: {
      custom: {
        command: "custom-browser-mcp",
        args: ["--endpoint={endpoint}", "--workspace={name}"],
        env: { CDP_ENDPOINT: "{endpoint}" },
      },
    },
    workspaces: {
      general: {
        endpoint: "http://127.0.0.1:9223",
        lifecycle: { provider: "external" },
        mcp: { serverName: "browser-general", profile: "custom" },
      },
    },
  });
}

test("renders a generic MCP launch specification without executing it", () => {
  const catalog = configuredCatalog();
  const result = renderMcpSnippets(catalog, [catalog.workspaces.general]);
  assert.equal(result.specs[0].command, "custom-browser-mcp");
  assert.deepEqual(result.specs[0].args, [
    "--endpoint=http://127.0.0.1:9223",
    "--workspace=general",
  ]);
  assert.equal(result.specs[0].env.CDP_ENDPOINT, "http://127.0.0.1:9223");
});

test("renders Codex TOML and Claude JSON from the same neutral profile", () => {
  const catalog = configuredCatalog();
  const workspace = catalog.workspaces.general;
  const codex = renderMcpSnippets(catalog, [workspace], { format: "codex" });
  const claude = renderMcpSnippets(catalog, [workspace], { format: "claude" });
  assert.match(codex.content, /\[mcp_servers\."browser-general"\]/);
  assert.match(codex.content, /custom-browser-mcp/);
  assert.equal(JSON.parse(claude.content).mcpServers["browser-general"].command, "custom-browser-mcp");
});

function httpCatalog() {
  return normalizeCatalog({
    version: 1,
    default: "general",
    mcpProfiles: {
      remote: {
        transport: "http",
        url: "http://localhost:19583/mcp",
      },
    },
    workspaces: {
      general: {
        endpoint: "http://127.0.0.1:9223",
        lifecycle: { provider: "external" },
        mcp: { serverName: "browser-http", profile: "remote" },
      },
    },
  });
}

test("renders a generic Streamable HTTP MCP specification", () => {
  const catalog = httpCatalog();
  const result = renderMcpSnippets(catalog, [catalog.workspaces.general]);
  assert.equal(result.specs[0].transport, "http");
  assert.equal(result.specs[0].url, "http://localhost:19583/mcp");
  assert.equal(result.specs[0].command, undefined);
});

test("renders Streamable HTTP MCP snippets for Codex and Claude", () => {
  const catalog = httpCatalog();
  const workspace = catalog.workspaces.general;
  const codex = renderMcpSnippets(catalog, [workspace], { format: "codex" });
  const claude = renderMcpSnippets(catalog, [workspace], { format: "claude" });
  assert.match(codex.content, /\[mcp_servers\."browser-http"\]/);
  assert.match(codex.content, /url = "http:\/\/localhost:19583\/mcp"/);
  assert.equal(codex.content.includes("command ="), false);
  assert.deepEqual(JSON.parse(claude.content).mcpServers["browser-http"], {
    type: "http",
    url: "http://localhost:19583/mcp",
  });
});
