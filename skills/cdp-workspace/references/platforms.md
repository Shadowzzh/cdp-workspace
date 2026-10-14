# Platform support

## macOS

Managed workspaces use generated files under `~/Library/LaunchAgents`.
LaunchAgents are installed on demand, do not run at login, and are not kept
alive after the browser exits. Standard output and error go to the state
directory printed by `paths`.

The default browser discovery order is Google Chrome, Chrome Beta, Chromium,
Brave Browser, and Microsoft Edge. Set `lifecycle.browser` to override it.

## Linux

Managed workspaces use transient services created with `systemd-run --user`.
They are addressed as `cdp-workspace-<name>.service`, inspected with
`systemctl --user`, and logged through the user journal.

CDP Workspace does not enable lingering. Without lingering, the per-user
service manager and browser may stop after the user's final login session ends.
Use `doctor` to inspect availability and the current linger state.

Headed browsers also require a usable desktop environment. Configure
`lifecycle.environment` when the user manager lacks required variables such as
`DISPLAY` or `WAYLAND_DISPLAY`. Servers without a desktop should set
`headless: true`.

The default discovery order is `google-chrome-stable`, `google-chrome`,
`chromium`, `chromium-browser`, `brave-browser`, `microsoft-edge-stable`, and
`microsoft-edge`.

## Other platforms

Catalog validation, status probes, paths, and MCP snippet rendering remain
available. Managed lifecycle operations return `unsupported_platform`.
Windows lifecycle support is intentionally out of scope for the current
release.

## Diagnostics

Run:

```bash
node scripts/cdp-workspace.mjs doctor --json
```

The command is read-only. It reports browser candidates, lifecycle commands,
the catalog path, and Linux user-manager and linger checks. It never installs a
browser, enables lingering, or changes service state.
