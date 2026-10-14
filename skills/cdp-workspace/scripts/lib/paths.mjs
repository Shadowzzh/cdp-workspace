import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fail } from "./errors.mjs";

function environmentValue(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return value;
}

export function expandHome(value, homeDirectory = os.homedir()) {
  if (value === "~") {
    return homeDirectory;
  }
  if (value.startsWith("~/")) {
    return path.join(homeDirectory, value.slice(2));
  }
  return value;
}

export function resolvePaths(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? os.homedir();

  let configRoot;
  let dataRoot;
  let stateRoot;

  if (platform === "darwin") {
    const applicationSupport = path.join(homeDirectory, "Library/Application Support");
    configRoot = path.join(applicationSupport, "cdp-workspace");
    dataRoot = configRoot;
    stateRoot = path.join(configRoot, "state");
  } else {
    configRoot = path.join(
      environmentValue(env, "XDG_CONFIG_HOME") ?? path.join(homeDirectory, ".config"),
      "cdp-workspace",
    );
    dataRoot = path.join(
      environmentValue(env, "XDG_DATA_HOME") ?? path.join(homeDirectory, ".local/share"),
      "cdp-workspace",
    );
    stateRoot = path.join(
      environmentValue(env, "XDG_STATE_HOME") ?? path.join(homeDirectory, ".local/state"),
      "cdp-workspace",
    );
  }

  const configuredCatalog =
    options.configOverride ?? environmentValue(env, "CDP_WORKSPACE_CONFIG");
  const configuredData = environmentValue(env, "CDP_WORKSPACE_DATA_DIR");
  const configuredState = environmentValue(env, "CDP_WORKSPACE_STATE_DIR");

  if (configuredData) {
    dataRoot = path.resolve(expandHome(configuredData, homeDirectory));
  }
  if (configuredState) {
    stateRoot = path.resolve(expandHome(configuredState, homeDirectory));
  }

  const configPath = configuredCatalog
    ? path.resolve(expandHome(configuredCatalog, homeDirectory))
    : path.join(configRoot, "workspaces.json");

  return {
    platform,
    homeDirectory,
    configPath,
    dataRoot,
    stateRoot,
    profileRoot: path.join(dataRoot, "profiles"),
    logRoot: path.join(stateRoot, "logs"),
    launchAgentsRoot: path.join(homeDirectory, "Library/LaunchAgents"),
  };
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function findOnPath(command, env = process.env) {
  if (command.includes(path.sep)) {
    const resolved = path.resolve(expandHome(command));
    return isExecutable(resolved) ? resolved : null;
  }

  const pathValue = environmentValue(env, "PATH") ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function browserCandidates(platform = process.platform) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }

  if (platform === "linux") {
    return [
      "google-chrome-stable",
      "google-chrome",
      "chromium",
      "chromium-browser",
      "brave-browser",
      "microsoft-edge-stable",
      "microsoft-edge",
    ];
  }

  return [];
}

export function discoverBrowsers(platform = process.platform, env = process.env) {
  const discovered = [];
  for (const candidate of browserCandidates(platform)) {
    let resolved = null;
    if (path.isAbsolute(candidate)) {
      resolved = isExecutable(candidate) ? candidate : null;
    } else {
      resolved = findOnPath(candidate, env);
    }
    if (resolved && !discovered.includes(resolved)) {
      discovered.push(resolved);
    }
  }
  return discovered;
}

export function resolveBrowserExecutable(workspace, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const configured = workspace.lifecycle.browser;

  if (configured && configured !== "auto") {
    const expanded = expandHome(configured, homeDirectory);
    let resolved = null;
    if (path.isAbsolute(expanded) || expanded.includes(path.sep)) {
      const absolute = path.resolve(expanded);
      resolved = isExecutable(absolute) ? absolute : null;
    } else {
      resolved = findOnPath(expanded, env);
    }
    if (!resolved) {
      fail("browser_not_found", `Browser executable was not found: ${configured}`);
    }
    return resolved;
  }

  const discovered = discoverBrowsers(platform, env);
  if (discovered.length === 0) {
    fail(
      "browser_not_found",
      "No supported Chrome or Chromium executable was found. Configure lifecycle.browser explicitly.",
    );
  }
  return discovered[0];
}
