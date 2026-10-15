import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLIENTS,
  DEFAULT_SERVER_NAME,
  applyPlan,
  buildPlan,
  findClient,
  jsonSnippet,
  parseInstallArgs,
  renderSnippet,
  type Launch,
} from "../src/mcp/install";

const launch: Launch = { command: "npx", args: ["-y", "code-explain", "mcp"] };

let cwd: string;
let prevDshHome: string | undefined;
let prevPiDir: string | undefined;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "ce-install-"));
  prevDshHome = process.env.DSH_HOME;
  prevPiDir = process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
  if (prevDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = prevDshHome;
  if (prevPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevPiDir;
  rmSync(cwd, { recursive: true, force: true });
});

describe("findClient", () => {
  it("is case-insensitive", () => {
    expect(findClient("CURSOR")?.id).toBe("cursor");
  });

  it("returns undefined for unknown clients", () => {
    expect(findClient("nope")).toBeUndefined();
  });

  it("exposes a unique id per client", () => {
    const ids = CLIENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseInstallArgs", () => {
  it("defaults to print mode", () => {
    const args = parseInstallArgs(["--client", "cursor"]);
    expect(args.client).toBe("cursor");
    expect(args.write).toBe(false);
    expect(args.force).toBe(false);
  });

  it("parses write/force/scope/server-name", () => {
    const args = parseInstallArgs([
      "--client",
      "codex",
      "--scope",
      "project",
      "--server-name",
      "ce",
      "--write",
      "--force",
    ]);
    expect(args).toMatchObject({
      client: "codex",
      scope: "project",
      serverName: "ce",
      write: true,
      force: true,
    });
  });

  it("rejects a bad scope", () => {
    expect(() => parseInstallArgs(["--scope", "galaxy"])).toThrow();
  });

  it("rejects a missing option value", () => {
    expect(() => parseInstallArgs(["--client"])).toThrow();
  });

  it("rejects unknown options", () => {
    expect(() => parseInstallArgs(["--frobnicate"])).toThrow();
  });
});

describe("buildPlan", () => {
  it("resolves a project path under cwd", () => {
    const plan = buildPlan({
      client: "cursor",
      launch,
      write: false,
      force: false,
      cwd,
    });
    expect(plan.scope).toBe("project");
    expect(plan.path).toBe(join(cwd, ".cursor", "mcp.json"));
    expect(plan.serverName).toBe(DEFAULT_SERVER_NAME);
  });

  it("honors an explicit server name", () => {
    const plan = buildPlan({
      client: "cursor",
      serverName: "ce",
      launch,
      write: false,
      force: false,
      cwd,
    });
    expect(plan.serverName).toBe("ce");
  });

  it("throws when a client has no project scope", () => {
    expect(() =>
      buildPlan({ client: "cline", scope: "project", launch, write: false, force: false, cwd })
    ).toThrow(/project/i);
  });

  it("throws for an unknown client", () => {
    expect(() =>
      buildPlan({ client: "nope", launch, write: false, force: false, cwd })
    ).toThrow(/unknown client/i);
  });

  it("resolves the hermes user config path", () => {
    const plan = buildPlan({ client: "hermes", launch, write: false, force: false, cwd });
    expect(plan.scope).toBe("user");
    expect(plan.path.endsWith(join(".hermes", "config.yaml"))).toBe(true);
  });

  it("honors DSH_HOME for the deepseek harness config path", () => {
    process.env.DSH_HOME = join(cwd, "dsh-home");
    const plan = buildPlan({ client: "deepseek-harness", launch, write: false, force: false, cwd });
    expect(plan.scope).toBe("user");
    expect(plan.path).toBe(join(cwd, "dsh-home", "cordis.patch.yml"));
  });

  it("falls back to ~/.dsh when DSH_HOME is empty", () => {
    process.env.DSH_HOME = "   ";
    const plan = buildPlan({ client: "deepseek-harness", launch, write: false, force: false, cwd });
    expect(plan.path.endsWith(join(".dsh", "cordis.patch.yml"))).toBe(true);
  });

  it("resolves the pi user config path under the agent directory", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    const plan = buildPlan({ client: "pi", launch, write: false, force: false, cwd });
    expect(plan.scope).toBe("user");
    expect(plan.path.endsWith(join(".pi", "agent", "mcp.json"))).toBe(true);
  });

  it("honors PI_CODING_AGENT_DIR for the pi config path", () => {
    process.env.PI_CODING_AGENT_DIR = join(cwd, "pi-agent");
    const plan = buildPlan({ client: "pi", launch, write: false, force: false, cwd });
    expect(plan.path).toBe(join(cwd, "pi-agent", "mcp.json"));
  });

  it("falls back to ~/.pi/agent when PI_CODING_AGENT_DIR is empty", () => {
    process.env.PI_CODING_AGENT_DIR = "   ";
    const plan = buildPlan({ client: "pi", launch, write: false, force: false, cwd });
    expect(plan.path.endsWith(join(".pi", "agent", "mcp.json"))).toBe(true);
  });

  it("resolves the pi project config path under cwd", () => {
    const plan = buildPlan({ client: "pi", scope: "project", launch, write: false, force: false, cwd });
    expect(plan.scope).toBe("project");
    expect(plan.path).toBe(join(cwd, ".pi", "mcp.json"));
  });

  it("resolves the grok user config path", () => {
    const plan = buildPlan({ client: "grok", launch, write: false, force: false, cwd });
    expect(plan.scope).toBe("user");
    expect(plan.path.endsWith(join(".grok", "config.toml"))).toBe(true);
  });
});

describe("rendering", () => {
  it("renders a plain mcpServers entry for cursor", () => {
    const parsed = JSON.parse(jsonSnippet(findClient("cursor")!, "code-explain", launch));
    expect(parsed.mcpServers["code-explain"]).toEqual({
      command: "npx",
      args: ["-y", "code-explain", "mcp"],
    });
  });

  it("renders the vscode stdio entry shape", () => {
    const parsed = JSON.parse(jsonSnippet(findClient("vscode")!, "code-explain", launch));
    expect(parsed.servers["code-explain"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "code-explain", "mcp"],
    });
  });

  it("renders the opencode local entry with a command array", () => {
    const parsed = JSON.parse(jsonSnippet(findClient("opencode")!, "code-explain", launch));
    expect(parsed.mcp["code-explain"]).toEqual({
      type: "local",
      command: ["npx", "-y", "code-explain", "mcp"],
      enabled: true,
    });
  });

  it("renders the zed custom entry", () => {
    const parsed = JSON.parse(jsonSnippet(findClient("zed")!, "code-explain", launch));
    expect(parsed.context_servers["code-explain"]).toEqual({
      source: "custom",
      command: "npx",
      args: ["-y", "code-explain", "mcp"],
      env: {},
    });
  });

  it("renders a codex TOML table", () => {
    const snippet = renderSnippet(findClient("codex")!, "code-explain", launch);
    expect(snippet).toContain("[mcp_servers.code-explain]");
    expect(snippet).toContain('command = "npx"');
    expect(snippet).toContain('args = ["-y", "code-explain", "mcp"]');
  });

  it("renders a grok TOML table", () => {
    const snippet = renderSnippet(findClient("grok")!, "code-explain", launch);
    expect(snippet).toContain("[mcp_servers.code-explain]");
    expect(snippet).toContain('command = "npx"');
    expect(snippet).toContain('args = ["-y", "code-explain", "mcp"]');
  });

  it("renders a continue YAML list", () => {
    const snippet = renderSnippet(findClient("continue")!, "code-explain", launch);
    expect(snippet).toContain("mcpServers:");
    expect(snippet).toContain("- name: code-explain");
    expect(snippet).toContain("command: npx");
  });

  it("renders a plain mcpServers entry for pi", () => {
    const parsed = JSON.parse(jsonSnippet(findClient("pi")!, "code-explain", launch));
    expect(parsed.mcpServers["code-explain"]).toEqual({
      command: "npx",
      args: ["-y", "code-explain", "mcp"],
    });
  });

  it("renders a hermes YAML map", () => {
    const snippet = renderSnippet(findClient("hermes")!, "code-explain", launch);
    expect(snippet).toContain("mcp_servers:");
    expect(snippet).toContain("  code-explain:");
    expect(snippet).toContain("    command: npx");
    expect(snippet).toContain('      - "-y"');
  });

  it("renders the deepseek harness cordis plugin entry", () => {
    const snippet = renderSnippet(findClient("deepseek-harness")!, "code-explain", launch);
    expect(snippet).toContain("- id: code-explain");
    expect(snippet).toContain("name: '@deepseek-ai/dsh-mcp-client'");
    expect(snippet).toContain("transport: stdio");
    expect(snippet).toContain("command: npx");
    expect(snippet).toContain('        - "-y"');
  });
});

describe("applyPlan", () => {
  it("creates a fresh JSON config", () => {
    const plan = buildPlan({ client: "cursor", launch, write: true, force: false, cwd });
    const result = applyPlan(plan, false);
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(plan.path, "utf8"));
    expect(parsed.mcpServers["code-explain"].command).toBe("npx");
  });

  it("merges into an existing JSON config without dropping keys", () => {
    const plan = buildPlan({ client: "cursor", launch, write: true, force: false, cwd });
    mkdirSync(join(cwd, ".cursor"), { recursive: true });
    writeFileSync(plan.path, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    applyPlan(plan, false);
    const parsed = JSON.parse(readFileSync(plan.path, "utf8"));
    expect(parsed.mcpServers.other.command).toBe("x");
    expect(parsed.mcpServers["code-explain"].command).toBe("npx");
  });

  it("refuses to replace an existing entry without force", () => {
    const plan = buildPlan({ client: "cursor", launch, write: true, force: false, cwd });
    applyPlan(plan, false);
    const again = applyPlan(plan, false);
    expect(again.changed).toBe(false);
    expect(again.message).toMatch(/already configured/i);
  });

  it("replaces an existing entry with force", () => {
    const plan = buildPlan({ client: "cursor", launch, write: true, force: false, cwd });
    applyPlan(plan, false);
    const forced = { ...plan, launch: { command: "node", args: ["/abs/mcp.cjs"] } };
    const result = applyPlan(
      { ...forced, snippet: renderSnippet(plan.client, plan.serverName, forced.launch) },
      true
    );
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(readFileSync(plan.path, "utf8"));
    expect(parsed.mcpServers["code-explain"].command).toBe("node");
  });

  it("refuses to clobber unparseable JSON", () => {
    const plan = buildPlan({ client: "cursor", launch, write: true, force: false, cwd });
    mkdirSync(join(cwd, ".cursor"), { recursive: true });
    writeFileSync(plan.path, "{ not json");
    expect(() => applyPlan(plan, false)).toThrow();
    expect(readFileSync(plan.path, "utf8")).toBe("{ not json");
  });

  it("appends a codex TOML table", () => {
    const plan = buildPlan({ client: "codex", scope: "project", launch, write: true, force: false, cwd });
    const result = applyPlan(plan, false);
    expect(result.changed).toBe(true);
    const text = readFileSync(plan.path, "utf8");
    expect(text).toContain("[mcp_servers.code-explain]");
  });

  it("is idempotent for codex TOML without force", () => {
    const plan = buildPlan({ client: "codex", scope: "project", launch, write: true, force: false, cwd });
    applyPlan(plan, false);
    const again = applyPlan(plan, false);
    expect(again.changed).toBe(false);
    expect(again.message).toMatch(/already configured/i);
  });

  it("never auto-writes YAML", () => {
    const plan = buildPlan({ client: "continue", launch, write: true, force: false, cwd });
    const result = applyPlan(plan, true);
    expect(result.changed).toBe(false);
    expect(result.message).toMatch(/paste/i);
  });
});
