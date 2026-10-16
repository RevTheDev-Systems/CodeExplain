import { chatCompletion, type ChatMessage } from "./cloud.js";
import { ollamaChat } from "./ollama.js";

export type ProviderMode = "auto" | "local" | "cloud";

export interface ExplainResult {
  summary: string;
  risk: string;
  level: "safe" | "caution" | "danger";
  provider: "local" | "cloud";
}

export interface ProviderConfig {
  mode: ProviderMode;
  localModel?: string;
  localBaseUrl?: string;
  cloudApiKey?: string;
  cloudBaseUrl?: string;
  cloudModel?: string;
  /** milliseconds to wait before falling back from local to cloud */
  localTimeoutMs?: number;
}

const DEFAULT_CLOUD_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CLOUD_MODEL = "gpt-4o-mini";

export function isConfigured(config: ProviderConfig): boolean {
  if (config.mode === "cloud") return Boolean(config.cloudApiKey);
  // local and auto always have a usable path (local first)
  return true;
}

export async function explainWithProvider(
  config: ProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ExplainResult> {
  if (config.mode === "cloud") {
    const text = await chatCompletion({
      baseUrl: config.cloudBaseUrl ?? DEFAULT_CLOUD_BASE_URL,
      apiKey: config.cloudApiKey,
      model: config.cloudModel ?? DEFAULT_CLOUD_MODEL,
      messages,
      signal,
    });
    return { ...parseExplainResult(text.text), provider: "cloud" };
  }

  if (config.mode === "local") {
    const text = await ollamaChat({
      baseUrl: config.localBaseUrl,
      model: config.localModel,
      messages,
      signal,
    });
    return { ...parseExplainResult(text.text), provider: "local" };
  }

  // auto: try local, fall back to cloud on failure
  const localTimeout = new AbortController();
  const localTimer = setTimeout(
    () => localTimeout.abort(),
    config.localTimeoutMs ?? 15_000
  );
  try {
    const text = await ollamaChat({
      baseUrl: config.localBaseUrl,
      model: config.localModel,
      messages,
      signal: signal ?? localTimeout.signal,
    });
    return { ...parseExplainResult(text.text), provider: "local" };
  } catch (err) {
    if (!config.cloudApiKey) throw err;
    const text = await chatCompletion({
      baseUrl: config.cloudBaseUrl ?? DEFAULT_CLOUD_BASE_URL,
      apiKey: config.cloudApiKey,
      model: config.cloudModel ?? DEFAULT_CLOUD_MODEL,
      messages,
      signal,
    });
    return { ...parseExplainResult(text.text), provider: "cloud" };
  } finally {
    clearTimeout(localTimer);
  }
}

export function parseExplainResult(raw: string): Omit<ExplainResult, "provider"> {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  try {
    const obj = JSON.parse(extractJsonObject(cleaned)) as Partial<Omit<ExplainResult, "provider">>;
    return {
      summary: obj.summary ?? "No summary returned.",
      risk: obj.risk ?? "none",
      level: obj.level === "danger" || obj.level === "caution" ? obj.level : "safe",
    };
  } catch {
    return { summary: cleaned.slice(0, 500), risk: "none", level: "safe" };
  }
}

/**
 * Slice out the first JSON object/array from `text`, so surrounding prose or
 * stray braces do not break parsing. Returns the original text when no opening
 * bracket is present.
 */
function extractJsonObject(text: string): string {
  const start = text.search(/[{[]/);
  if (start < 0) return text;
  const close = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  return end > start ? text.slice(start, end + 1) : text.slice(start);
}
