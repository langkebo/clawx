import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SessionsYieldSchema = Type.Object({
  message: Type.Optional(
    Type.String({
      description:
        "Optional message to pass into the next turn. If omitted, the current turn ends silently.",
    }),
  ),
});

export function createSessionsYieldTool(): AnyAgentTool {
  return {
    label: "Sessions Yield",
    name: "sessions_yield",
    description:
      "End the current turn early and optionally pass a message into the next turn. Use this when you need to pause and let the next turn continue with additional context, or when you want to yield without producing a user-visible reply.",
    parameters: SessionsYieldSchema,
    execute: async (_toolCallId, params) => {
      const message = readStringParam(params, "message");
      return jsonResult({
        yielded: true,
        message: message ?? undefined,
        hint: message
          ? "Current turn ended. The message will be injected into the next turn."
          : "Current turn ended. The next turn will proceed normally.",
      });
    },
  };
}
