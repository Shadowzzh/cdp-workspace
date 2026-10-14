import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCatalog,
  validateEndpoint,
  validateMcpUrl,
} from "../skills/cdp-workspace/scripts/lib/catalog.mjs";

function catalog(overrides = {}) {
  return {
    version: 1,
    default: "general",
    mcpProfiles: {},
    workspaces: {
      general: {
        purpose: "General",
        endpoint: "http://127.0.0.1:9223",
        lifecycle: { provider: "auto" },
      },
    },
    ...overrides,
  };
}

test("normalizes a minimal catalog", () => {
  const result = normalizeCatalog(catalog());
  assert.equal(result.default, "general");
  assert.equal(result.workspaces.general.endpoint, "http://127.0.0.1:9223");
  assert.equal(result.workspaces.general.lifecycle.browser, "auto");
  assert.deepEqual(result.workspaces.general.lifecycle.extraArgs, []);
});

test("accepts only loopback endpoints without paths", () => {
  assert.equal(validateEndpoint("http://localhost:9222"), "http://localhost:9222");
  assert.equal(validateEndpoint("http://[::1]:9222"), "http://[::1]:9222");
  assert.throws(() => validateEndpoint("https://127.0.0.1:9222"), {
    code: "invalid_endpoint",
  });
  assert.throws(() => validateEndpoint("http://192.168.1.5:9222"), {
    code: "invalid_endpoint",
  });
  assert.throws(() => validateEndpoint("http://127.0.0.1:9222/json/list"), {
    code: "invalid_endpoint",
  });
});

test("rejects duplicate endpoints and reserved browser arguments", () => {
  assert.throws(
    () =>
      normalizeCatalog(
        catalog({
          workspaces: {
            general: { endpoint: "http://127.0.0.1:9223" },
            second: { endpoint: "http://127.0.0.1:9223" },
          },
        }),
      ),
    { code: "duplicate_endpoint" },
  );

  assert.throws(
    () =>
      normalizeCatalog(
        catalog({
          workspaces: {
            general: {
              endpoint: "http://127.0.0.1:9223",
              lifecycle: {
                extraArgs: ["--remote-debugging-port=9999"],
              },
            },
          },
        }),
      ),
    { code: "invalid_catalog" },
  );
});

test("requires MCP templates to reference the workspace endpoint", () => {
  assert.throws(
    () =>
      normalizeCatalog(
        catalog({
          mcpProfiles: {
            invalid: { command: "browser-mcp", args: [] },
          },
        }),
      ),
    { code: "invalid_catalog" },
  );
});

test("normalizes stdio MCP profiles without an explicit transport", () => {
  const result = normalizeCatalog(
    catalog({
      mcpProfiles: {
        custom: {
          command: "browser-mcp",
          args: ["--endpoint={endpoint}"],
        },
      },
    }),
  );
  assert.equal(result.mcpProfiles.custom.transport, "stdio");
});

test("accepts secure HTTP MCP URLs and rejects unsafe variants", () => {
  assert.equal(
    validateMcpUrl("http://localhost:19583/mcp"),
    "http://localhost:19583/mcp",
  );
  assert.equal(
    validateMcpUrl("https://mcp.example.com/mcp"),
    "https://mcp.example.com/mcp",
  );
  assert.throws(() => validateMcpUrl("http://192.168.1.5:8931/mcp"), {
    code: "invalid_mcp_url",
  });
  assert.throws(() => validateMcpUrl("https://user:secret@mcp.example.com/mcp"), {
    code: "invalid_mcp_url",
  });
});

test("normalizes HTTP MCP profiles without requiring a CDP placeholder", () => {
  const result = normalizeCatalog(
    catalog({
      mcpProfiles: {
        remote: {
          transport: "http",
          url: "http://localhost:19583/mcp",
        },
      },
      workspaces: {
        general: {
          endpoint: "http://127.0.0.1:9223",
          mcp: { serverName: "browser-http", profile: "remote" },
        },
      },
    }),
  );
  assert.deepEqual(result.mcpProfiles.remote, {
    transport: "http",
    url: "http://localhost:19583/mcp",
  });
});
