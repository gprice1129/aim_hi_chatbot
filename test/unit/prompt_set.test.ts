import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { load_prompt_set, compose_mode } from "#prompts/prompt_set.js";
import type { Result } from "common";

// Materialize `files` under a fresh temp directory, run the test, clean up.
async function with_tree(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prompt_set-"));
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

// Assert a failed result whose error names `file`.
function assert_error_names<T>(result: Result<T>, file: string): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error.includes(file), `expected '${result.error}' to name ${file}`);
}

const CORE = "Core head.\n\n{mode}\n\nCore tail.\n";

const GENERAL = [
  "---",
  'name: "General"',
  'description: "Does the usual"',
  "---",
  "Mode text.",
  "",
].join("\n");

describe("load_prompt_set", () => {
  it("reads a core alone, trimmed, when the bot has no modes", async () => {
    await with_tree({ "core.md": "  Be brief.\n\n" }, async (dir) => {
      const read = await load_prompt_set(dir);
      assert.deepEqual(read, { ok: true, value: { core: "Be brief.", modes: {} } });
    });
  });

  it("keys each mode by its file stem and keeps the core as authored", async () => {
    await with_tree({
      "core.md": CORE,
      "modes/general.md": GENERAL,
    }, async (dir) => {
      const read = await load_prompt_set(dir);
      assert.deepEqual(read, {
        ok: true,
        value: {
          core: "Core head.\n\n{mode}\n\nCore tail.",
          modes: {
            general: {
              name: "General",
              description: "Does the usual",
              prompt: null,
              body: "Mode text.",
            },
          },
        },
      });
    });
  });

  it("reads the opening prompt when a mode declares one", async () => {
    const mode = GENERAL.replace("---\nMode", 'prompt: "Begin."\n---\nMode');
    await with_tree({ "core.md": CORE, "modes/general.md": mode }, async (dir) => {
      const read = await load_prompt_set(dir);
      assert.ok(read.ok);
      assert.equal(read.value.modes["general"]?.prompt, "Begin.");
    });
  });

  it("only reads markdown documents as modes", async () => {
    await with_tree({
      "core.md": CORE,
      "modes/general.md": GENERAL,
      "modes/notes.txt": "not a mode",
    }, async (dir) => {
      const read = await load_prompt_set(dir);
      assert.ok(read.ok);
      assert.deepEqual(Object.keys(read.value.modes), ["general"]);
    });
  });

  it("treats a modes directory with no documents as no modes", async () => {
    await with_tree({ "core.md": CORE, "modes/.keep": "" }, async (dir) => {
      const read = await load_prompt_set(dir);
      assert.ok(read.ok);
      assert.deepEqual(read.value.modes, {});
    });
  });

  it("refuses a core with modes but no placeholder for them", async () => {
    await with_tree({
      "core.md": "No room for a mode.\n",
      "modes/general.md": GENERAL,
    }, async (dir) => {
      assert_error_names(await load_prompt_set(dir), "core.md");
    });
  });

  it("refuses a set with no core", async () => {
    await with_tree({ "modes/general.md": GENERAL }, async (dir) => {
      assert_error_names(await load_prompt_set(dir), "core.md");
    });
  });

  it("refuses a mode with no frontmatter", async () => {
    await with_tree({
      "core.md": CORE,
      "modes/bare.md": "Just text.\n",
    }, async (dir) => {
      assert_error_names(await load_prompt_set(dir), "bare.md");
    });
  });

  it("refuses a mode missing a required field", async () => {
    await with_tree({
      "core.md": CORE,
      "modes/unnamed.md": '---\ndescription: "No name"\n---\nText.\n',
    }, async (dir) => {
      assert_error_names(await load_prompt_set(dir), "unnamed.md");
    });
  });
});

describe("compose_mode", () => {
  const MODE = { name: "General", description: "Does the usual", prompt: null };

  it("puts the mode's body where the core's placeholder is", () => {
    const core = "Core head.\n\n{mode}\n\nCore tail.";
    assert.equal(
      compose_mode(core, { ...MODE, body: "Mode text." }),
      "Core head.\n\nMode text.\n\nCore tail.");
  });

  it("inserts a body containing `$` sequences literally", () => {
    const core = "Core head.\n\n{mode}\n\nCore tail.";
    assert.equal(
      compose_mode(core, { ...MODE, body: "Costs $& and $1." }),
      "Core head.\n\nCosts $& and $1.\n\nCore tail.");
  });
});
