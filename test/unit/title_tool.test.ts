import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { SetTitleTool, SET_TITLE, TITLE_MAX_LENGTH } from "#tools/title.js";

describe("SetTitleTool", () => {
  it("is named set_title and requires a title", () => {
    const t = new SetTitleTool({ title: "Untitled protocol", locked: false });
    assert.equal(t.name, SET_TITLE);
    assert.deepEqual(t.schema.required, ["title"]);
    assert.equal(t.title(), null);
  });

  it("holds a tidied name for the host and reports it", async () => {
    const t = new SetTitleTool({ title: "Untitled protocol", locked: false });
    const outcome = await t.run({ title: "  Opioid   readmissions\n2018–2023 " });
    assert.deepEqual(outcome, {
      ok: true, value: 'Named the session "Opioid readmissions 2018–2023". The user can see it now.',
    });
    assert.equal(t.title(), "Opioid readmissions 2018–2023");
  });

  it("keeps the last name when called more than once", async () => {
    const t = new SetTitleTool({ title: "Untitled protocol", locked: false });
    await t.run({ title: "First" });
    await t.run({ title: "Second" });
    assert.equal(t.title(), "Second");
  });

  it("leaves a session the user named alone, and says so", async () => {
    const t = new SetTitleTool({ title: "My study", locked: true });
    const outcome = await t.run({ title: "Something else" });
    assert.deepEqual(outcome, {
      ok: true, value: 'The user named this session "My study" themselves, so it keeps that name.',
    });
    assert.equal(t.title(), null);
  });

  it("holds nothing when the name is the current one", async () => {
    const t = new SetTitleTool({ title: "Opioid readmissions", locked: false });
    const outcome = await t.run({ title: "Opioid readmissions" });
    assert.equal(outcome.ok, true);
    assert.equal(t.title(), null);
  });

  it("refuses a blank or overlong title without holding it", async () => {
    const t = new SetTitleTool({ title: "Untitled protocol", locked: false });
    const blank = await t.run({ title: "   " });
    assert.equal(blank.ok, false);
    const long = await t.run({ title: "x".repeat(TITLE_MAX_LENGTH + 1) });
    assert.equal(long.ok, false);
    if (!long.ok) assert.match(long.error, /at most 80 characters/);
    assert.equal(t.title(), null);
  });
});
