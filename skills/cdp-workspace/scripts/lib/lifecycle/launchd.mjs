import path from "node:path";

import { fail } from "../errors.mjs";
import { atomicWriteFile, ensurePrivateDirectory } from "../fs.mjs";

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stringElement(value, indent = "\t") {
  return `${indent}<string>${escapeXml(value)}</string>`;
}

export function launchdLabel(workspaceName) {
  return `app.cdp-workspace.${workspaceName}`;
}

export function renderLaunchAgent(workspace, spec, paths) {
  const label = launchdLabel(workspace.name);
  const argumentsXml = [spec.command, ...spec.args]
    .map((argument) => stringElement(argument, "\t\t"))
    .join("\n");
  const environmentEntries = Object.entries(spec.environment);
  let environmentXml = "";
  if (environmentEntries.length > 0) {
    const values = environmentEntries
      .map(
        ([name, value]) =>
          `\t\t<key>${escapeXml(name)}</key>\n${stringElement(value, "\t\t")}`,
      )
      .join("\n");
    environmentXml = `\n\t<key>EnvironmentVariables</key>\n\t<dict>\n${values}\n\t</dict>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
${stringElement(label)}
\t<key>ProgramArguments</key>
\t<array>
${argumentsXml}
\t</array>${environmentXml}
\t<key>ProcessType</key>
\t<string>Interactive</string>
\t<key>RunAtLoad</key>
\t<false/>
\t<key>KeepAlive</key>
\t<false/>
\t<key>StandardOutPath</key>
${stringElement(path.join(paths.logRoot, `${workspace.name}.stdout.log`))}
\t<key>StandardErrorPath</key>
${stringElement(path.join(paths.logRoot, `${workspace.name}.stderr.log`))}
</dict>
</plist>
`;
}

function parseState(output) {
  const match = output.match(/\bstate = ([^\n]+)/);
  return match ? match[1].trim() : "loaded";
}

export function createLaunchdLifecycle(context) {
  const { paths, runner } = context;

  function target(workspace) {
    return `gui/${process.getuid()}/${launchdLabel(workspace.name)}`;
  }

  function plistPath(workspace) {
    return path.join(paths.launchAgentsRoot, `${launchdLabel(workspace.name)}.plist`);
  }

  async function status(workspace) {
    const result = await runner("launchctl", ["print", target(workspace)], {
      timeoutMs: 5_000,
    });
    if (result.code !== 0) {
      return {
        provider: "launchd",
        supported: true,
        active: false,
        loaded: false,
        state: "unloaded",
      };
    }
    const state = parseState(result.stdout);
    return {
      provider: "launchd",
      supported: true,
      active: state === "running",
      loaded: true,
      state,
    };
  }

  async function install(workspace, spec) {
    ensurePrivateDirectory(paths.logRoot);
    ensurePrivateDirectory(paths.launchAgentsRoot);
    const destination = plistPath(workspace);
    atomicWriteFile(destination, renderLaunchAgent(workspace, spec, paths), 0o644);
    return {
      provider: "launchd",
      installed: true,
      required: true,
      plist: destination,
      label: launchdLabel(workspace.name),
    };
  }

  async function start(workspace, spec) {
    const installed = await install(workspace, spec);
    const before = await status(workspace);
    if (!before.loaded) {
      const bootstrap = await runner(
        "launchctl",
        ["bootstrap", `gui/${process.getuid()}`, installed.plist],
        { timeoutMs: 15_000 },
      );
      if (bootstrap.code !== 0) {
        fail(
          "launchd_bootstrap_failed",
          `Unable to load LaunchAgent for ${workspace.name}.`,
          { stderr: bootstrap.stderr.trim() },
        );
      }
    }

    const kickstart = await runner("launchctl", ["kickstart", target(workspace)], {
      timeoutMs: 15_000,
    });
    if (kickstart.code !== 0) {
      fail(
        "launchd_start_failed",
        `Unable to start LaunchAgent for ${workspace.name}.`,
        { stderr: kickstart.stderr.trim() },
      );
    }
    return { action: "start", provider: "launchd", ...installed };
  }

  async function stop(workspace) {
    const before = await status(workspace);
    if (!before.loaded) {
      return { action: "stop", provider: "launchd", alreadyStopped: true };
    }
    const result = await runner("launchctl", ["bootout", target(workspace)], {
      timeoutMs: 15_000,
    });
    if (result.code !== 0) {
      const after = await status(workspace);
      if (after.loaded) {
        fail(
          "launchd_stop_failed",
          `Unable to stop LaunchAgent for ${workspace.name}.`,
          { stderr: result.stderr.trim() },
        );
      }
    }
    return { action: "stop", provider: "launchd", alreadyStopped: false };
  }

  return { provider: "launchd", status, install, start, stop };
}
