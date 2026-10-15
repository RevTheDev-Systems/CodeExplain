import { readFileSync } from "node:fs";
import type { ProviderConfig, ProviderMode } from "../llm/provider.js";

export interface ExplainConfig {
  provider: ProviderConfig;
  debounceMs: number;
  /** cap on concurrent LLM calls */
  maxConcurrent: number;
  /** include risk warnings in the sidebar */
  showRisks: boolean;
}

export const CONFIG_DEFAULTS = {
  mode: "auto" as ProviderMode,
  debounceMs: 1500,
  maxConcurrent: 2,
  showRisks: true,
} as const;

/**
 * A flat, all-optional view of the settings. Populated from any source
 * (VS Code settings, environment variables, a config file) and normalized
 * by `buildConfig`.
 */
export interface RawSettings {
  mode?: string | undefined;
  localModel?: string | undefined;
  localBaseUrl?: string | undefined;
  cloudApiKey?: string | undefined;
  cloudBaseUrl?: string | undefined;
  cloudModel?: string | undefined;
  debounceMs?: number | undefined;
  maxConcurrent?: number | undefined;
  showRisks?: boolean | undefined;
}

const MODES: readonly ProviderMode[] = ["auto", "local", "cloud"];

function toMode(value: string | undefined): ProviderMode {
  return value && (MODES as readonly string[]).includes(value)
    ? (value as ProviderMode)
    : CONFIG_DEFAULTS.mode;
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off"].includes(v)) return false;
  }
  return undefined;
}

/**
 * Apply defaults to a flat raw settings object. Pure: no environment or file
 * access, so the extension's VS Code settings path is byte-for-byte unchanged.
 */
export function buildConfig(raw: RawSettings = {}): ExplainConfig {
  return {
    provider: {
      mode: toMode(raw.mode),
      // `??` (not `||`) so an intentional empty string is preserved as "".
      localModel: raw.localModel ?? undefined,
      localBaseUrl: raw.localBaseUrl ?? undefined,
      cloudApiKey: raw.cloudApiKey ?? undefined,
      cloudBaseUrl: raw.cloudBaseUrl ?? undefined,
      cloudModel: raw.cloudModel ?? undefined,
    },
    debounceMs: raw.debounceMs ?? CONFIG_DEFAULTS.debounceMs,
    maxConcurrent: raw.maxConcurrent ?? CONFIG_DEFAULTS.maxConcurrent,
    showRisks: raw.showRisks ?? CONFIG_DEFAULTS.showRisks,
  };
}

export const ENV_KEYS = {
  mode: "CODE_EXPLAIN_PROVIDER_MODE",
  localModel: "CODE_EXPLAIN_LOCAL_MODEL",
  localBaseUrl: "CODE_EXPLAIN_LOCAL_BASE_URL",
  cloudApiKey: "CODE_EXPLAIN_CLOUD_API_KEY",
  cloudBaseUrl: "CODE_EXPLAIN_CLOUD_BASE_URL",
  cloudModel: "CODE_EXPLAIN_CLOUD_MODEL",
  debounceMs: "CODE_EXPLAIN_DEBOUNCE_MS",
  maxConcurrent: "CODE_EXPLAIN_MAX_CONCURRENT",
  showRisks: "CODE_EXPLAIN_SHOW_RISKS",
} as const;

/**
 * Read `CODE_EXPLAIN_*` environment variables into `RawSettings`. Only keys
 * that are actually present are set, so this layers cleanly over a config file.
 */
export function readEnvConfig(env: NodeJS.ProcessEnv = process.env): RawSettings {
  const raw: RawSettings = {};
  const envValue = (key: keyof typeof ENV_KEYS): string | undefined => env[ENV_KEYS[key]];

  const str = (key: "mode" | "localModel" | "localBaseUrl" | "cloudApiKey" | "cloudBaseUrl" | "cloudModel") => {
    const v = envValue(key);
    if (v !== undefined) raw[key] = v;
  };

  str("mode");
  str("localModel");
  str("localBaseUrl");
  str("cloudApiKey");
  str("cloudBaseUrl");
  str("cloudModel");

  const debounceMs = toInt(envValue("debounceMs"));
  if (debounceMs !== undefined) raw.debounceMs = debounceMs;
  const maxConcurrent = toInt(envValue("maxConcurrent"));
  if (maxConcurrent !== undefined) raw.maxConcurrent = maxConcurrent;
  const showRisks = toBool(envValue("showRisks"));
  if (showRisks !== undefined) raw.showRisks = showRisks;
  return raw;
}

export const DEFAULT_CONFIG_FILENAME = "code-explain.config.json";

/**
 * Read a `code-explain.config.json` file into `RawSettings`. The shape mirrors
 * the VS Code key paths, e.g.:
 *
 * ```json
 * { "provider": { "mode": "local" }, "explain": { "debounceMs": 800 } }
 * ```
 *
 * Throws if the file is missing or malformed; callers that want a soft failure
 * should use `resolveConfig`.
 */
export function readFileConfig(path: string): RawSettings {
  const text = readFileSync(path, "utf8");
  const data = JSON.parse(text) as Record<string, unknown>;
  const provider = (data.provider ?? {}) as Record<string, unknown>;
  const explain = (data.explain ?? {}) as Record<string, unknown>;

  const raw: RawSettings = {};
  if (typeof provider.mode === "string") raw.mode = provider.mode;
  if (typeof provider.localModel === "string") raw.localModel = provider.localModel;
  if (typeof provider.localBaseUrl === "string") raw.localBaseUrl = provider.localBaseUrl;
  if (typeof provider.cloudApiKey === "string") raw.cloudApiKey = provider.cloudApiKey;
  if (typeof provider.cloudBaseUrl === "string") raw.cloudBaseUrl = provider.cloudBaseUrl;
  if (typeof provider.cloudModel === "string") raw.cloudModel = provider.cloudModel;
  const debounceMs = toInt(explain.debounceMs);
  if (debounceMs !== undefined) raw.debounceMs = debounceMs;
  const maxConcurrent = toInt(explain.maxConcurrent);
  if (maxConcurrent !== undefined) raw.maxConcurrent = maxConcurrent;
  const showRisks = toBool(explain.showRisks);
  if (showRisks !== undefined) raw.showRisks = showRisks;
  return raw;
}

export interface ResolveConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Path to the config file. Defaults to `code-explain.config.json` in cwd. */
  configPath?: string;
  /** Set false to skip reading the config file entirely. */
  readFile?: boolean;
}

/**
 * Standalone resolution for the CLI and MCP server (not the extension).
 * Precedence, highest first: `overrides` > environment > config file > defaults.
 * A missing or malformed config file is ignored rather than fatal.
 */
export function resolveConfig(
  overrides: RawSettings = {},
  options: ResolveConfigOptions = {}
): ExplainConfig {
  let file: RawSettings = {};
  if (options.readFile !== false) {
    try {
      file = readFileConfig(options.configPath ?? DEFAULT_CONFIG_FILENAME);
    } catch {
      file = {};
    }
  }
  const env = readEnvConfig(options.env ?? process.env);
  return buildConfig({ ...file, ...env, ...overrides });
}
