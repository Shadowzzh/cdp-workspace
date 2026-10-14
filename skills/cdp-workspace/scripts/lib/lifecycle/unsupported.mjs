import { fail } from "../errors.mjs";

export function createUnsupportedLifecycle(platform, requestedProvider) {
  const details = { platform, requestedProvider };
  return {
    provider: requestedProvider,
    async status() {
      return {
        provider: requestedProvider,
        supported: false,
        active: false,
        state: "unsupported",
        details,
      };
    },
    async install() {
      fail(
        "unsupported_platform",
        `Lifecycle provider ${requestedProvider} is not supported on ${platform}.`,
        details,
        2,
      );
    },
    async start() {
      fail(
        "unsupported_platform",
        `Lifecycle provider ${requestedProvider} is not supported on ${platform}.`,
        details,
        2,
      );
    },
    async stop() {
      fail(
        "unsupported_platform",
        `Lifecycle provider ${requestedProvider} is not supported on ${platform}.`,
        details,
        2,
      );
    },
  };
}
