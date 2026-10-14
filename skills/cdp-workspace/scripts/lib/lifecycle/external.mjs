import { fail } from "../errors.mjs";

export function createExternalLifecycle() {
  return {
    provider: "external",
    async status() {
      return {
        provider: "external",
        supported: true,
        active: false,
        state: "externally-managed",
      };
    },
    async install() {
      return {
        provider: "external",
        installed: false,
        required: false,
      };
    },
    async start(workspace) {
      fail(
        "external_lifecycle",
        `Workspace ${workspace.name} is externally managed and cannot be started by CDP Workspace.`,
      );
    },
    async stop(workspace) {
      fail(
        "external_lifecycle",
        `Workspace ${workspace.name} is externally managed and cannot be stopped by CDP Workspace.`,
      );
    },
  };
}
