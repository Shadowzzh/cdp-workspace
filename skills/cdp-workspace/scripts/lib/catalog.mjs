import fs from "node:fs";

import { atomicWriteFile } from "./fs.mjs";
import { fail } from "./errors.mjs";

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const MCP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROVIDERS = new Set(["auto", "launchd", "systemd-user", "external"]);
const MCP_TRANSPORTS = new Set(["stdio", "http"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const RESERVED_BROWSER_ARGS = [
  "--remote-debugging-address",
  "--remote-debugging-port",
  "--user-data-dir",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) {
    fail("invalid_catalog", `${label} must be an object.`);
  }
  return value;
}

function optionalString(value, label, fallback = undefined) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    fail("invalid_catalog", `${label} must be a string.`);
  }
  return value;
}

function stringArray(value, label) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail("invalid_catalog", `${label} must be an array of strings.`);
  }
  return [...value];
}

export function validateName(name, label = "workspace name") {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    fail(
      "invalid_name",
      `${label} must contain 1-48 lowercase letters, digits, or hyphens and cannot start or end with a hyphen.`,
    );
  }
  return name;
}

export function validateEndpoint(rawEndpoint) {
  if (typeof rawEndpoint !== "string") {
    fail("invalid_endpoint", "endpoint must be a string.");
  }

  let endpoint;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    fail("invalid_endpoint", `Invalid endpoint: ${rawEndpoint}`);
  }

  if (endpoint.protocol !== "http:" || !LOOPBACK_HOSTS.has(endpoint.hostname)) {
    fail(
      "invalid_endpoint",
      "endpoint must use plain HTTP on 127.0.0.1, localhost, or ::1.",
    );
  }
  if (endpoint.username || endpoint.password) {
    fail("invalid_endpoint", "endpoint must not contain credentials.");
  }
  if (!endpoint.port) {
    fail("invalid_endpoint", "endpoint must include an explicit port.");
  }
  const port = Number(endpoint.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail("invalid_endpoint", "endpoint port must be between 1 and 65535.");
  }
  if (endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    fail("invalid_endpoint", "endpoint must not contain a path, query, or fragment.");
  }
  return endpoint.origin;
}

export function validateMcpUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    fail("invalid_mcp_url", "MCP URL must be a string.");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("invalid_mcp_url", `Invalid MCP URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("invalid_mcp_url", "MCP URL must use HTTP or HTTPS.");
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    fail("invalid_mcp_url", "Plain HTTP MCP URLs are limited to loopback hosts.");
  }
  if (url.username || url.password) {
    fail("invalid_mcp_url", "MCP URL must not contain credentials.");
  }
  if (url.hash) {
    fail("invalid_mcp_url", "MCP URL must not contain a fragment.");
  }
  return url.href;
}

function normalizeEnvironment(value, label) {
  if (value === undefined) {
    return {};
  }
  const source = requireObject(value, label);
  const normalized = {};
  for (const [name, entry] of Object.entries(source)) {
    if (!ENV_NAME_PATTERN.test(name) || typeof entry !== "string") {
      fail(
        "invalid_catalog",
        `${label} must map valid environment variable names to strings.`,
      );
    }
    normalized[name] = entry;
  }
  return normalized;
}

function normalizeMcpProfiles(value) {
  if (value === undefined) {
    return {};
  }
  const source = requireObject(value, "mcpProfiles");
  const profiles = {};
  for (const [name, rawProfile] of Object.entries(source)) {
    validateName(name, "MCP profile name");
    const profile = requireObject(rawProfile, `mcpProfiles.${name}`);
    const transport = optionalString(
      profile.transport,
      `mcpProfiles.${name}.transport`,
      "stdio",
    );
    if (!MCP_TRANSPORTS.has(transport)) {
      fail(
        "invalid_catalog",
        `mcpProfiles.${name}.transport must be stdio or http.`,
      );
    }

    if (transport === "http") {
      const url = validateMcpUrl(profile.url);
      if (profile.command !== undefined || profile.args !== undefined || profile.env !== undefined) {
        fail(
          "invalid_catalog",
          `mcpProfiles.${name} cannot mix HTTP URL and stdio command fields.`,
        );
      }
      profiles[name] = { transport, url };
      continue;
    }

    const command = optionalString(profile.command, `mcpProfiles.${name}.command`);
    if (!command) {
      fail("invalid_catalog", `mcpProfiles.${name}.command is required.`);
    }
    const args = stringArray(profile.args, `mcpProfiles.${name}.args`);
    const env = normalizeEnvironment(profile.env, `mcpProfiles.${name}.env`);
    const templateValues = [...args, ...Object.values(env)];
    if (!templateValues.some((entry) => entry.includes("{endpoint}"))) {
      fail(
        "invalid_catalog",
        `mcpProfiles.${name} must use {endpoint} in args or env.`,
      );
    }
    if (profile.url !== undefined) {
      fail(
        "invalid_catalog",
        `mcpProfiles.${name} cannot mix stdio command fields and HTTP URL.`,
      );
    }
    profiles[name] = { transport, command, args, env };
  }
  return profiles;
}

function normalizeLifecycle(name, value) {
  const lifecycle = value === undefined ? {} : requireObject(value, `workspaces.${name}.lifecycle`);
  const provider = optionalString(
    lifecycle.provider,
    `workspaces.${name}.lifecycle.provider`,
    "auto",
  );
  if (!PROVIDERS.has(provider)) {
    fail(
      "invalid_catalog",
      `workspaces.${name}.lifecycle.provider must be auto, launchd, systemd-user, or external.`,
    );
  }

  const browser = optionalString(
    lifecycle.browser,
    `workspaces.${name}.lifecycle.browser`,
    "auto",
  );
  const profileDir = optionalString(
    lifecycle.profileDir,
    `workspaces.${name}.lifecycle.profileDir`,
  );
  const extraArgs = stringArray(
    lifecycle.extraArgs,
    `workspaces.${name}.lifecycle.extraArgs`,
  );
  for (const argument of extraArgs) {
    if (RESERVED_BROWSER_ARGS.some((reserved) => argument === reserved || argument.startsWith(`${reserved}=`))) {
      fail(
        "invalid_catalog",
        `workspaces.${name}.lifecycle.extraArgs cannot override ${argument.split("=")[0]}.`,
      );
    }
  }
  const headless = lifecycle.headless ?? false;
  if (typeof headless !== "boolean") {
    fail("invalid_catalog", `workspaces.${name}.lifecycle.headless must be boolean.`);
  }

  return {
    provider,
    browser,
    profileDir,
    headless,
    extraArgs,
    environment: normalizeEnvironment(
      lifecycle.environment,
      `workspaces.${name}.lifecycle.environment`,
    ),
  };
}

function normalizeMcp(name, value, profiles) {
  if (value === undefined) {
    return null;
  }
  const mcp = requireObject(value, `workspaces.${name}.mcp`);
  const serverName = optionalString(mcp.serverName, `workspaces.${name}.mcp.serverName`);
  const profile = optionalString(mcp.profile, `workspaces.${name}.mcp.profile`);
  if (serverName && !MCP_NAME_PATTERN.test(serverName)) {
    fail("invalid_catalog", `workspaces.${name}.mcp.serverName is invalid.`);
  }
  if (profile && !profiles[profile]) {
    fail(
      "invalid_catalog",
      `workspaces.${name}.mcp.profile references an unknown profile: ${profile}`,
    );
  }
  if (!serverName && !profile) {
    fail(
      "invalid_catalog",
      `workspaces.${name}.mcp must define serverName, profile, or both.`,
    );
  }
  return { serverName: serverName ?? null, profile: profile ?? null };
}

export function normalizeCatalog(rawCatalog) {
  const source = requireObject(rawCatalog, "catalog");
  if (source.version !== 1) {
    fail("unsupported_catalog_version", `Unsupported catalog version: ${source.version}`);
  }
  const defaultName = validateName(source.default, "default workspace name");
  const profiles = normalizeMcpProfiles(source.mcpProfiles);
  const rawWorkspaces = requireObject(source.workspaces, "workspaces");
  const entries = Object.entries(rawWorkspaces);
  if (entries.length === 0) {
    fail("invalid_catalog", "workspaces must contain at least one workspace.");
  }

  const workspaces = {};
  const endpoints = new Map();
  for (const [name, rawWorkspace] of entries) {
    validateName(name);
    const workspace = requireObject(rawWorkspace, `workspaces.${name}`);
    const endpoint = validateEndpoint(workspace.endpoint);
    if (endpoints.has(endpoint)) {
      fail(
        "duplicate_endpoint",
        `Workspaces ${endpoints.get(endpoint)} and ${name} use the same endpoint: ${endpoint}`,
      );
    }
    endpoints.set(endpoint, name);

    workspaces[name] = {
      name,
      purpose: optionalString(workspace.purpose, `workspaces.${name}.purpose`, name),
      session: optionalString(workspace.session, `workspaces.${name}.session`, ""),
      endpoint,
      tags: stringArray(workspace.tags, `workspaces.${name}.tags`),
      lifecycle: normalizeLifecycle(name, workspace.lifecycle),
      mcp: normalizeMcp(name, workspace.mcp, profiles),
    };
  }

  if (!workspaces[defaultName]) {
    fail("invalid_catalog", `Default workspace is not registered: ${defaultName}`);
  }

  return {
    version: 1,
    default: defaultName,
    mcpProfiles: profiles,
    workspaces,
  };
}

export function loadCatalog(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      fail(
        "catalog_not_found",
        `Workspace catalog does not exist: ${configPath}. Run init first.`,
      );
    }
    fail("catalog_read_failed", `Unable to read workspace catalog: ${configPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail("invalid_json", `Workspace catalog is not valid JSON: ${error.message}`);
  }
  return normalizeCatalog(parsed);
}

export function defaultCatalog() {
  return {
    version: 1,
    default: "general",
    mcpProfiles: {},
    workspaces: {
      general: {
        purpose: "General browsing with a persistent, isolated profile",
        session: "",
        endpoint: "http://127.0.0.1:9223",
        tags: ["general"],
        lifecycle: {
          provider: "auto",
          browser: "auto",
          headless: false,
          extraArgs: [],
          environment: {},
        },
      },
    },
  };
}

export function initializeCatalog(configPath, options = {}) {
  if (fs.existsSync(configPath) && !options.force) {
    fail(
      "catalog_exists",
      `Workspace catalog already exists: ${configPath}. Use --force to replace it.`,
    );
  }
  const content = `${JSON.stringify(defaultCatalog(), null, 2)}\n`;
  atomicWriteFile(configPath, content, 0o600);
  return { action: "init", configPath };
}

export function selectWorkspaces(catalog, names = []) {
  const selectedNames = names.length === 0 ? [catalog.default] : names;
  const missing = [];
  const selected = [];
  for (const name of selectedNames) {
    validateName(name);
    if (!catalog.workspaces[name]) {
      missing.push(name);
      continue;
    }
    selected.push(catalog.workspaces[name]);
  }
  if (missing.length > 0) {
    fail("workspace_not_found", `Workspace not found: ${missing.join(", ")}`);
  }
  return selected;
}
