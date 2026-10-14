import { fail } from "../errors.mjs";

export function systemdUnit(workspaceName) {
  return `cdp-workspace-${workspaceName}.service`;
}

function parseProperties(output) {
  const properties = {};
  for (const line of output.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    properties[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return properties;
}

function missingUnit(stderr) {
  const normalized = stderr.toLowerCase();
  return (
    normalized.includes("not found") ||
    normalized.includes("not loaded") ||
    normalized.includes("no such")
  );
}

export function createSystemdUserLifecycle(context) {
  const { runner } = context;

  async function status(workspace) {
    const unit = systemdUnit(workspace.name);
    const result = await runner(
      "systemctl",
      [
        "--user",
        "show",
        unit,
        "--property=LoadState",
        "--property=ActiveState",
        "--property=SubState",
        "--no-pager",
      ],
      { timeoutMs: 5_000 },
    );

    if (result.code !== 0) {
      if (missingUnit(result.stderr)) {
        return {
          provider: "systemd-user",
          supported: true,
          active: false,
          loaded: false,
          state: "not-found",
          unit,
        };
      }
      return {
        provider: "systemd-user",
        supported: false,
        active: false,
        loaded: false,
        state: "user-manager-unavailable",
        reason: "systemctl_user_failed",
        unit,
      };
    }

    const properties = parseProperties(result.stdout);
    const activeState = properties.ActiveState ?? "unknown";
    const loaded = properties.LoadState !== "not-found";
    return {
      provider: "systemd-user",
      supported: true,
      active: activeState === "active",
      loaded,
      state: activeState,
      subState: properties.SubState ?? "unknown",
      unit,
    };
  }

  async function install(workspace) {
    return {
      provider: "systemd-user",
      installed: false,
      required: false,
      transient: true,
      unit: systemdUnit(workspace.name),
    };
  }

  async function start(workspace, spec) {
    const before = await status(workspace);
    if (!before.supported) {
      fail(
        "user_manager_unavailable",
        "The systemd user manager is unavailable. Start a user session or use an external workspace.",
        { unit: before.unit },
        2,
      );
    }
    if (before.active) {
      return {
        action: "start",
        provider: "systemd-user",
        alreadyActive: true,
        unit: before.unit,
      };
    }
    if (before.loaded) {
      await runner("systemctl", ["--user", "stop", before.unit], {
        timeoutMs: 15_000,
      });
      await runner("systemctl", ["--user", "reset-failed", before.unit], {
        timeoutMs: 5_000,
      });
    }

    const args = [
      "--user",
      `--unit=${before.unit}`,
      "--collect",
      "--service-type=exec",
      "--property=Restart=no",
      "--property=KillMode=control-group",
      `--description=CDP Workspace ${workspace.name}`,
    ];
    for (const [name, value] of Object.entries(spec.environment)) {
      args.push(`--setenv=${name}=${value}`);
    }
    args.push("--", spec.command, ...spec.args);

    const result = await runner("systemd-run", args, { timeoutMs: 15_000 });
    if (result.code !== 0) {
      fail(
        "systemd_start_failed",
        `Unable to start transient user service for ${workspace.name}.`,
        { stderr: result.stderr.trim(), unit: before.unit },
      );
    }
    return {
      action: "start",
      provider: "systemd-user",
      alreadyActive: false,
      transient: true,
      unit: before.unit,
    };
  }

  async function stop(workspace) {
    const before = await status(workspace);
    if (!before.supported) {
      fail(
        "user_manager_unavailable",
        "The systemd user manager is unavailable.",
        { unit: before.unit },
        2,
      );
    }
    if (!before.loaded) {
      return {
        action: "stop",
        provider: "systemd-user",
        alreadyStopped: true,
        unit: before.unit,
      };
    }

    const result = await runner("systemctl", ["--user", "stop", before.unit], {
      timeoutMs: 15_000,
    });
    if (result.code !== 0) {
      fail(
        "systemd_stop_failed",
        `Unable to stop transient user service for ${workspace.name}.`,
        { stderr: result.stderr.trim(), unit: before.unit },
      );
    }
    await runner("systemctl", ["--user", "reset-failed", before.unit], {
      timeoutMs: 5_000,
    });
    return {
      action: "stop",
      provider: "systemd-user",
      alreadyStopped: false,
      unit: before.unit,
    };
  }

  return { provider: "systemd-user", status, install, start, stop };
}
