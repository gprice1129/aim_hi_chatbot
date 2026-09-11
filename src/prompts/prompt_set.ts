export {
  load_prompt_set,
  compose_mode,
  MODE_PLACEHOLDER,
}
export type {
  PromptSet,
  PromptMode,
}

import * as path from "node:path";

import {
  is_string,
  read_text,
  read_markdown,
  find_markdown,
  map_ok,
  map_error,
  type Result,
  type FrontmatterMap,
} from "common";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how prompts authored as documents are read into text a bot
 * can run under. A bot's prompts are a set: one core document and optionally a
 * set of modes that influence the bot's goals.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * Prompts are content, not code. They live in the static package and are read
 * once when the application starts. Reading is strict: a set that cannot be
 * read in full is refused, so a broken mode fails at startup rather than on the
 * request that selects it.
 *
 * A set's core holds what is true of a bot in every mode. A core with modes
 * marks with `{mode}` where a mode's text goes; a core without modes is the
 * whole prompt. A mode document's frontmatter names the mode; its body is the
 * text. Which bot a set belongs to, and which mode keys it must hold, is
 * decided by the caller.
 *
 * Loading keeps the documents as authored. Composing a core with a mode
 * happens when a bot is built, so the bot decides which mode and may fill
 * other slots of its own at the same time.
 */

/*
 * Idea: Where in a core the mode's text belongs.
 */
const MODE_PLACEHOLDER = "{mode}";

/*
 * Idea: Everything a bot can be asked to run under.
 *
 * `modes` is empty for a bot that has none; `core` is then its prompt.
 */
interface PromptSet {
  core: string;
  modes: Record<string, PromptMode>;
}

/*
 * Idea: A guide for the bot's current goals.
 *
 * `prompt` is the turn that opens a conversation in this mode, for bots whose
 * modes are started rather than merely selected.
 */
interface PromptMode {
  name: string;
  description: string;
  prompt: string | null;
  body: string;
}

/*
 * Idea: A core and whatever modes sit beside it become a bot's prompts.
 *
 * (string) => Result<PromptSet>
 * Expects `core.md` under `dir`, and reads `modes/*.md` if present. Every
 * error names the file.
 * Side Effect: reads the filesystem
 * Public
 */
async function load_prompt_set(dir: string): Promise<Result<PromptSet>> {
  const core_file = path.join(dir, "core.md");
  const core = await _read_core(core_file);
  if (!core.ok) return core;
  const modes_dir = path.join(dir, "modes");
  const mode_files = map_error(
    await find_markdown(modes_dir, { optional: true }),
    (error) => `${modes_dir}: ${error}`);
  if (!mode_files.ok) return mode_files;
  if (0 < mode_files.value.length && !core.value.includes(MODE_PLACEHOLDER)) {
    return {
      ok: false,
      error: `${core_file}: has modes but no ${MODE_PLACEHOLDER} placeholder`
    };
  }
  const modes: Record<string, PromptMode> = {};
  for (const file of mode_files.value) {
    const mode = await _read_mode(file);
    if (!mode.ok) return mode;
    modes[path.basename(file, ".md")] = mode.value;
  }
  return { ok: true, value: { core: core.value, modes } };
}

/*
 * Idea: The mode's text takes the core's place for it.
 *
 * (string, PromptMode) => string
 * Cannot fail: a loaded core with modes is known to hold the placeholder. The
 * replacement is given as a function so `$` sequences in the body are inserted
 * literally rather than read as replacement patterns.
 * Pure
 * Public
 */
function compose_mode(core: string, mode: PromptMode): string {
  return core.replaceAll(MODE_PLACEHOLDER, () => mode.body);
}

/*
 * Idea: The text a bot runs under in every mode.
 *
 * (string) => Result<string>
 * Side Effect: reads the filesystem
 * Private
 */
async function _read_core(file: string): Promise<Result<string>> {
  const read = map_error(await read_text(file), (error) => `${file}: ${error}`);
  return map_ok(read, (text) => text.trim());
}

/*
 * Idea: One mode document, as authored.
 *
 * (string) => Result<PromptMode>
 * Side Effect: reads the filesystem
 * Private
 */
async function _read_mode(file: string): Promise<Result<PromptMode>> {
  const read = map_error(
    await read_markdown(file),
    (error) => `${file}: ${error}`);
  if (!read.ok) return read;
  const fields = _read_mode_fields(file, read.value.fields);
  if (!fields.ok) return fields;
  return {
    ok: true,
    value: { ...fields.value, body: read.value.body.trim() },
  };
}

/*
 * Idea: What a mode says about itself, before it has any text.
 */
interface _ModeFields {
  name: string;
  description: string;
  prompt: string | null;
}

/*
 * Idea: The fields a mode must declare, and the one it may.
 *
 * (string, FrontmatterMap) => Result<_ModeFields>
 * Pure
 * Private
 */
function _read_mode_fields(file: string, fields: FrontmatterMap): Result<_ModeFields> {
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
  return { ok: true, value: { name, description, prompt } };
}
