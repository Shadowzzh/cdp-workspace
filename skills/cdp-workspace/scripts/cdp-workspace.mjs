#!/usr/bin/env node

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { initializeCatalog, loadCatalog, selectWorkspaces } from "./lib/catalog.mjs";
import { doctor } from "./lib/doctor.mjs";
import { errorPayload, fail, WorkspaceError } from "./lib/errors.mjs";
import { renderMcpSnippets } from "./lib/mcp.mjs";
import { resolvePaths } from "./lib/paths.mjs";
import {
  installWorkspace,
  listStatuses,
  selectedStatuses,
  startWorkspace,
  stopWorkspace,
} from "./lib/workspaces.mjs";

const HELP = `CDP Workspace

Usage:
  cdp-workspace <command> [names...] [options]

Commands:
  init                 Create a starter catalog without starting a browser
  paths                Print resolved config, data, and state paths
  validate             Validate the catalog
  list                 List and probe all workspaces
  status [names...]    Probe selected workspaces, or the default workspace
  install [names...]   Prepare lifecycle configuration without starting
  start [names...]     Start selected managed workspaces
  stop [names...]      Stop selected managed workspaces
  mcp-snippet [names...]  Render optional MCP launch snippets
  doctor               Run read-only platform and dependency checks

Options:
  --config <path>          Override the catalog path
  --json                   Emit machine-readable JSON
  --timeout-ms <number>    Probe timeout, default 1500
  --format <format>        MCP format: generic, codex, or claude
  --profile <name>         Override a workspace MCP profile
  --force                  Replace an existing catalog during init
  -h, --help               Show this help
`;

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    fail("missing_option_value", `${name} requires a value.`);
  }
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail("invalid_option", `${name} must be a positive integer.`);
  }
  return parsed;
}

export function parseArguments(argv) {
  let command = argv[0] ?? "help";
  if (command === "-h" || command === "--help") {
    command = "help";
  }
  const options = {
    command,
    names: [],
    json: false,
    force: false,
    help: false,
    format: "generic",
    timeoutMs: 1_500,
    startTimeoutMs: 10_000,
    stopTimeoutMs: 10_000,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--force") {
      options.force = true;
      continue;
    }
    if (argument === "-h" || argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--config") {
      options.config = optionValue(argv, index, "--config");
      index += 1;
      continue;
    }
    if (argument.startsWith("--config=")) {
      options.config = argument.slice("--config=".length);
      continue;
    }
    if (argument === "--format") {
      options.format = optionValue(argv, index, "--format");
      index += 1;
      continue;
    }
    if (argument.startsWith("--format=")) {
      options.format = argument.slice("--format=".length);
      continue;
    }
    if (argument === "--profile") {
      options.profile = optionValue(argv, index, "--profile");
      index += 1;
      continue;
    }
    if (argument.startsWith("--profile=")) {
      options.profile = argument.slice("--profile=".length);
      continue;
    }
    if (argument === "--timeout-ms") {
      options.timeoutMs = positiveInteger(
        optionValue(argv, index, "--timeout-ms"),
        "--timeout-ms",
      );
      index += 1;
      continue;
    }
    if (argument === "--start-timeout-ms") {
      options.startTimeoutMs = positiveInteger(
        optionValue(argv, index, "--start-timeout-ms"),
        "--start-timeout-ms",
      );
      index += 1;
      continue;
    }
    if (argument === "--stop-timeout-ms") {
      options.stopTimeoutMs = positiveInteger(
        optionValue(argv, index, "--stop-timeout-ms"),
        "--stop-timeout-ms",
      );
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      fail("unknown_option", `Unknown option: ${argument}`);
    }
    options.names.push(argument);
  }
  return options;
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printList(payload) {
  process.stdout.write("Available CDP workspaces:\n");
  for (const workspace of payload.workspaces) {
    const suffix = workspace.default ? " (default)" : "";
    process.stdout.write(`\n${workspace.name}${suffix}\n`);
    process.stdout.write(`  Purpose: ${workspace.purpose}\n`);
    process.stdout.write(`  Endpoint: ${workspace.endpoint}\n`);
    process.stdout.write(`  Status: ${workspace.status}\n`);
    process.stdout.write(`  Provider: ${workspace.provider}\n`);
    if (workspace.browser) {
      process.stdout.write(`  Browser: ${workspace.browser}\n`);
    }
    if (workspace.mcp?.serverName) {
      process.stdout.write(`  MCP server: ${workspace.mcp.serverName}\n`);
    }
  }
}

function printPayload(payload, options) {
  if (options.json) {
    printJson(payload);
    return;
  }
  if (payload.action === "list") {
    printList(payload);
    return;
  }
  if (payload.action === "mcp-snippet" && payload.result.content) {
    process.stdout.write(payload.result.content);
    return;
  }
  printJson(payload);
}

async function runForWorkspaces(action, workspaces, paths, options) {
  const results = [];
  for (const workspace of workspaces) {
    results.push(await action(workspace, paths, options));
  }
  return results;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === "help" || options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const paths = resolvePaths({ configOverride: options.config });
  if (options.command === "paths") {
    printPayload({ action: "paths", ...paths }, options);
    return 0;
  }
  if (options.command === "init") {
    printPayload(initializeCatalog(paths.configPath, { force: options.force }), options);
    return 0;
  }
  if (options.command === "doctor") {
    printPayload(await doctor(paths), options);
    return 0;
  }

  const catalog = loadCatalog(paths.configPath);
  if (options.command === "validate") {
    printPayload(
      {
        action: "validate",
        valid: true,
        configPath: paths.configPath,
        default: catalog.default,
        workspaceCount: Object.keys(catalog.workspaces).length,
      },
      options,
    );
    return 0;
  }
  if (options.command === "list") {
    printPayload(await listStatuses(catalog, paths, options), options);
    return 0;
  }

  const workspaces = selectWorkspaces(catalog, options.names);
  if (options.command === "status") {
    printPayload(await selectedStatuses(workspaces, paths, options), options);
    return 0;
  }
  if (options.command === "install") {
    const results = await runForWorkspaces(installWorkspace, workspaces, paths, options);
    printPayload({ action: "install", results }, options);
    return 0;
  }
  if (options.command === "start") {
    const results = await runForWorkspaces(startWorkspace, workspaces, paths, options);
    printPayload({ action: "start", results }, options);
    return 0;
  }
  if (options.command === "stop") {
    const results = await runForWorkspaces(stopWorkspace, workspaces, paths, options);
    printPayload({ action: "stop", results }, options);
    return 0;
  }
  if (options.command === "mcp-snippet") {
    const result = renderMcpSnippets(catalog, workspaces, options);
    printPayload({ action: "mcp-snippet", result }, options);
    return 0;
  }

  fail("unknown_command", `Unknown command: ${options.command}`);
}

const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : null;
const currentPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedPath && currentPath === invokedPath) {
  try {
    const exitCode = await run();
    process.exitCode = exitCode;
  } catch (error) {
    const options = process.argv.includes("--json");
    if (options) {
      process.stderr.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
    } else {
      const payload = errorPayload(error);
      process.stderr.write(`error [${payload.error}]: ${payload.message}\n`);
      if (payload.details) {
        process.stderr.write(`${JSON.stringify(payload.details, null, 2)}\n`);
      }
    }
    process.exitCode = error instanceof WorkspaceError ? error.exitCode : 1;
  }
}
