/**
 * The request options that differ between the Claude models a reader can
 * choose. The newer models take an effort level, refusal fallbacks and the
 * newer web search; Claude Haiku 4.5 takes none of these and rejects them.
 * Claude Haiku 5.5 takes an effort level, but has no refusal fallback and
 * only the basic web search.
 */

import { DEFAULT_ANTHROPIC_MODEL, MODEL_CHOICES } from "./models";

/** A requested model if it is one offered, else the default. */
export function claudeModel(requested: unknown): string {
  return typeof requested === "string" && MODEL_CHOICES.anthropic.some((m) => m.id === requested) ? requested : DEFAULT_ANTHROPIC_MODEL;
}

const NO_EFFORT = new Set(["claude-haiku-4-5"]);
const SMALL = new Set(["claude-haiku-4-5", "claude-haiku-5-5"]);

/** Effort and fallbacks, where the model accepts them. */
export function claudeOptions(model: string, effort: "low" | "medium" | "high") {
  return {
    effort: NO_EFFORT.has(model) ? {} : { effort },
    fallback: SMALL.has(model) ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const },
  };
}

/** The web search tool the model can use. */
export function claudeSearchTool(model: string, maxUses: number) {
  return SMALL.has(model)
    ? ({ type: "web_search_20250305", name: "web_search", max_uses: maxUses } as const)
    : ({ type: "web_search_20260209", name: "web_search", max_uses: maxUses } as const);
}
