import {
  clearRoutingCache,
  getVikingFullStats,
} from "../../agents/viking-router.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const vikingHandlers: GatewayRequestHandlers = {
  "viking.stats": async ({ respond }) => {
    try {
      const stats = getVikingFullStats();
      respond(true, {
        ...stats,
        optimizations: {
          P0_dynamic_reroute: true,
          P1_post_compact_reroute: true,
          P2_model_switching: true,
          P3_parallel_routing: true,
          P4_rule_engine: true,
          P5_feedback_loop: true,
        },
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "viking.cache.clear": async ({ respond, client }) => {
    const scopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
    if (!scopes.includes("operator.admin")) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin"));
      return;
    }
    try {
      clearRoutingCache();
      respond(true, { cleared: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
