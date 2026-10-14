# Configuration

CDP Workspace reads one JSON catalog. The lookup order is:

1. `--config <path>`
2. `CDP_WORKSPACE_CONFIG`
3. The platform default printed by `paths`

The CLI never searches project repositories for a catalog.

## Catalog schema

```json
{
  "version": 1,
  "default": "general",
  "mcpProfiles": {},
  "workspaces": {
    "general": {
      "purpose": "General browsing",
      "session": "Personal session",
      "endpoint": "http://127.0.0.1:9223",
      "tags": ["general"],
      "lifecycle": {
        "provider": "auto",
        "browser": "auto",
        "profileDir": "/optional/absolute/or/home-relative/path",
        "headless": false,
        "extraArgs": [],
        "environment": {}
      },
      "mcp": {
        "serverName": "browser-general",
        "profile": "profile-name"
      }
    }
  }
}
```

Workspace names use lowercase letters, digits, and hyphens. Endpoints must use
plain HTTP on `127.0.0.1`, `localhost`, or `::1`, must include a port, and must
not contain credentials, paths, queries, or fragments.

`session` is a human description of the intended login state. The tool does not
inspect or verify accounts, cookies, or browser storage.

## Lifecycle providers

- `auto`: `launchd` on macOS, `systemd-user` on Linux, unsupported elsewhere.
- `launchd`: a generated, on-demand macOS LaunchAgent.
- `systemd-user`: a transient Linux user service.
- `external`: lifecycle is owned by another tool or person; only probing works.

For managed providers, each workspace gets a new profile directory unless
`profileDir` is explicitly set. The tool never copies an existing profile.

Set `browser` to an executable path, a command found in `PATH`, or `auto`.
Automatic discovery checks common Chrome, Chromium, Brave, and Edge locations.
The tool does not install a browser.

`environment` is passed only to the managed browser process. Do not store
secrets in the catalog.

## MCP profiles

MCP profiles are optional stdio launch templates:

```json
{
  "mcpProfiles": {
    "my-browser-mcp": {
      "command": "npx",
      "args": ["-y", "some-package", "--endpoint={endpoint}"],
      "env": {
        "WORKSPACE_NAME": "{name}"
      }
    }
  }
}
```

Supported placeholders are `{endpoint}` and `{name}`. A profile must use
`{endpoint}` in an argument or environment value. Templates are rendered, not
executed.

`mcp-snippet --format generic` returns a neutral launch specification.
`--format codex` emits TOML, and `--format claude` emits JSON. Rendering does
not modify either client's configuration.

### Verified profile examples

These optional profiles have been smoke-tested against a browser started by CDP
Workspace. They are examples, not built-in defaults; pin package versions when
reproducibility matters.

```json
{
  "mcpProfiles": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--browser-url={endpoint}",
        "--no-usage-statistics",
        "--no-performance-crux"
      ]
    },
    "playwright": {
      "command": "npx",
      "args": [
        "-y",
        "@playwright/mcp@latest",
        "--cdp-endpoint={endpoint}"
      ]
    }
  }
}
```

Chrome DevTools MCP attaches through `--browser-url`. Playwright MCP attaches
through `--cdp-endpoint`. In both cases CDP Workspace remains the browser
lifecycle owner; the MCP server is only a consumer.

## Path overrides

- `CDP_WORKSPACE_CONFIG`: catalog file.
- `CDP_WORKSPACE_DATA_DIR`: generated profiles and persistent data.
- `CDP_WORKSPACE_STATE_DIR`: logs and runtime state.

Use `paths --json` to see the resolved values.
