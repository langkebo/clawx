import {
  classifyProviderError,
  clearRoutingCache,
  getVikingFullStats,
} from "../../agents/viking-router.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const log = createSubsystemLogger("viking-rpc");

function classifyVikingError(err: unknown): {
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes];
  retryable: boolean;
} {
  if (err == null || typeof err === "string" || typeof err === "number") {
    return { code: ErrorCodes.UNAVAILABLE, retryable: false };
  }
  const classified = classifyProviderError(err);
  switch (classified.type) {
    case "rate_limit":
    case "transient":
      return { code: ErrorCodes.UNAVAILABLE, retryable: true };
    case "auth":
      return { code: ErrorCodes.UNAVAILABLE, retryable: false };
    case "billing":
      return { code: ErrorCodes.INVALID_REQUEST, retryable: false };
    case "format":
      return { code: ErrorCodes.INVALID_REQUEST, retryable: false };
    default:
      return { code: ErrorCodes.UNAVAILABLE, retryable: false };
  }
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.slice(0, 200);
  }
  return "internal error";
}

export const vikingHandlers: GatewayRequestHandlers = {
  "viking.stats": async ({ respond }) => {
    try {
      const stats = getVikingFullStats();
      respond(true, stats, undefined);
    } catch (err) {
      const classified = classifyVikingError(err);
      respond(
        false,
        undefined,
        errorShape(classified.code, safeErrorMessage(err), { retryable: classified.retryable }),
      );
    }
  },
  "viking.cache.clear": async ({ respond, client }) => {
    try {
      clearRoutingCache();
      log.info(`[viking] cache cleared via RPC by ${client?.connId ?? "unknown"}`);
      respond(true, { cleared: true }, undefined);
    } catch (err) {
      const classified = classifyVikingError(err);
      respond(
        false,
        undefined,
        errorShape(classified.code, safeErrorMessage(err), { retryable: classified.retryable }),
      );
    }
  },
};
