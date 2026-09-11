export {
  leaf,
  branch,
  ALLY_PROMPTS,
  SUMMARY_PROMPTS,
  GRANT_REVIEW_PROMPTS,
}

import type { PromptNode } from "#prompts/prompt_tree.js";
import { GrantReviewMode } from "#bot/grant_reviewer.js";

/*
 * Prompt trees small enough to reason about in a test, shaped as the loader
 * would return them.
 */

// A node with no modes beneath it.
function leaf(name: string, body: string, prompt: string | null = null): PromptNode {
  return { name, description: `${name} description`, prompt, body, modes: {} };
}

// A node whose body leaves room for one of `modes`.
function branch(name: string, body: string, modes: Record<string, PromptNode>): PromptNode {
  return { ...leaf(name, body), modes };
}

const ALLY_PROMPTS = branch("Ally", "You are Ally.\n\n{mode}", {
  general: leaf("General", "Be general."),
});

const SUMMARY_PROMPTS = leaf("Summarizer", "Summarize the chat.");

// Every review mode, each with its own opener and the document placeholders.
const GRANT_REVIEW_PROMPTS = branch("Reviewer", "{mode}\n\nBe rigorous.", Object.fromEntries(
  Object.values(GrantReviewMode).map((key) => [
    key,
    leaf(`${key} review`, `Review ${key}.\n\nRFA:\n{rfaContent}\n\nProposal:\n{proposalContent}`, `Begin ${key}.`),
  ])));
