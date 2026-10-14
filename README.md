# CDP Workspace

CDP Workspace manages a catalog of named Chrome DevTools Protocol endpoints.
Each workspace records its purpose, intended session, isolated browser profile,
lifecycle provider, and optional MCP connection profile.

The project deliberately does not automate pages. It never opens a CDP
WebSocket and only probes `GET /json/version`. Browser automation remains the
responsibility of an optional MCP server chosen by the user.

## Install the agent skill

```bash
npx skills add Shadowzzh/cdp-workspace
```

Prerequisites for the `owner/repo` install path are Node.js, `npx`, and Git. The
`skills` CLI currently clones GitHub repositories with Git and requires Node.js
22.20 or newer.

The installed skill itself contains a dependency-free Node.js CLI. Chrome or a
Chromium-family browser is required only when CDP Workspace owns a local browser
lifecycle. Playwright and browser MCP servers are optional and are not required
for catalog, probe, start, or stop operations.

## Capabilities

- Catalog and validate named CDP workspaces.
- Probe live browser metadata through `/json/version` only.
- Start and stop managed browsers with macOS LaunchAgents.
- Start and stop managed browsers with transient Linux systemd user services.
- Keep remote or otherwise externally managed endpoints in the same catalog.
- Render stdio or Streamable HTTP MCP snippets from user-defined profiles
  without installing or selecting an MCP implementation.
- Degrade cleanly when the current platform lacks a lifecycle provider.

Interop smoke tests cover Chrome DevTools MCP over stdio and Playwright MCP over
both stdio and Streamable HTTP, all attaching to an already-running CDP
Workspace browser. Neither implementation is a runtime dependency or default.

CDP Workspace does not install Chrome, Chromium, Playwright, browser MCPs, or
system services. It does not copy an existing browser profile.

## Quick start

From the installed skill directory:

```bash
node scripts/cdp-workspace.mjs paths
node scripts/cdp-workspace.mjs init
node scripts/cdp-workspace.mjs doctor
node scripts/cdp-workspace.mjs list
```

Use `--config <path>` or `CDP_WORKSPACE_CONFIG` to select another workspace
catalog.

See [`examples/workspaces.json`](examples/workspaces.json) and the skill's
[`configuration reference`](skills/cdp-workspace/references/configuration.md).

## Lifecycle model

The `auto` provider resolves to `launchd` on macOS and `systemd-user` on Linux.
Other platforms can still validate catalogs and probe external endpoints, but
managed start and stop operations return a structured unsupported-platform
error.

Linux uses transient user services. It does not enable lingering or write
system-wide units. macOS generates per-workspace LaunchAgents with
`RunAtLoad=false` and `KeepAlive=false`.

## Development

```bash
npm test
npm run check
```

The tests use a fake HTTP endpoint that rejects every path except
`/json/version`, proving that the probe does not enumerate targets or issue CDP
commands.
