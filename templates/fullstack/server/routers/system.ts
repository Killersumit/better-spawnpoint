/**
 * System procedures: health, capability discovery, and the AI helper.
 *
 * `capabilities` is what lets the UI (and an agent exploring the template)
 * discover what is configured on this environment instead of guessing: whether
 * there is a database, which storage driver is active, whether mail will
 * actually send, and which optional features are switched on.
 */
import { z } from "zod";
import { API } from "@shared/const";
import { AppError } from "@shared/errors";
import { compliance } from "@shared/compliance";
import { ENV, BOOTED_AT } from "../_core/env";
import { isDbConfigured } from "../_core/db";
import { storage } from "../_core/storage";
import { DEFAULT_SYSTEM_PROMPT, chat, isLlmConfigured, llmDisclosure } from "../_core/llm";
import { jobStatus } from "../_core/jobs";
import { publicProcedure, router, authedProcedure } from "../_core/trpc";

const startedAt = Date.now();

export const systemRouter = router({
  /** Liveness + readiness in one. Safe to expose: no secrets, no counts. */
  health: publicProcedure.query(async () => ({
    ok: true,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    bootedAt: BOOTED_AT.toISOString(),
    checks: {
      database: isDbConfigured() ? "configured" : "not_configured",
      storage: storage().name,
      mail: ENV.MAIL_DRIVER,
      llm: isLlmConfigured() ? "configured" : "not_configured",
      scheduler: process.env.JOBS_ENABLED === "false" ? "disabled" : "enabled",
    },
  })),

  /** What this deployment can actually do. Used by the UI to hide dead ends. */
  capabilities: publicProcedure.query(() => ({
    api: API,
    nodeEnv: ENV.NODE_ENV,
    signupMode: ENV.AUTH_SIGNUP_MODE,
    database: isDbConfigured(),
    storageDriver: storage().name,
    mailDriver: ENV.MAIL_DRIVER,
    llm: isLlmConfigured(),
    features: {
      ai: compliance.ai.featuresUseAI && isLlmConfigured(),
      payments: Boolean(ENV.STRIPE_SECRET_KEY),
      oauth: Boolean(
        (ENV.OAUTH_GOOGLE_CLIENT_ID && ENV.OAUTH_GOOGLE_CLIENT_SECRET) ||
          (ENV.OAUTH_GITHUB_CLIENT_ID && ENV.OAUTH_GITHUB_CLIENT_SECRET)
      ),
    },
    compliance: { version: compliance.version, regimes: compliance.regimes },
  })),

  jobs: publicProcedure.query(async () => {
    const jobs = await jobStatus();
    return jobs.map((job) => ({
      name: job.name,
      cron: job.cron,
      lastRunAt: job.lastRunAt,
      lastStatus: job.lastStatus,
    }));
  }),

  /**
   * Minimal AI endpoint a feature can grow from. It demonstrates the three
   * things that must be true of every model call in this codebase:
   *   1. authenticated — an open LLM endpoint is someone else's free API key;
   *   2. rate limited per account, so one user cannot burn the whole budget;
   *   3. the response carries the disclosure the UI is required to render
   *      (EU AI Act Art. 50: people must know they are talking to a machine).
   */
  askAi: authedProcedure
    .input(
      z.object({
        prompt: z.string().trim().min(1).max(4000),
        /** Optional extra instruction. Capped and always appended to the base prompt. */
        system: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isLlmConfigured()) {
        throw new AppError(
          503,
          "AI features are not configured on this environment (LLM_BASE_URL and LLM_API_KEY are unset).",
          undefined,
          "LLM_NOT_CONFIGURED"
        );
      }

      enforceAskAiRate(ctx.user.id);

      const messages = [
        {
          role: "system" as const,
          content: input.system ? `${DEFAULT_SYSTEM_PROMPT}\n\nAdditional instructions:\n${input.system}` : DEFAULT_SYSTEM_PROMPT,
        },
        { role: "user" as const, content: input.prompt },
      ];

      const result = await chat(messages, { maxTokens: 700, temperature: 0.3 });

      return {
        answer: result.text,
        model: result.model,
        disclosure: llmDisclosure(),
      };
    }),
});

/**
 * Per-account sliding-window limit for AI calls.
 *
 * In-memory, so it is a budget guard rather than a hard quota: it stops a single
 * tab from looping, and a multi-instance deploy should move this to the database
 * or Redis. Kept here rather than in a middleware because the limit is about the
 * cost of one specific endpoint.
 */
const askAiWindows = new Map<number, number[]>();
const ASK_AI_WINDOW_MS = 60_000;
const ASK_AI_LIMIT = 10;

function enforceAskAiRate(userId: number): void {
  const now = Date.now();
  const recent = (askAiWindows.get(userId) ?? []).filter((time) => now - time < ASK_AI_WINDOW_MS);

  if (recent.length >= ASK_AI_LIMIT) {
    throw new AppError(
      429,
      "That is a lot of requests in one minute. Give it a moment.",
      undefined,
      "RATE_LIMITED"
    );
  }

  recent.push(now);
  askAiWindows.set(userId, recent);

  if (askAiWindows.size > 10_000) {
    for (const [id, times] of askAiWindows) {
      if (times.every((time) => now - time >= ASK_AI_WINDOW_MS)) askAiWindows.delete(id);
    }
  }
}
