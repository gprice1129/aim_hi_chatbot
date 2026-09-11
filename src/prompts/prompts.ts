export {
  load_prompts,
  PROMPT_DEMANDS,
}
export type {
  Prompts,
  PromptDemands,
}

import * as path from "node:path";

import { find_markdown, map_error, type Result } from "common";

import { ALLY_MODES } from "#bot/ally.js";
import { GRANT_REVIEW_MODES } from "#bot/grant_reviewer.js";
import { CHAT_SUMMARY_MODES } from "#bot/chat_summarizer.js";
import { load_prompt_tree, type PromptNode } from "#prompts/prompt_tree.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines what a bot's code demands of the prompts it is given: the
 * modes it selects among, which the content must offer, no more and no fewer.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * Each bot names its modes beside its factory, and the table here gathers
 * them. Every bot's tree is read from a document named after it under one
 * root. A mode the code selects but the content lacks, or the reverse, fails
 * here at startup, so a bot built later can trust its prompts without looking.
 *
 * Only the first level is demanded. Deeper levels stay open until code starts
 * selecting among them.
 */

/*
 * Idea: For each bot, the modes its code selects among.
 */
type PromptDemands<K extends string> = Record<K, readonly string[]>;

/*
 * Idea: What this application's bots demand.
 */
const PROMPT_DEMANDS = {
  ally: ALLY_MODES,
  grant_reviewer: GRANT_REVIEW_MODES,
  chat_summarizer: CHAT_SUMMARY_MODES,
} as const satisfies PromptDemands<string>;

/*
 * Idea: What every bot in the application runs under.
 */
type Prompts = Record<keyof typeof PROMPT_DEMANDS, PromptNode>;

/*
 * Idea: The prompts of every bot, or the first thing wrong with them.
 *
 * (string, PromptDemands<K>) => Result<Record<K, PromptNode>>
 * Side Effect: reads the filesystem
 * Public
 */
async function load_prompts<K extends string>(
    root: string, demands: PromptDemands<K>): Promise<Result<Record<K, PromptNode>>> {
  const found = map_error(await find_markdown(root), (error) => `${root}: ${error}`);
  if (!found.ok) return found;
  const trees: Partial<Record<K, PromptNode>> = {};
  for (const bot of Object.keys(demands) as K[]) {
    const tree = await load_prompt_tree(found.value, bot);
    if (!tree.ok) return tree;
    const checked = _check_modes(path.join(root, `${bot}.md`), tree.value, demands[bot]);
    if (!checked.ok) return checked;
    trees[bot] = tree.value;
  }
  return { ok: true, value: trees as Record<K, PromptNode> };
}

/*
 * Idea: The offered modes must be the demanded modes exactly.
 *
 * (string, PromptNode, readonly string[]) => Result<void>
 * Pure
 * Private
 */
function _check_modes(
    file: string, tree: PromptNode, demanded: readonly string[]): Result<void> {
  const offered = Object.keys(tree.modes);
  const missing = demanded.filter((key) => !offered.includes(key));
  if (0 < missing.length) {
    return { ok: false, error: `${file}: missing modes: ${missing.join(", ")}` };
  }
  const unknown = offered.filter((key) => !demanded.includes(key));
  if (0 < unknown.length) {
    return { ok: false, error: `${file}: unknown modes: ${unknown.join(", ")}` };
  }
  return { ok: true, value: undefined };
}
