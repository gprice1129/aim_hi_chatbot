export {
  load_prompt_tree,
  compose_prompt,
  MODE_PLACEHOLDER,
}
export type {
  PromptDocument,
  PromptNode,
  ComposedPrompt,
}

import * as path from "node:path";

import {
  is_string,
  read_markdown,
  map_error,
  type Result,
  type MarkdownDocument,
  type FileTree,
} from "common";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines a bot's prompts as a tree of increasingly specific
 * instructions. The root says what is true of the bot always. Each child
 * narrows it to one way of using the bot, and may be narrowed again.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * Prompts are content, not code. They live in the static package and are read
 * once when the application starts. Reading is strict: a tree that cannot be
 * read in full is refused.
 *
 * Every document in the tree has the same shape. Its frontmatter names and
 * describes it and may give it an opening turn. A document with children marks
 * with `{mode}` where a child's text goes. On disk a document's children are
 * the documents in the directory of the same name beside it.
 *
 * Loading keeps the documents as authored. Composing a path through the tree
 * into one prompt happens when a bot is built, so the bot decides which path
 * and may fill other slots of its own at the same time.
 */

/*
 * Idea: Where in a document its child's text belongs.
 */
const MODE_PLACEHOLDER = "{mode}";

/*
 * Idea: One level of instruction, as its document states it.
 *
 * `prompt` is the turn that opens a conversation at this level, for bots
 * whose modes are started rather than merely selected.
 */
interface PromptDocument {
  name: string;
  description: string;
  prompt: string | null;
  body: string;
}

/*
 * Idea: One level of instruction, and the more specific levels beneath it.
 */
interface PromptNode extends PromptDocument {
  modes: Record<string, PromptNode>;
}

/*
 * Idea: What a bot runs under once a path through the tree is chosen.
 */
interface ComposedPrompt {
  context: string;
  prompt: string | null;
}

/*
 * Idea: A document and everything beneath it become one tree.
 *
 * (FileTree, string) => Result<PromptNode>
 * The document is `<key>.md` in the directory as found; its children are the
 * documents of the subtree of the same name, if there is one. Every error
 * names the file.
 * Side Effect: reads the filesystem
 * Public
 */
async function load_prompt_tree(found: FileTree, key: string): Promise<Result<PromptNode>> {
  const file = path.join(found.dir, `${key}.md`);
  const read = map_error(await read_markdown(file), (error) => `${file}: ${error}`);
  if (!read.ok) return read;
  const document = _parse_document(file, read.value);
  if (!document.ok) return document;
  const children = found.subtrees[key]?.files ?? [];
  if (0 < children.length && !document.value.body.includes(MODE_PLACEHOLDER)) {
    return {
      ok: false,
      error: `${file}: has modes but no ${MODE_PLACEHOLDER} placeholder`,
    };
  }
  const modes: Record<string, PromptNode> = {};
  for (const child of children) {
    const child_key = path.basename(child, ".md");
    const node = await load_prompt_tree(found.subtrees[key], child_key);
    if (!node.ok) return node;
    modes[child_key] = node.value;
  }
  return { ok: true, value: { ...document.value, modes } };
}

/*
 * Idea: Walking down the tree, each level's text takes the place its parent
 * left for it.
 *
 * (PromptNode, readonly string[]) => Result<ComposedPrompt>
 * The path must end at a leaf; a level with modes is not itself runnable. The
 * opening turn is the deepest one declared along the path. Replacement is
 * given as a function so `$` sequences in a body are inserted literally.
 * Pure
 * Public
 */
function compose_prompt(root: PromptNode, keys: readonly string[]): Result<ComposedPrompt> {
  let node = root;
  let context = root.body;
  let prompt = root.prompt;
  for (const key of keys) {
    const child = node.modes[key];
    if (undefined === child) {
      return { ok: false, error: `'${node.name}' has no mode '${key}'` };
    }
    context = context.replaceAll(MODE_PLACEHOLDER, () => child.body);
    if (null !== child.prompt) prompt = child.prompt;
    node = child;
  }
  if (0 < Object.keys(node.modes).length) {
    return { ok: false, error: `'${node.name}' has modes; one must be chosen` };
  }
  return { ok: true, value: { context, prompt } };
}

/*
 * Idea: The boundary where a document stops being markdown and becomes one
 * level of instruction.
 *
 * (string, MarkdownDocument) => Result<PromptDocument>
 * The name and description are required; the opening turn is not.
 * Pure
 * Private
 */
function _parse_document(
    file: string, document: MarkdownDocument): Result<PromptDocument> {
  const { fields, body } = document;
  const name = fields["name"];
  const description = fields["description"];
  const prompt = fields["prompt"] ?? null;
  if (!is_string(name)) {
    return { ok: false, error: `${file}: expected a 'name' field` };
  }
  if (!is_string(description)) {
    return { ok: false, error: `${file}: expected a 'description' field` };
  }
  if (null !== prompt && !is_string(prompt)) {
    return { ok: false, error: `${file}: expected 'prompt' to be text` };
  }
  return { ok: true, value: { name, description, prompt, body: body.trim() } };
}
