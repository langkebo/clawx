import type { Command } from "commander";
import {
  readExecApprovalsSnapshot,
  saveExecApprovals,
  type ExecApprovalsDefaults,
  type ExecApprovalsFile,
  type ExecSecurity,
  type ExecAsk,
} from "../infra/exec-approvals.js";
import { defaultRuntime } from "../runtime.js";
import { renderTable } from "../terminal/table.js";
import { isRich, theme } from "../terminal/theme.js";
import { callGatewayFromCli } from "./gateway-rpc.js";
import { nodesCallOpts } from "./nodes-cli/rpc.js";
import type { NodesRpcOpts } from "./nodes-cli/types.js";

const VALID_SECURITY: ExecSecurity[] = ["deny", "allowlist", "full"];
const VALID_ASK: ExecAsk[] = ["off", "on-miss", "always"];

type ExecPolicyCliOpts = NodesRpcOpts & {
  node?: string;
  gateway?: boolean;
  agent?: string;
};

function isValidSecurity(value: string): value is ExecSecurity {
  return VALID_SECURITY.includes(value as ExecSecurity);
}

function isValidAsk(value: string): value is ExecAsk {
  return VALID_ASK.includes(value as ExecAsk);
}

function resolveAgentKey(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : "*";
}

function renderPolicy(
  defaults: ExecApprovalsDefaults,
  agentKey: string,
  agent: ExecApprovalsDefaults | undefined,
) {
  const rich = isRich();
  const heading = (text: string) => (rich ? theme.heading(text) : text);
  const muted = (text: string) => (rich ? theme.muted(text) : text);
  const highlight = (text: string) => (rich ? theme.accent(text) : text);
  const tableWidth = Math.max(60, (process.stdout.columns ?? 120) - 1);

  const security = defaults.security ?? "deny";
  const ask = defaults.ask ?? "on-miss";
  const askFallback = defaults.askFallback ?? "deny";
  const autoAllowSkills = defaults.autoAllowSkills === true ? "on" : "off";

  const defaultRows = [
    { Field: "security", Value: highlight(security), Description: muted("Default exec security level") },
    { Field: "ask", Value: highlight(ask), Description: muted("When to prompt for approval") },
    { Field: "askFallback", Value: highlight(askFallback), Description: muted("Fallback security when ask times out") },
    { Field: "autoAllowSkills", Value: highlight(autoAllowSkills), Description: muted("Auto-allow skill commands") },
  ];

  defaultRuntime.log(heading("Default Exec Policy"));
  defaultRuntime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Field", header: "Field", minWidth: 16 },
        { key: "Value", header: "Value", minWidth: 12 },
        { key: "Description", header: "Description", minWidth: 24, flex: true },
      ],
      rows: defaultRows,
    }).trimEnd(),
  );

  if (agent && agentKey !== "*") {
    const agentSecurity = agent.security ?? muted("(inherit)");
    const agentAsk = agent.ask ?? muted("(inherit)");
    const agentAskFallback = agent.askFallback ?? muted("(inherit)");
    const agentAutoAllowSkills =
      agent.autoAllowSkills === undefined ? muted("(inherit)") : agent.autoAllowSkills ? "on" : "off";

    const agentRows = [
      { Field: "security", Value: String(agentSecurity) },
      { Field: "ask", Value: String(agentAsk) },
      { Field: "askFallback", Value: String(agentAskFallback) },
      { Field: "autoAllowSkills", Value: String(agentAutoAllowSkills) },
    ];

    defaultRuntime.log("");
    defaultRuntime.log(heading(`Agent Override: ${agentKey}`));
    defaultRuntime.log(
      renderTable({
        width: tableWidth,
        columns: [
          { key: "Field", header: "Field", minWidth: 16 },
          { key: "Value", header: "Value", minWidth: 12, flex: true },
        ],
        rows: agentRows,
      }).trimEnd(),
    );
  }

  defaultRuntime.log("");
  defaultRuntime.log(muted(`Valid security: ${VALID_SECURITY.join(", ")}`));
  defaultRuntime.log(muted(`Valid ask: ${VALID_ASK.join(", ")}`));
}

export function registerExecPolicyCli(program: Command) {
  const policy = program
    .command("exec-policy")
    .description("View and manage exec security policy (security level, ask mode, fallback)");

  policy
    .command("show")
    .description("Show current exec policy")
    .option("--node <node>", "Target node id/name/IP")
    .option("--gateway", "Force gateway policy", false)
    .option("--agent <id>", 'Show agent-specific override (defaults to "*")')
    .option("--json", "Output as JSON")
    .action(async (opts: ExecPolicyCliOpts) => {
      try {
        const snapshot = readExecApprovalsSnapshot();
        const file = snapshot.file ?? { version: 1 };
        const defaults = file.defaults ?? {};
        const agentKey = resolveAgentKey(opts.agent);
        const agent = file.agents?.[agentKey];

        if (opts.json) {
          defaultRuntime.log(
            JSON.stringify({ defaults, agentKey, agent: agent ?? null }, null, 2),
          );
          return;
        }

        renderPolicy(defaults, agentKey, agent);
      } catch (err) {
        defaultRuntime.error(err instanceof Error ? err.message : String(err));
        defaultRuntime.exit(1);
      }
    });

  policy
    .command("set-security <level>")
    .description(`Set default exec security level (${VALID_SECURITY.join("|")})`)
    .option("--node <node>", "Target node id/name/IP")
    .option("--gateway", "Force gateway policy", false)
    .option("--agent <id>", 'Set for specific agent (defaults to "*" = global)')
    .action(async (level: string, opts: ExecPolicyCliOpts) => {
      try {
        if (!isValidSecurity(level)) {
          defaultRuntime.error(`Invalid security level: ${level}. Valid: ${VALID_SECURITY.join(", ")}`);
          defaultRuntime.exit(1);
          return;
        }

        const snapshot = readExecApprovalsSnapshot();
        const file = snapshot.file ?? { version: 1 };
        file.version = 1;
        const agentKey = resolveAgentKey(opts.agent);

        if (agentKey === "*") {
          file.defaults = { ...file.defaults, security: level };
        } else {
          const agents = { ...file.agents };
          const agent = agents[agentKey] ?? {};
          agents[agentKey] = { ...agent, security: level };
          file.agents = agents;
        }

        saveExecApprovals(file);
        defaultRuntime.log(`Exec security set to ${level} (agent=${agentKey})`);
      } catch (err) {
        defaultRuntime.error(err instanceof Error ? err.message : String(err));
        defaultRuntime.exit(1);
      }
    });

  policy
    .command("set-ask <mode>")
    .description(`Set ask mode (${VALID_ASK.join("|")})`)
    .option("--node <node>", "Target node id/name/IP")
    .option("--gateway", "Force gateway policy", false)
    .option("--agent <id>", 'Set for specific agent (defaults to "*" = global)')
    .action(async (mode: string, opts: ExecPolicyCliOpts) => {
      try {
        if (!isValidAsk(mode)) {
          defaultRuntime.error(`Invalid ask mode: ${mode}. Valid: ${VALID_ASK.join(", ")}`);
          defaultRuntime.exit(1);
          return;
        }

        const snapshot = readExecApprovalsSnapshot();
        const file = snapshot.file ?? { version: 1 };
        file.version = 1;
        const agentKey = resolveAgentKey(opts.agent);

        if (agentKey === "*") {
          file.defaults = { ...file.defaults, ask: mode };
        } else {
          const agents = { ...file.agents };
          const agent = agents[agentKey] ?? {};
          agents[agentKey] = { ...agent, ask: mode };
          file.agents = agents;
        }

        saveExecApprovals(file);
        defaultRuntime.log(`Ask mode set to ${mode} (agent=${agentKey})`);
      } catch (err) {
        defaultRuntime.error(err instanceof Error ? err.message : String(err));
        defaultRuntime.exit(1);
      }
    });

  policy
    .command("set-fallback <level>")
    .description(`Set fallback security when ask times out (${VALID_SECURITY.join("|")})`)
    .option("--node <node>", "Target node id/name/IP")
    .option("--gateway", "Force gateway policy", false)
    .option("--agent <id>", 'Set for specific agent (defaults to "*" = global)')
    .action(async (level: string, opts: ExecPolicyCliOpts) => {
      try {
        if (!isValidSecurity(level)) {
          defaultRuntime.error(`Invalid fallback level: ${level}. Valid: ${VALID_SECURITY.join(", ")}`);
          defaultRuntime.exit(1);
          return;
        }

        const snapshot = readExecApprovalsSnapshot();
        const file = snapshot.file ?? { version: 1 };
        file.version = 1;
        const agentKey = resolveAgentKey(opts.agent);

        if (agentKey === "*") {
          file.defaults = { ...file.defaults, askFallback: level };
        } else {
          const agents = { ...file.agents };
          const agent = agents[agentKey] ?? {};
          agents[agentKey] = { ...agent, askFallback: level };
          file.agents = agents;
        }

        saveExecApprovals(file);
        defaultRuntime.log(`Ask fallback set to ${level} (agent=${agentKey})`);
      } catch (err) {
        defaultRuntime.error(err instanceof Error ? err.message : String(err));
        defaultRuntime.exit(1);
      }
    });

  policy
    .command("set-auto-allow-skills <on|off>")
    .description("Enable or disable auto-allowing skill commands")
    .option("--node <node>", "Target node id/name/IP")
    .option("--gateway", "Force gateway policy", false)
    .option("--agent <id>", 'Set for specific agent (defaults to "*" = global)')
    .action(async (value: string, opts: ExecPolicyCliOpts) => {
      try {
        const enabled = value === "on";
        if (value !== "on" && value !== "off") {
          defaultRuntime.error('Value must be "on" or "off"');
          defaultRuntime.exit(1);
          return;
        }

        const snapshot = readExecApprovalsSnapshot();
        const file = snapshot.file ?? { version: 1 };
        file.version = 1;
        const agentKey = resolveAgentKey(opts.agent);

        if (agentKey === "*") {
          file.defaults = { ...file.defaults, autoAllowSkills: enabled };
        } else {
          const agents = { ...file.agents };
          const agent = agents[agentKey] ?? {};
          agents[agentKey] = { ...agent, autoAllowSkills: enabled };
          file.agents = agents;
        }

        saveExecApprovals(file);
        defaultRuntime.log(`Auto-allow skills set to ${value} (agent=${agentKey})`);
      } catch (err) {
        defaultRuntime.error(err instanceof Error ? err.message : String(err));
        defaultRuntime.exit(1);
      }
    });

  const setCmd = policy
    .command("set")
    .description("Set multiple policy fields at once via JSON")
    .option("--agent <id>", 'Set for specific agent (defaults to "*" = global)')
    .option("--security <level>", `Security level (${VALID_SECURITY.join("|")})`)
    .option("--ask <mode>", `Ask mode (${VALID_ASK.join("|")})`)
    .option("--fallback <level>", `Fallback security (${VALID_SECURITY.join("|")})`)
    .option("--auto-allow-skills <on|off>", "Auto-allow skills (on|off)")
    .action(async (opts: ExecPolicyCliOpts & { security?: string; ask?: string; fallback?: string; autoAllowSkills?: string }) => {
      try {
        const snapshot = readExecApprovalsSnapshot();
        const file = snapshot.file ?? { version: 1 };
        file.version = 1;
        const agentKey = resolveAgentKey(opts.agent);

        const updates: Partial<ExecApprovalsDefaults> = {};
        if (opts.security) {
          if (!isValidSecurity(opts.security)) {
            defaultRuntime.error(`Invalid security: ${opts.security}`);
            defaultRuntime.exit(1);
            return;
          }
          updates.security = opts.security;
        }
        if (opts.ask) {
          if (!isValidAsk(opts.ask)) {
            defaultRuntime.error(`Invalid ask: ${opts.ask}`);
            defaultRuntime.exit(1);
            return;
          }
          updates.ask = opts.ask;
        }
        if (opts.fallback) {
          if (!isValidSecurity(opts.fallback)) {
            defaultRuntime.error(`Invalid fallback: ${opts.fallback}`);
            defaultRuntime.exit(1);
            return;
          }
          updates.askFallback = opts.fallback;
        }
        if (opts.autoAllowSkills) {
          if (opts.autoAllowSkills !== "on" && opts.autoAllowSkills !== "off") {
            defaultRuntime.error('auto-allow-skills must be "on" or "off"');
            defaultRuntime.exit(1);
            return;
          }
          updates.autoAllowSkills = opts.autoAllowSkills === "on";
        }

        if (Object.keys(updates).length === 0) {
          defaultRuntime.error("No policy fields specified. Use --security, --ask, --fallback, or --auto-allow-skills.");
          defaultRuntime.exit(1);
          return;
        }

        if (agentKey === "*") {
          file.defaults = { ...file.defaults, ...updates };
        } else {
          const agents = { ...file.agents };
          const agent = agents[agentKey] ?? {};
          agents[agentKey] = { ...agent, ...updates };
          file.agents = agents;
        }

        saveExecApprovals(file);
        const fields = Object.keys(updates).join(", ");
        defaultRuntime.log(`Updated policy fields: ${fields} (agent=${agentKey})`);
      } catch (err) {
        defaultRuntime.error(err instanceof Error ? err.message : String(err));
        defaultRuntime.exit(1);
      }
    });
  nodesCallOpts(setCmd);
}
