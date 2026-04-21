import {
  clearRoutingCache,
  getVikingFullStats,
  getVikingOptimizations,
} from "../../agents/viking-router.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

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
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "viking.cache.clear": async ({ respond }) => {
    try {
      clearRoutingCache();
      respond(true, { cleared: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
