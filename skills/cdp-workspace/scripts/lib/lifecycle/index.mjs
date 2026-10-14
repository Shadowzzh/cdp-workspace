import { resolveProvider } from "../browser.mjs";
import { runCommand } from "../command.mjs";
import { createExternalLifecycle } from "./external.mjs";
import { createLaunchdLifecycle } from "./launchd.mjs";
import { createSystemdUserLifecycle } from "./systemd-user.mjs";
import { createUnsupportedLifecycle } from "./unsupported.mjs";

export function createLifecycle(workspace, paths, options = {}) {
  const provider = resolveProvider(workspace.lifecycle.provider, paths.platform);
  const context = {
    paths,
    runner: options.runner ?? runCommand,
  };

  if (provider === "external") {
    return createExternalLifecycle();
  }
  if (provider === "launchd" && paths.platform === "darwin") {
    return createLaunchdLifecycle(context);
  }
  if (provider === "systemd-user" && paths.platform === "linux") {
    return createSystemdUserLifecycle(context);
  }
  return createUnsupportedLifecycle(paths.platform, provider);
}
