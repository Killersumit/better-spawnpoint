/**
 * LLM access, provider-agnostic.
 *
 * Talks to any OpenAI-compatible `/chat/completions` endpoint — that covers
 * OpenAI, Azure OpenAI, OpenRouter, Groq, Together, Fireworks, vLLM, Ollama, and
 * most gateways. There is no SDK: one `fetch` is less to keep up to date than a
 * vendor client, and the request shape is stable.
 *
 * Deliberately NOT here: prompt storage, conversation history, embeddings. This
 * is the plumbing; the product decides what a conversation is.
 *
 * Compliance notes that shaped the code:
 *  • `llmDisclosure()` returns exactly what the EU AI Act Art. 50 transparency
 *    note needs (who the provider is and where their terms live). If you show
 *    model output to a user, show this too.
 *  • Prompts are never logged at info level. Error logs carry status codes and
 *    token counts, never content.
 *  • Calls are bounded: a timeout, a max token count, and no automatic retry of
 *    a request that may have already been billed.
 */
import { ServiceUnavailableError } from "@shared/errors";
import { ENV } from "../env";
import { logger } from "../logger";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatResult = {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1_024;

export function isLlmConfigured(): boolean {
  return Boolean(ENV.LLM_BASE_URL && ENV.LLM_API_KEY);
}

/** What to display next to AI output (EU AI Act Art. 50 transparency). */
export function llmDisclosure(): { provider: string; url: string | null } {
  return {
    provider: ENV.LLM_PROVIDER_LABEL || "an external AI provider",
    url: ENV.LLM_PROVIDER_URL ?? null,
  };
}

/**
 * Send a conversation and return the assistant's reply.
 *
 * Throws a `503`-shaped error when the provider is not configured or is
 * unreachable, so a UI can say "AI features are unavailable right now" instead
 * of showing a stack trace.
 */
export async function chat(
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number; timeoutMs?: number; model?: string } = {}
): Promise<ChatResult> {
  if (!isLlmConfigured()) {
    throw ServiceUnavailableError(
      "AI features are not configured on this instance (set LLM_BASE_URL and LLM_API_KEY)."
    );
  }

  const base = ENV.LLM_BASE_URL!.replace(/\/$/, "");
  const model = options.model ?? ENV.LLM_MODEL;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ENV.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "TimeoutError";
    logger.error("llm request failed", {
      model,
      reason: aborted ? "timeout" : String(error),
      durationMs: Date.now() - startedAt,
    });
    throw ServiceUnavailableError(
      aborted
        ? "The AI provider took too long to respond. Try again."
        : "Could not reach the AI provider. Try again in a moment."
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logger.warn("llm provider returned an error", {
      model,
      status: response.status,
      // Truncated: provider error bodies occasionally echo the request back.
      detail: detail.slice(0, 300),
    });

    if (response.status === 401 || response.status === 403) {
      throw ServiceUnavailableError("The AI provider rejected our credentials.");
    }
    if (response.status === 429) {
      throw ServiceUnavailableError("The AI provider is rate limiting us. Try again shortly.");
    }
    throw ServiceUnavailableError(`The AI provider returned an error (${response.status}).`);
  }

  const payload = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = payload.choices?.[0]?.message?.content ?? "";
  if (!text) {
    logger.warn("llm returned an empty completion", { model, durationMs: Date.now() - startedAt });
  }

  logger.info("llm request completed", {
    model: payload.model ?? model,
    durationMs: Date.now() - startedAt,
    promptTokens: payload.usage?.prompt_tokens,
    completionTokens: payload.usage?.completion_tokens,
  });

  return {
    text,
    model: payload.model ?? model,
    ...(payload.usage
      ? {
          usage: {
            promptTokens: payload.usage.prompt_tokens,
            completionTokens: payload.usage.completion_tokens,
          },
        }
      : {}),
  };
}

/**
 * System prompt shared by the template's example feature.
 *
 * Two things worth keeping if you replace it: the instruction to say when it
 * does not know (rather than inventing), and the reminder that its output is
 * shown to a person who must be able to tell it came from a machine.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  "You are a concise, accurate assistant inside a web application.",
  "Answer in plain language and in at most a few short paragraphs.",
  "If you are not sure about something, say so instead of guessing.",
  "Never invent URLs, statistics, quotes, or API names.",
  "You are an AI: do not claim to be human, and do not claim to have performed actions you cannot perform.",
].join(" ");
