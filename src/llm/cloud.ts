export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  baseUrl: string; // e.g. https://api.openai.com/v1 or http://127.0.0.1:11434/v1
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  text: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function chatCompletion(
  opts: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const url = new URL("/chat/completions", ensureTrailingSlash(opts.baseUrl));

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const signal = opts.signal ?? controller.signal;

  if (!opts.signal) {
    timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  }

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("LLM returned no content");
    return { text };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
