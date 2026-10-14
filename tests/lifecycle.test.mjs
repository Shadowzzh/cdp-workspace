import assert from "node:assert/strict";
import test from "node:test";

import { renderLaunchAgent } from "../skills/cdp-workspace/scripts/lib/lifecycle/launchd.mjs";
import { createLifecycle } from "../skills/cdp-workspace/scripts/lib/lifecycle/index.mjs";
import { createSystemdUserLifecycle } from "../skills/cdp-workspace/scripts/lib/lifecycle/systemd-user.mjs";
import { stopWorkspace } from "../skills/cdp-workspace/scripts/lib/workspaces.mjs";

const workspace = { name: "general" };
const spec = {
  command: "/opt/browser/Chrome & Safe",
  args: [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9223",
    "--user-data-dir=/tmp/profile",
  ],
  environment: { DISPLAY: ":1" },
};

test("generated LaunchAgent is on demand and contains no private identity", () => {
  const content = renderLaunchAgent(workspace, spec, {
    logRoot: "/tmp/cdp-workspace/logs",
  });
  assert.match(content, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.match(content, /<key>KeepAlive<\/key>\s*<false\/>/);
  assert.match(content, /app\.cdp-workspace\.general/);
  assert.match(content, /Chrome &amp; Safe/);
  const formerUser = ["zhang", "ziheng"].join("");
  const formerLabel = ["dev", "zzheng"].join(".");
  assert.equal(content.includes(formerUser), false);
  assert.equal(content.includes(formerLabel), false);
});

test("systemd user lifecycle starts a transient, collectable service", async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (command === "systemctl" && args.includes("show")) {
      return {
        code: 0,
        stdout: "LoadState=not-found\nActiveState=inactive\nSubState=dead\n",
        stderr: "",
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const lifecycle = createSystemdUserLifecycle({ runner });
  const result = await lifecycle.start(workspace, spec);
  assert.equal(result.unit, "cdp-workspace-general.service");
  const startCall = calls.find((call) => call.command === "systemd-run");
  assert.ok(startCall);
  assert.ok(startCall.args.includes("--user"));
  assert.ok(startCall.args.includes("--collect"));
  assert.ok(startCall.args.includes("--service-type=exec"));
  assert.ok(startCall.args.includes("--setenv=DISPLAY=:1"));
  assert.ok(startCall.args.includes("/opt/browser/Chrome & Safe"));
});

test("unsupported platforms degrade without running platform commands", async () => {
  const lifecycle = createLifecycle(
    {
      name: "general",
      lifecycle: { provider: "auto" },
    },
    { platform: "win32" },
  );
  const status = await lifecycle.status();
  assert.equal(status.supported, false);
  assert.equal(status.state, "unsupported");
  await assert.rejects(() => lifecycle.start(), {
    code: "unsupported_platform",
    exitCode: 2,
  });
});

test("stop unloads a launchd job that is loaded but not running", async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (command === "launchctl" && args[0] === "print") {
      return { code: 0, stdout: "state = not running\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const result = await stopWorkspace(
    {
      name: "loaded-test",
      endpoint: "http://127.0.0.1:61999",
      lifecycle: { provider: "launchd" },
    },
    { platform: "darwin" },
    { runner, timeoutMs: 50 },
  );
  assert.equal(result.alreadyStopped, false);
  assert.ok(
    calls.some(
      (call) => call.command === "launchctl" && call.args[0] === "bootout",
    ),
  );
});
