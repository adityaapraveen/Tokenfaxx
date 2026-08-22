import { spawnSync } from "node:child_process";
export * from "./telemetry.js";

export interface AdapterCapabilities {
  supportsExactTokenUsage: boolean;
  supportsModelIdentification: boolean;
  supportsToolEvents: boolean;
  supportsLifecycleHooks: boolean;
  supportsCostReporting: boolean;
  supportsInteractiveMode: boolean;
}
export interface LaunchSpec {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  structuredTelemetry?: "codex" | "claude";
}
export interface AgentAdapter {
  name: string;
  version: string;
  capabilities: AdapterCapabilities;
  detect(): boolean;
  launch(options: { command?: string; passthroughArgs: string[] }): LaunchSpec;
}
const interactiveOnly: AdapterCapabilities = {
  supportsExactTokenUsage: false,
  supportsModelIdentification: false,
  supportsToolEvents: false,
  supportsLifecycleHooks: false,
  supportsCostReporting: false,
  supportsInteractiveMode: true,
};
const exists = (command: string): boolean =>
  spawnSync(command, ["--version"], { stdio: "ignore", shell: false })
    .status === 0;
export class ShellAdapter implements AgentAdapter {
  name = "custom";
  version = "1.0.0";
  capabilities = interactiveOnly;
  detect(): boolean {
    return true;
  }
  launch(options: { command?: string; passthroughArgs: string[] }): LaunchSpec {
    if (!options.command)
      throw new Error("The custom adapter requires --command");
    return { command: options.command, args: [] };
  }
}
export class CodexAdapter implements AgentAdapter {
  name = "codex";
  version = "1.0.0";
  capabilities = interactiveOnly;
  detect(): boolean {
    return exists("codex");
  }
  launch(options: { passthroughArgs: string[] }): LaunchSpec {
    return { command: "codex", args: options.passthroughArgs };
  }
}
export class ClaudeAdapter implements AgentAdapter {
  name = "claude";
  version = "1.0.0";
  capabilities = interactiveOnly;
  detect(): boolean {
    return exists("claude");
  }
  launch(options: { passthroughArgs: string[] }): LaunchSpec {
    return { command: "claude", args: options.passthroughArgs };
  }
}
const structuredCapabilities: AdapterCapabilities = {
  supportsExactTokenUsage: false,
  supportsModelIdentification: true,
  supportsToolEvents: false,
  supportsLifecycleHooks: true,
  supportsCostReporting: true,
  supportsInteractiveMode: false,
};
export class CodexJsonAdapter implements AgentAdapter {
  name = "codex-json";
  version = "1.0.0";
  capabilities = structuredCapabilities;
  detect(): boolean {
    return exists("codex");
  }
  launch(options: { passthroughArgs: string[] }): LaunchSpec {
    return {
      command: "codex",
      args: ["exec", "--json", ...options.passthroughArgs],
      structuredTelemetry: "codex",
    };
  }
}
export class ClaudeJsonAdapter implements AgentAdapter {
  name = "claude-json";
  version = "1.0.0";
  capabilities = structuredCapabilities;
  detect(): boolean {
    return exists("claude");
  }
  launch(options: { passthroughArgs: string[] }): LaunchSpec {
    return {
      command: "claude",
      args: ["-p", "--verbose", "--output-format", "stream-json", ...options.passthroughArgs],
      structuredTelemetry: "claude",
    };
  }
}
export class SdkAdapter implements AgentAdapter {
  name = "sdk";
  version = "1.0.0";
  capabilities = {
    supportsExactTokenUsage: true,
    supportsModelIdentification: true,
    supportsToolEvents: true,
    supportsLifecycleHooks: true,
    supportsCostReporting: true,
    supportsInteractiveMode: false,
  };
  detect(): boolean {
    return true;
  }
  launch(): LaunchSpec {
    throw new Error(
      "SDK sessions are started in-process and cannot be launched by the CLI",
    );
  }
}
export const adapters: AgentAdapter[] = [
  new CodexAdapter(),
  new CodexJsonAdapter(),
  new ClaudeAdapter(),
  new ClaudeJsonAdapter(),
  new ShellAdapter(),
  new SdkAdapter(),
];
export function registerAdapter(adapter: AgentAdapter): void {
  if (adapters.some((item) => item.name === adapter.name))
    throw new Error(`Adapter '${adapter.name}' is already registered`);
  adapters.push(adapter);
}
export function findAdapter(name: string): AgentAdapter {
  const adapter = adapters.find((item) => item.name === name);
  if (!adapter)
    throw new Error(
      `Unknown adapter '${name}'. Available: ${adapters.map((a) => a.name).join(", ")}`,
    );
  return adapter;
}
