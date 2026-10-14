import { buildLaunchSpec, resolveProvider } from "./browser.mjs";
import { fail } from "./errors.mjs";
import { createLifecycle } from "./lifecycle/index.mjs";
import { probeEndpoint, waitForProbe } from "./probe.mjs";

function publicWorkspace(workspace) {
  return {
    name: workspace.name,
    purpose: workspace.purpose,
    session: workspace.session,
    endpoint: workspace.endpoint,
    tags: workspace.tags,
    mcp: workspace.mcp,
  };
}

function combinedState(probe, lifecycle) {
  if (probe.healthy) {
    return "active";
  }
  if (!lifecycle.supported) {
    return "unsupported";
  }
  if (lifecycle.active) {
    return "degraded";
  }
  if (lifecycle.provider === "external") {
    return "unreachable";
  }
  return "inactive";
}

export async function workspaceStatus(workspace, paths, options = {}) {
  const lifecycle = createLifecycle(workspace, paths, options);
  const [probe, lifecycleStatus] = await Promise.all([
    probeEndpoint(workspace.endpoint, { timeoutMs: options.timeoutMs }),
    lifecycle.status(workspace),
  ]);
  return {
    ...publicWorkspace(workspace),
    provider: resolveProvider(workspace.lifecycle.provider, paths.platform),
    status: combinedState(probe, lifecycleStatus),
    healthy: probe.healthy,
    browser: probe.browser ?? null,
    protocolVersion: probe.protocolVersion ?? null,
    observedAt: probe.observedAt,
    probeReason: probe.reason ?? null,
    lifecycle: lifecycleStatus,
  };
}

export async function listStatuses(catalog, paths, options = {}) {
  const workspaces = Object.values(catalog.workspaces).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const statuses = await Promise.all(
    workspaces.map((workspace) => workspaceStatus(workspace, paths, options)),
  );
  return {
    action: "list",
    default: catalog.default,
    workspaces: statuses.map((workspace) => ({
      ...workspace,
      default: workspace.name === catalog.default,
    })),
  };
}

export async function selectedStatuses(workspaces, paths, options = {}) {
  return {
    action: "status",
    workspaces: await Promise.all(
      workspaces.map((workspace) => workspaceStatus(workspace, paths, options)),
    ),
  };
}

export async function installWorkspace(workspace, paths, options = {}) {
  const lifecycle = createLifecycle(workspace, paths, options);
  if (lifecycle.provider === "external") {
    return { name: workspace.name, ...(await lifecycle.install(workspace)) };
  }
  if (!["launchd", "systemd-user"].includes(lifecycle.provider)) {
    return { name: workspace.name, ...(await lifecycle.install(workspace)) };
  }
  const spec = buildLaunchSpec(workspace, paths, options);
  return {
    name: workspace.name,
    profileDir: spec.profileDir,
    ...(await lifecycle.install(workspace, spec)),
  };
}

export async function startWorkspace(workspace, paths, options = {}) {
  const lifecycle = createLifecycle(workspace, paths, options);
  const beforeProbe = await probeEndpoint(workspace.endpoint, {
    timeoutMs: options.timeoutMs,
  });
  const beforeLifecycle = await lifecycle.status(workspace);

  if (beforeProbe.healthy) {
    if (lifecycle.provider === "external" || beforeLifecycle.active) {
      return {
        action: "start",
        name: workspace.name,
        provider: lifecycle.provider,
        alreadyActive: true,
        endpoint: workspace.endpoint,
        browser: beforeProbe.browser,
      };
    }
    fail(
      "endpoint_in_use",
      `Endpoint ${workspace.endpoint} is active but is not owned by this workspace lifecycle.`,
    );
  }

  if (beforeLifecycle.active) {
    fail(
      "lifecycle_degraded",
      `The lifecycle for ${workspace.name} is active but its CDP endpoint is unavailable.`,
      { lifecycle: beforeLifecycle },
    );
  }

  if (lifecycle.provider === "external") {
    return lifecycle.start(workspace);
  }
  if (!beforeLifecycle.supported) {
    return lifecycle.start(workspace);
  }

  const spec = buildLaunchSpec(workspace, paths, options);
  const result = await lifecycle.start(workspace, spec);
  const probe = await waitForProbe(workspace.endpoint, true, {
    timeoutMs: options.startTimeoutMs ?? 10_000,
    intervalMs: 200,
  });
  if (!probe.healthy) {
    fail(
      "browser_not_ready",
      `Browser lifecycle started for ${workspace.name}, but ${workspace.endpoint} did not become healthy.`,
      { provider: lifecycle.provider, reason: probe.reason },
    );
  }
  return {
    ...result,
    name: workspace.name,
    endpoint: workspace.endpoint,
    browser: probe.browser,
    profileDir: spec.profileDir,
  };
}

export async function stopWorkspace(workspace, paths, options = {}) {
  const lifecycle = createLifecycle(workspace, paths, options);
  const beforeProbe = await probeEndpoint(workspace.endpoint, {
    timeoutMs: options.timeoutMs,
  });
  const beforeLifecycle = await lifecycle.status(workspace);

  if (lifecycle.provider === "external") {
    return lifecycle.stop(workspace);
  }
  if (!beforeLifecycle.supported) {
    return lifecycle.stop(workspace);
  }
  if (beforeProbe.healthy && !beforeLifecycle.active) {
    fail(
      "endpoint_not_owned",
      `Endpoint ${workspace.endpoint} is active, but this lifecycle does not own it.`,
    );
  }
  if (!beforeLifecycle.active) {
    if (beforeLifecycle.loaded) {
      const result = await lifecycle.stop(workspace);
      return { ...result, name: workspace.name, endpoint: workspace.endpoint };
    }
    return {
      action: "stop",
      name: workspace.name,
      provider: lifecycle.provider,
      alreadyStopped: true,
    };
  }

  const result = await lifecycle.stop(workspace);
  const probe = await waitForProbe(workspace.endpoint, false, {
    timeoutMs: options.stopTimeoutMs ?? 10_000,
    intervalMs: 200,
  });
  if (probe.healthy) {
    fail(
      "browser_still_running",
      `Lifecycle stopped for ${workspace.name}, but its CDP endpoint is still active.`,
    );
  }
  return { ...result, name: workspace.name, endpoint: workspace.endpoint };
}
