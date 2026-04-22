import {
  classifyProviderError,
  clearRoutingCache,
  getVikingFullStats,
  getVikingOptimizations,
} from "../../agents/viking-router.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const log = createSubsystemLogger("viking-rpc");

function classifyVikingError(err: unknown): {
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes];
  retryable: boolean;
} {
  const classified = classifyProviderError(err);
  switch (classified.type) {
    case "rate_limit":
    case "transient":
      return { code: ErrorCodes.UNAVAILABLE, retryable: true };
    case "auth":
    case "billing":
      return { code: ErrorCodes.INVALID_REQUEST, retryable: false };
    default:
      return { code: ErrorCodes.UNAVAILABLE, retryable: classified.retryable };
  }
}

export const vikingHandlers: GatewayRequestHandlers = {
  "viking.stats": async ({ respond }) => {
    try {
      const stats = getVikingFullStats();
      respond(
        true,
        {
          ...stats,
          optimizations: getVikingOptimizations(),
        },
        undefined,
      );
    } catch (err) {
      const classified = classifyVikingError(err);
      respond(
        false,
        undefined,
        errorShape(classified.code, String(err), { retryable: classified.retryable }),
      );
    }
  },
  "viking.cache.clear": async ({ respond }) => {
    try {
      clearRoutingCache();
      log.info("[viking] cache cleared via RPC");
      respond(true, { cleared: true }, undefined);
    } catch (err) {
      const classified = classifyVikingError(err);
      respond(
        false,
        undefined,
        errorShape(classified.code, String(err), { retryable: classified.retryable }),
      );
    }
  },
};
