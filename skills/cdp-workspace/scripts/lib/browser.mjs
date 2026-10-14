import os from "node:os";
import path from "node:path";

import { ensurePrivateDirectory } from "./fs.mjs";
import { expandHome, resolveBrowserExecutable } from "./paths.mjs";

export function resolveProvider(provider, platform = process.platform) {
  if (provider !== "auto") {
    return provider;
  }
  if (platform === "darwin") {
    return "launchd";
  }
  if (platform === "linux") {
    return "systemd-user";
  }
  return "unsupported";
}

export function buildLaunchSpec(workspace, paths, options = {}) {
  const browser = resolveBrowserExecutable(workspace, {
    platform: paths.platform,
    env: options.env ?? process.env,
    homeDirectory: paths.homeDirectory,
  });
  const endpoint = new URL(workspace.endpoint);
  const profileDir = workspace.lifecycle.profileDir
    ? path.resolve(expandHome(workspace.lifecycle.profileDir, paths.homeDirectory))
    : path.join(paths.profileRoot, workspace.name);

  ensurePrivateDirectory(profileDir);
  ensurePrivateDirectory(paths.logRoot);

  const args = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${endpoint.port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (workspace.lifecycle.headless) {
    args.push("--headless=new");
  }
  args.push(...workspace.lifecycle.extraArgs, "about:blank");

  return {
    workspaceName: workspace.name,
    command: browser,
    args,
    environment: { ...workspace.lifecycle.environment },
    profileDir,
    endpoint: workspace.endpoint,
    uid: options.uid ?? process.getuid?.() ?? null,
    username: options.username ?? os.userInfo().username,
  };
}
