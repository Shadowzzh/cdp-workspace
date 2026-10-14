import fs from "node:fs";
import os from "node:os";

import { loadCatalog } from "./catalog.mjs";
import { runCommand } from "./command.mjs";
import { discoverBrowsers, findOnPath } from "./paths.mjs";

async function linuxDoctor(runner) {
  const systemctl = findOnPath("systemctl");
  const systemdRun = findOnPath("systemd-run");
  const loginctl = findOnPath("loginctl");
  let userManager = { available: false };
  let linger = { checked: false, enabled: null };

  if (systemctl) {
    const result = await runner("systemctl", ["--user", "show-environment"], {
      timeoutMs: 5_000,
    });
    userManager = {
      available: result.code === 0,
      reason: result.code === 0 ? null : "systemctl_user_failed",
    };
  }

  if (loginctl) {
    const result = await runner(
      "loginctl",
      ["show-user", os.userInfo().username, "--property=Linger", "--value"],
      { timeoutMs: 5_000 },
    );
    linger = {
      checked: result.code === 0,
      enabled: result.code === 0 ? result.stdout.trim() === "yes" : null,
    };
  }

  return {
    provider: "systemd-user",
    commands: {
      systemctl,
      systemdRun,
      loginctl,
    },
    userManager,
    linger,
  };
}

async function macDoctor(runner) {
  const launchctl = findOnPath("launchctl");
  let userDomain = { available: false };
  if (launchctl && process.getuid) {
    const result = await runner("launchctl", ["print", `gui/${process.getuid()}`], {
      timeoutMs: 5_000,
    });
    userDomain = {
      available: result.code === 0,
      reason: result.code === 0 ? null : "launchd_user_domain_failed",
    };
  }
  return {
    provider: "launchd",
    commands: { launchctl },
    userDomain,
  };
}

export async function doctor(paths, options = {}) {
  const runner = options.runner ?? runCommand;
  let lifecycle;
  if (paths.platform === "darwin") {
    lifecycle = await macDoctor(runner);
  } else if (paths.platform === "linux") {
    lifecycle = await linuxDoctor(runner);
  } else {
    lifecycle = {
      provider: "unsupported",
      platform: paths.platform,
    };
  }

  let catalog = { exists: false, valid: false };
  if (fs.existsSync(paths.configPath)) {
    try {
      const loaded = loadCatalog(paths.configPath);
      catalog = {
        exists: true,
        valid: true,
        workspaceCount: Object.keys(loaded.workspaces).length,
      };
    } catch (error) {
      catalog = {
        exists: true,
        valid: false,
        error: error.code ?? "invalid_catalog",
      };
    }
  }

  return {
    action: "doctor",
    platform: paths.platform,
    node: process.version,
    paths: {
      configPath: paths.configPath,
      dataRoot: paths.dataRoot,
      stateRoot: paths.stateRoot,
    },
    catalog,
    browsers: discoverBrowsers(paths.platform),
    lifecycle,
    mcp: {
      requiredForLifecycle: false,
      detection: "not-performed",
    },
  };
}
