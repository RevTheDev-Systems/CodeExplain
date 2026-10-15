import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

/** Default key/name used for this server in every client's config. */
export const DEFAULT_SERVER_NAME = "code-explain";

/** Published npm package name used for the default npx launch. */
export const PACKAGE_NAME = "code-explain";

export interface Launch {
  command: string;
  args: string[];
}

export type ConfigFormat = "json" | "toml" | "yaml";

export interface McpClient {
  id: string;
  name: string;
  format: ConfigFormat;
  /** Top-level container key that holds server entries. */
  key: string;
  /** Absolute user-scope config path, resolved at call time. */
  userFile?: () => string;
  /** Project-scope config path, relative to the working directory. */
  projectFile?: string;
  /** Default scope when `--scope` is not given. */
  defaultScope: "user" | "project";
  /** The per-server object written into a JSON container. */
  entry: (launch: Launch) => Record<string, unknown>;
  /** Client-specific snippet renderer, preferred over the format default. */
  snippet?: (serverName: string, launch: Launch) => string;
}

function home(...segments: string[]): string {
  return join(homedir(), ...segments);
}

function xdgConfig(...segments: string[]): string {
  const base = process.env.XDG_CONFIG_HOME || home(".config");
  return join(base, ...segments);
}

function dshHome(): string {
  const env = process.env.DSH_HOME;
  if (env && env.trim() !== "") return env;
  return home(".dsh");
}

function piAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env && env.trim() !== "") return env;
  return home(".pi", "agent");
}

function plainEntry(launch: Launch): Record<string, unknown> {
  return { command: launch.command, args: launch.args };
}

export const CLIENTS: McpClient[] = [
  {
    id: "claude",
    name: "Claude Code",
    format: "json",
    key: "mcpServers",
    userFile: () => home(".claude.json"),
    projectFile: ".mcp.json",
    defaultScope: "project",
    entry: plainEntry,
  },
  {
    id: "cursor",
    name: "Cursor",
    format: "json",
    key: "mcpServers",
    userFile: () => home(".cursor", "mcp.json"),
    projectFile: ".cursor/mcp.json",
    defaultScope: "project",
    entry: plainEntry,
  },
  {
    id: "cline",
    name: "Cline",
    format: "json",
    key: "mcpServers",
    userFile: () => home(".cline", "data", "settings", "cline_mcp_settings.json"),
    defaultScope: "user",
    entry: plainEntry,
  },
  {
    id: "windsurf",
    name: "Windsurf",
    format: "json",
    key: "mcpServers",
    userFile: () => home(".codeium", "windsurf", "mcp_config.json"),
    defaultScope: "user",
    entry: plainEntry,
  },
  {
    id: "vscode",
    name: "VS Code (Copilot)",
    format: "json",
    key: "servers",
    projectFile: ".vscode/mcp.json",
    defaultScope: "project",
    entry: (launch) => ({ type: "stdio", command: launch.command, args: launch.args }),
  },
  {
    id: "opencode",
    name: "OpenCode",
    format: "json",
    key: "mcp",
    userFile: () => xdgConfig("opencode", "opencode.json"),
    projectFile: "opencode.json",
    defaultScope: "project",
    entry: (launch) => ({
      type: "local",
      command: [launch.command, ...launch.args],
      enabled: true,
    }),
  },
  {
    id: "zed",
    name: "Zed",
    format: "json",
    key: "context_servers",
    userFile: () =>
      process.platform === "darwin"
        ? home("Library", "Application Support", "Zed", "settings.json")
        : xdgConfig("zed", "settings.json"),
    defaultScope: "user",
    entry: (launch) => ({ source: "custom", command: launch.command, args: launch.args, env: {} }),
  },
  {
    id: "codex",
    name: "Codex",
    format: "toml",
    key: "mcp_servers",
    userFile: () => home(".codex", "config.toml"),
    projectFile: ".codex/config.toml",
    defaultScope: "user",
    entry: plainEntry,
  },
  {
    id: "continue",
    name: "Continue",
    format: "yaml",
    key: "mcpServers",
    userFile: () => home(".continue", "config.yaml"),
    defaultScope: "user",
    entry: plainEntry,
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    format: "yaml",
    key: "mcp_servers",
    userFile: () => home(".hermes", "config.yaml"),
    defaultScope: "user",
    entry: plainEntry,
    snippet: (serverName, launch) => yamlMapSnippet("mcp_servers", serverName, launch),
  },
  {
    id: "deepseek-harness",
    name: "DeepSeek Harness",
    format: "yaml",
    key: "cordis.patch.yml",
    userFile: () => join(dshHome(), "cordis.patch.yml"),
    defaultScope: "user",
    entry: plainEntry,
    snippet: dshYamlSnippet,
  },
  {
    id: "pi",
    name: "Pi",
    format: "json",
    key: "mcpServers",
    userFile: () => join(piAgentDir(), "mcp.json"),
    projectFile: ".pi/mcp.json",
    defaultScope: "user",
    entry: plainEntry,
  },
];

export function findClient(id: string): McpClient | undefined {
  return CLIENTS.find((c) => c.id === id.toLowerCase());
}

// --- rendering ---

export function jsonSnippet(client: McpClient, serverName: string, launch: Launch): string {
  return JSON.stringify({ [client.key]: { [serverName]: client.entry(launch) } }, null, 2);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function tomlSnippet(client: McpClient, serverName: string, launch: Launch): string {
  const args = launch.args.map(tomlString).join(", ");
  return [
    `# Added by code-explain mcp install`,
    `[${client.key}.${serverName}]`,
    `command = ${tomlString(launch.command)}`,
    `args = [${args}]`,
  ].join("\n");
}

export function yamlSnippet(serverName: string, launch: Launch): string {
  const args = launch.args.map((a) => `      - ${JSON.stringify(a)}`).join("\n");
  return [
    `mcpServers:`,
    `  - name: ${serverName}`,
    `    command: ${launch.command}`,
    `    args:`,
    args,
  ].join("\n");
}

export function yamlMapSnippet(key: string, serverName: string, launch: Launch): string {
  const args = launch.args.map((a) => `      - ${JSON.stringify(a)}`).join("\n");
  return [
    `${key}:`,
    `  ${serverName}:`,
    `    command: ${launch.command}`,
    `    args:`,
    args,
  ].join("\n");
}

export function dshYamlSnippet(serverName: string, launch: Launch): string {
  const args = launch.args.map((a) => `        - ${JSON.stringify(a)}`).join("\n");
  return [
    `# Append to the cordis patch layer (a YAML list).`,
    `- id: ${serverName}`,
    `  name: '@deepseek-ai/dsh-mcp-client'`,
    `  config:`,
    `    serverName: ${serverName}`,
    `    transport: stdio`,
    `    command: ${launch.command}`,
    `    args:`,
    args,
  ].join("\n");
}

export function renderSnippet(client: McpClient, serverName: string, launch: Launch): string {
  if (client.snippet) return client.snippet(serverName, launch);
  if (client.format === "toml") return tomlSnippet(client, serverName, launch);
  if (client.format === "yaml") return yamlSnippet(serverName, launch);
  return jsonSnippet(client, serverName, launch);
}

// --- target resolution ---

export interface InstallOptions {
  client: string;
  scope?: "user" | "project";
  serverName?: string;
  launch: Launch;
  write: boolean;
  force: boolean;
  cwd: string;
}

export interface InstallPlan {
  client: McpClient;
  serverName: string;
  scope: "user" | "project";
  path: string;
  launch: Launch;
  snippet: string;
}

export function buildPlan(opts: InstallOptions): InstallPlan {
  const client = findClient(opts.client);
  if (!client) throw new Error(`Unknown client: ${opts.client}`);
  const scope = opts.scope ?? client.defaultScope;
  const serverName = opts.serverName ?? DEFAULT_SERVER_NAME;

  let path: string;
  if (scope === "project") {
    if (!client.projectFile) {
      throw new Error(`Client "${client.id}" has no project-scope config; use --scope user.`);
    }
    path = resolve(opts.cwd, client.projectFile);
  } else {
    if (!client.userFile) {
      throw new Error(`Client "${client.id}" has no user-scope config.`);
    }
    path = client.userFile();
  }

  return {
    client,
    serverName,
    scope,
    path,
    launch: opts.launch,
    snippet: renderSnippet(client, serverName, opts.launch),
  };
}

// --- writing ---

export interface WriteResult {
  changed: boolean;
  path: string;
  message: string;
}

function entryExists(text: string, plan: InstallPlan): boolean {
  if (plan.client.format === "json") {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const container = obj[plan.client.key];
      return (
        !!container &&
        typeof container === "object" &&
        Object.prototype.hasOwnProperty.call(container, plan.serverName)
      );
    } catch {
      return false;
    }
  }
  if (plan.client.format === "toml") {
    return text.includes(`[${plan.client.key}.${plan.serverName}]`);
  }
  return text.includes(`name: ${plan.serverName}`);
}

function mergeJson(text: string, plan: InstallPlan): string {
  let obj: Record<string, unknown>;
  if (text.trim() === "") {
    obj = {};
  } else {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${plan.path} does not contain a JSON object.`);
    }
    obj = parsed as Record<string, unknown>;
  }
  const existing = obj[plan.client.key];
  const container: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  container[plan.serverName] = plan.client.entry(plan.launch);
  obj[plan.client.key] = container;
  return `${JSON.stringify(obj, null, 2)}\n`;
}

export function applyPlan(plan: InstallPlan, force: boolean): WriteResult {
  const { path, client } = plan;
  const exists = existsSync(path);

  if (client.format === "yaml") {
    return {
      changed: false,
      path,
      message: `YAML config cannot be safely auto-merged. Paste the snippet below into ${path}.`,
    };
  }

  const text = exists ? readFileSync(path, "utf8") : "";

  if (exists && entryExists(text, plan) && !force) {
    return {
      changed: false,
      path,
      message: `"${plan.serverName}" is already configured in ${path}. Re-run with --force to replace it.`,
    };
  }

  if (client.format === "toml") {
    const prefix = text.trim() === "" ? "" : `${text.replace(/\s*$/, "")}\n\n`;
    const next = `${prefix}${tomlSnippet(client, plan.serverName, plan.launch)}\n`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next, "utf8");
    return { changed: true, path, message: `Wrote ${path}.` };
  }

  const next = mergeJson(text, plan);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, "utf8");
  return { changed: true, path, message: `Wrote ${path}.` };
}

// --- CLI ---

interface ParsedInstallArgs {
  client?: string;
  scope?: "user" | "project";
  serverName?: string;
  local?: string;
  home?: string;
  write: boolean;
  force: boolean;
  list: boolean;
  help: boolean;
}

export function parseInstallArgs(argv: string[]): ParsedInstallArgs {
  const out: ParsedInstallArgs = { write: false, force: false, list: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--client":
        out.client = next();
        break;
      case "--scope": {
        const value = next();
        if (value !== "user" && value !== "project") {
          throw new Error(`--scope must be "user" or "project"`);
        }
        out.scope = value;
        break;
      }
      case "--server-name":
        out.serverName = next();
        break;
      case "--local":
        out.local = next();
        break;
      case "--home":
        out.home = next();
        break;
      case "--write":
        out.write = true;
        break;
      case "--force":
        out.force = true;
        break;
      case "--list":
        out.list = true;
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return out;
}

function printUsage(): void {
  console.error("Usage: code-explain mcp install --client <id> [options]");
  console.error("");
  console.error("Options:");
  console.error("  --client <id>       Target agent (see --list).");
  console.error("  --scope <s>         user or project (default: client's own).");
  console.error("  --server-name <n>   Name to register (default: code-explain).");
  console.error("  --local <path>      Launch via `node <path>` instead of npx.");
  console.error("  --write             Modify the config file (default: print only).");
  console.error("  --force             Replace an existing entry when writing.");
  console.error("  --list              List supported clients.");
  console.error("");
  console.error("By default the correct snippet and target path are printed without");
  console.error("touching any file. Add --write to merge it in.");
}

export async function runInstall(argv: string[]): Promise<number> {
  let args: ParsedInstallArgs;
  try {
    args = parseInstallArgs(argv);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    printUsage();
    return 1;
  }

  if (args.help) {
    printUsage();
    return 0;
  }

  if (args.home) {
    process.env.HOME = args.home;
  }

  if (args.list || !args.client) {
    console.log("Supported MCP clients:");
    const width = Math.max(...CLIENTS.map((c) => c.id.length)) + 1;
    for (const c of CLIENTS) {
      const scopes = c.projectFile ? "user/project" : "user";
      console.log(`  ${c.id.padEnd(width)} ${c.name} (${c.format}, ${scopes})`);
    }
    if (!args.client) {
      console.error("\nPick one with --client <id>.");
      return 1;
    }
    return 0;
  }

  const launch: Launch = args.local
    ? { command: "node", args: [resolve(args.local)] }
    : { command: "npx", args: ["-y", PACKAGE_NAME, "mcp"] };

  let plan: InstallPlan;
  try {
    plan = buildPlan({
      client: args.client,
      scope: args.scope,
      serverName: args.serverName,
      launch,
      write: args.write,
      force: args.force,
      cwd: process.cwd(),
    });
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  console.log(`${plan.client.name} (${plan.client.format}) — ${plan.scope} scope`);
  console.log(`Target: ${plan.path}`);
  console.log("");

  if (!args.write) {
    console.log("Add this to the target file (or re-run with --write):");
    console.log("");
    console.log(plan.snippet);
    if (plan.client.format === "json" && existsSync(plan.path)) {
      console.log("");
      console.log(`(Merge the "${plan.client.key}" object into the existing file.)`);
    }
    return 0;
  }

  try {
    const result = applyPlan(plan, args.force);
    console.log(result.message);
    if (!result.changed && plan.client.format === "yaml") {
      console.log("");
      console.log(plan.snippet);
    }
    return result.changed || plan.client.format === "yaml" ? 0 : 1;
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
