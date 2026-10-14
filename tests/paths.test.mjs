import assert from "node:assert/strict";
import test from "node:test";

import { resolvePaths } from "../skills/cdp-workspace/scripts/lib/paths.mjs";

test("uses native macOS paths without personal hard-coding", () => {
  const paths = resolvePaths({
    platform: "darwin",
    homeDirectory: "/Users/example",
    env: {},
  });
  assert.equal(
    paths.configPath,
    "/Users/example/Library/Application Support/cdp-workspace/workspaces.json",
  );
  assert.equal(paths.profileRoot.includes("/Users/example/"), true);
});

test("honors Linux XDG and explicit overrides", () => {
  const paths = resolvePaths({
    platform: "linux",
    homeDirectory: "/home/example",
    env: {
      XDG_CONFIG_HOME: "/tmp/config",
      XDG_DATA_HOME: "/tmp/data",
      XDG_STATE_HOME: "/tmp/state",
      CDP_WORKSPACE_CONFIG: "/tmp/custom.json",
    },
  });
  assert.equal(paths.configPath, "/tmp/custom.json");
  assert.equal(paths.dataRoot, "/tmp/data/cdp-workspace");
  assert.equal(paths.stateRoot, "/tmp/state/cdp-workspace");
});
