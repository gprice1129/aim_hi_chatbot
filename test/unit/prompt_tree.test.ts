import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { load_prompt_tree, compose_prompt, type PromptNode } from "#prompts/prompt_tree.js";
import { find_markdown, ok_or_throw, type Result } from "common";

// Read the tree rooted at `key` from what is on disk under `dir`.
async function load(dir: string, key: string): Promise<Result<PromptNode>> {
  return load_prompt_tree(ok_or_throw(await find_markdown(dir)), key);
}

// Materialize `files` under a fresh temp directory, run the test, clean up.
async function with_tree(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prompt_tree-"));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const file = path.join(dir, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
    }
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Assert a failed result whose error names `text`.
function assert_error_names<T>(result: Result<T>, text: string): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error.includes(text), `expected '${result.error}' to name ${text}`);
}

// A document with the required fields, an optional opener, and `body`.
function document(name: string, body: string, prompt?: string): string {
  const opener = undefined === prompt ? "" : `prompt: "${prompt}"\n`;
  return `---\nname: "${name}"\ndescription: "${name} description"\n${opener}---\n${body}\n`;
}

// A node as the reader returns it, for building expectations.
function node(
  name: string, body: string, prompt: string | null = null,
  modes: Record<string, PromptNode> = {},
): PromptNode {
  return { name, description: `${name} description`, prompt, body, modes };
}

describe("load_prompt_tree", () => {
  it("reads a document with no directory beside it as a leaf", async () => {
    await with_tree({ "bot.md": document("Bot", "  Be brief.\n\n") }, async (dir) => {
      const read = await load(dir, "bot");
      assert.deepEqual(read, { ok: true, value: node("Bot", "Be brief.") });
    });
  });

  it("reads the documents in the same-named directory as modes, recursively", async () => {
    await with_tree({
      "bot.md": document("Bot", "Root.\n\n{mode}"),
      "bot/general.md": document("General", "General.\n\n{mode}"),
      "bot/general/tutor.md": document("Tutor", "Tutor.", "Teach me."),
      "bot/notes.txt": "not a mode",
    }, async (dir) => {
      const read = await load(dir, "bot");
      assert.deepEqual(read, {
        ok: true,
        value: node("Bot", "Root.\n\n{mode}", null, {
          general: node("General", "General.\n\n{mode}", null, {
            tutor: node("Tutor", "Tutor.", "Teach me."),
          }),
        }),
      });
    });
  });

  it("refuses a document with modes but no placeholder for them", async () => {
    await with_tree({
      "bot.md": document("Bot", "No room."),
      "bot/general.md": document("General", "General."),
    }, async (dir) => {
      assert_error_names(await load(dir, "bot"), "bot.md");
    });
  });

  it("names a missing root", async () => {
    await with_tree({}, async (dir) => {
      assert_error_names(await load(dir, "bot"), "bot.md");
    });
  });

  it("refuses a document with no frontmatter", async () => {
    await with_tree({
      "bot.md": document("Bot", "{mode}"),
      "bot/bare.md": "Just text.\n",
    }, async (dir) => {
      assert_error_names(await load(dir, "bot"), "bare.md");
    });
  });

  it("refuses a document missing a required field", async () => {
    await with_tree({
      "bot.md": '---\ndescription: "No name"\n---\nText.\n',
    }, async (dir) => {
      assert_error_names(await load(dir, "bot"), "bot.md");
    });
  });

  it("refuses an opener that is not text", async () => {
    await with_tree({
      "bot.md": '---\nname: "Bot"\ndescription: "Bot"\nprompt: 3\n---\nText.\n',
    }, async (dir) => {
      assert_error_names(await load(dir, "bot"), "prompt");
    });
  });
});

describe("compose_prompt", () => {
  const TREE = node("Bot", "Root.\n\n{mode}", null, {
    general: node("General", "General.\n\n{mode}", "Start general.", {
      tutor: node("Tutor", "Tutor."),
      quiz: node("Quiz", "Quiz.", "Start quiz."),
    }),
    plain: node("Plain", "Costs $& and $1."),
  });

  it("runs a leaf root as it is", () => {
    assert.deepEqual(compose_prompt(node("Bot", "Be brief.", "Go."), []), {
      ok: true,
      value: { context: "Be brief.", prompt: "Go." },
    });
  });

  it("nests each level's text into the placeholder above it", () => {
    assert.deepEqual(compose_prompt(TREE, ["general", "tutor"]), {
      ok: true,
      value: { context: "Root.\n\nGeneral.\n\nTutor.", prompt: "Start general." },
    });
  });

  it("fills every placeholder at a level with the fully composed level below", () => {
    // The composed text is the same as building bottom up: the leaf goes into
    // its parent first, and that whole piece goes into each slot above.
    const twice = node("Twice", "Head {mode} Middle {mode} Tail", null, {
      general: node("General", "G[{mode}]", null, {
        tutor: node("Tutor", "T"),
      }),
    });
    const composed = compose_prompt(twice, ["general", "tutor"]);
    assert.ok(composed.ok);
    assert.equal(composed.value.context, "Head G[T] Middle G[T] Tail");
  });

  it("takes the deepest opener declared along the path", () => {
    const composed = compose_prompt(TREE, ["general", "quiz"]);
    assert.ok(composed.ok);
    assert.equal(composed.value.prompt, "Start quiz.");
  });

  it("inserts a body containing `$` sequences literally", () => {
    const composed = compose_prompt(TREE, ["plain"]);
    assert.ok(composed.ok);
    assert.equal(composed.value.context, "Root.\n\nCosts $& and $1.");
  });

  it("refuses a path that stops at a level with modes", () => {
    assert_error_names(compose_prompt(TREE, ["general"]), "General");
    assert_error_names(compose_prompt(TREE, []), "Bot");
  });

  it("refuses a key the level does not offer", () => {
    assert_error_names(compose_prompt(TREE, ["general", "exam"]), "exam");
  });
});
