import { chatCompletion, type ChatMessage } from "./cloud.js";

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export const OLLAMA_DEFAULT_MODEL = "llama3.1";

export async function ollamaChat(
  opts: OllamaOptions
): Promise<{ text: string }> {
  // Ollama serves an OpenAI-compatible endpoint at /v1/chat/completions.
  return chatCompletion({
    baseUrl: opts.baseUrl ?? OLLAMA_DEFAULT_BASE_URL,
    model: opts.model ?? OLLAMA_DEFAULT_MODEL,
    messages: opts.messages,
    signal: opts.signal,
  });
}
