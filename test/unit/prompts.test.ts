import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { load_prompts, PROMPT_DEMANDS } from "#prompts/prompts.js";
import type { Result } from "common";

// Materialize `files` under a fresh temp directory, run the test, clean up.
async function with_tree(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prompts-"));
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

// Assert a failed result whose error mentions `text`.
function assert_error_mentions<T>(result: Result<T>, text: string): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error.includes(text), `expected '${result.error}' to mention ${text}`);
}

// A document with the required fields and `body`.
function document(name: string, body: string): string {
  return `---\nname: "${name}"\ndescription: "${name} description"\n---\n${body}\n`;
}

// The smallest tree that satisfies `demands`.
function satisfying(demands: Record<string, readonly string[]>): Record<string, string> {
  const tree: Record<string, string> = {};
  for (const [bot, modes] of Object.entries(demands)) {
    const body = 0 === modes.length ? `${bot} root.` : `${bot} root.\n\n{mode}`;
    tree[`${bot}.md`] = document(bot, body);
    for (const mode of modes) {
      tree[`${bot}/${mode}.md`] = document(mode, `${mode} body.`);
    }
  }
  return tree;
}

const DEMANDS = { echo: [], chooser: ["fast", "slow"] };

describe("load_prompts", () => {
  it("reads every demanded bot from the document named after it", async () => {
    await with_tree(satisfying(DEMANDS), async (root) => {
      const read = await load_prompts(root, DEMANDS);
      assert.ok(read.ok, read.ok ? "" : read.error);
      assert.equal(read.value.echo.body, "echo root.");
      assert.deepEqual(Object.keys(read.value.echo.modes), []);
      assert.deepEqual(Object.keys(read.value.chooser.modes).sort(), ["fast", "slow"]);
      assert.equal(read.value.chooser.modes["slow"]?.body, "slow body.");
    });
  });

  it("refuses a bot missing a mode its code selects", async () => {
    const tree = satisfying(DEMANDS);
    delete tree["chooser/slow.md"];
    await with_tree(tree, async (root) => {
      assert_error_mentions(await load_prompts(root, DEMANDS), "missing modes: slow");
    });
  });

  it("refuses a bot offering a mode its code cannot select", async () => {
    const tree = satisfying(DEMANDS);
    tree["chooser/medium.md"] = document("medium", "medium body.");
    await with_tree(tree, async (root) => {
      assert_error_mentions(await load_prompts(root, DEMANDS), "unknown modes: medium");
    });
  });

  it("refuses modes under a bot that selects none", async () => {
    const tree = satisfying(DEMANDS);
    tree["echo.md"] = document("echo", "{mode}");
    tree["echo/extra.md"] = document("extra", "extra body.");
    await with_tree(tree, async (root) => {
      assert_error_mentions(await load_prompts(root, DEMANDS), "unknown modes: extra");
    });
  });

  it("names the file when a bot's root cannot be read", async () => {
    const tree = satisfying(DEMANDS);
    delete tree["chooser.md"];
    await with_tree(tree, async (root) => {
      assert_error_mentions(await load_prompts(root, DEMANDS), "chooser.md");
    });
  });

  it("is satisfied by a tree shaped after the application's demands", async () => {
    await with_tree(satisfying(PROMPT_DEMANDS), async (root) => {
      const read = await load_prompts(root, PROMPT_DEMANDS);
      assert.ok(read.ok, read.ok ? "" : read.error);
      assert.deepEqual(
        Object.keys(read.value).sort(),
        ["ally", "chat_summarizer", "grant_reviewer"]);
    });
  });
});
