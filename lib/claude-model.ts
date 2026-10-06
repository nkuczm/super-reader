/**
 * The request options that differ between the Claude models a reader can
 * choose. The newer models take an effort level, refusal fallbacks and the
 * newer web search; Claude Haiku 4.5 takes none of these and rejects them.
 */

import { DEFAULT_ANTHROPIC_MODEL, MODEL_CHOICES } from "./models";

/** A requested model if it is one offered, else the default. */
export function claudeModel(requested: unknown): string {
  return typeof requested === "string" && MODEL_CHOICES.anthropic.some((m) => m.id === requested) ? requested : DEFAULT_ANTHROPIC_MODEL;
}

const SMALL = new Set(["claude-haiku-4-5"]);

/** Effort and fallbacks, where the model accepts them. */
export function claudeOptions(model: string, effort: "low" | "medium" | "high") {
  if (SMALL.has(model)) return { effort: {}, fallback: {} };
  return {
    effort: { effort },
    fallback: { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const },
  };
}

/** The web search tool the model can use. */
export function claudeSearchTool(model: string, maxUses: number) {
  return SMALL.has(model)
    ? ({ type: "web_search_20250305", name: "web_search", max_uses: maxUses } as const)
    : ({ type: "web_search_20260209", name: "web_search", max_uses: maxUses } as const);
}
