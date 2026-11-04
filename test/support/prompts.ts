export {
  leaf,
  branch,
  ALLY_PROMPTS,
  SUMMARY_PROMPTS,
  GRANT_REVIEW_PROMPTS,
  DOCUMENT_BUILDER_PROMPTS,
  IRB_TEMPLATE,
}

import type { PromptNode } from "#prompts/prompt_tree.js";
import { GrantReviewMode } from "#bot/grant_reviewer.js";
import type { DocumentTemplate } from "#core/document.js";

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

// A root alone, with the two slots the builder fills and an opening turn.
const DOCUMENT_BUILDER_PROMPTS = leaf(
  "Document Builder",
  "Interview the user.\n\nTEMPLATE:\n{templateGuidance}\n\nDOCUMENT:\n{documentState}",
  "Begin the interview.");

// Two sections, one required, enough to exercise the tool and the renderer.
const IRB_TEMPLATE: DocumentTemplate = {
  id: "irb-test",
  title: "Test Protocol",
  sections: [
    { id: "aims", title: "Specific aims", required: true, model_guidance: "The aims.", user_placeholder: "Aims here." },
    { id: "notes", title: "Reviewer notes", required: false, model_guidance: "Flags." },
  ],
};
