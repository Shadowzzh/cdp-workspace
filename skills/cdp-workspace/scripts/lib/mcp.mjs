import { fail } from "./errors.mjs";

function replacePlaceholders(value, workspace) {
  return value
    .replaceAll("{endpoint}", workspace.endpoint)
    .replaceAll("{name}", workspace.name);
}

function renderProfile(catalog, workspace, overrideProfile = undefined) {
  const profileName = overrideProfile ?? workspace.mcp?.profile;
  if (!profileName) {
    fail(
      "mcp_profile_missing",
      `Workspace ${workspace.name} does not select an MCP profile.`,
    );
  }
  const profile = catalog.mcpProfiles[profileName];
  if (!profile) {
    fail("mcp_profile_missing", `MCP profile does not exist: ${profileName}`);
  }

  const env = {};
  for (const [name, value] of Object.entries(profile.env)) {
    env[name] = replacePlaceholders(value, workspace);
  }
  return {
    workspace: workspace.name,
    endpoint: workspace.endpoint,
    profile: profileName,
    serverName: workspace.mcp?.serverName ?? `cdp-${workspace.name}`,
    command: replacePlaceholders(profile.command, workspace),
    args: profile.args.map((argument) => replacePlaceholders(argument, workspace)),
    env,
  };
}

function tomlString(value) {
  return JSON.stringify(value);
}

function renderCodex(specs) {
  const sections = [];
  for (const spec of specs) {
    const prefix = `mcp_servers.${tomlString(spec.serverName)}`;
    const lines = [
      `[${prefix}]`,
      `command = ${tomlString(spec.command)}`,
      `args = [${spec.args.map(tomlString).join(", ")}]`,
    ];
    if (Object.keys(spec.env).length > 0) {
      lines.push("", `[${prefix}.env]`);
      for (const [name, value] of Object.entries(spec.env)) {
        lines.push(`${tomlString(name)} = ${tomlString(value)}`);
      }
    }
    sections.push(lines.join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}

function renderClaude(specs) {
  const mcpServers = {};
  for (const spec of specs) {
    const value = { command: spec.command, args: spec.args };
    if (Object.keys(spec.env).length > 0) {
      value.env = spec.env;
    }
    mcpServers[spec.serverName] = value;
  }
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}

export function renderMcpSnippets(catalog, workspaces, options = {}) {
  const format = options.format ?? "generic";
  const specs = workspaces.map((workspace) =>
    renderProfile(catalog, workspace, options.profile),
  );

  if (format === "generic") {
    return { format, specs };
  }
  if (format === "codex") {
    return { format, content: renderCodex(specs) };
  }
  if (format === "claude") {
    return { format, content: renderClaude(specs) };
  }
  fail("invalid_format", `Unsupported MCP snippet format: ${format}`);
}
