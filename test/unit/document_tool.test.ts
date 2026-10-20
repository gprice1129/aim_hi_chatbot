import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { UpdateSectionTool, UPDATE_SECTION } from "#tools/document.js";
import { SectionSource, SectionStatus, empty_document } from "#core/document.js";
import { IRB_TEMPLATE } from "../support/prompts.ts";

const NOW = "2026-10-20T00:00:00.000Z";

function tool() {
  return new UpdateSectionTool(IRB_TEMPLATE, empty_document(IRB_TEMPLATE, NOW), () => "written");
}

describe("UpdateSectionTool", () => {
  it("is named update_section and offers the template's section ids", () => {
    const t = tool();
    assert.equal(t.name, UPDATE_SECTION);
    assert.deepEqual(t.schema.properties.section_id.choices, ["aims", "notes"]);
    assert.deepEqual(t.schema.required, ["section_id", "content"]);
  });

  it("writes a section as a draft by default and reports it", async () => {
    const t = tool();
    const outcome = await t.run({ section_id: "aims", content: "1. Measure X" });
    assert.deepEqual(outcome, { ok: true, value: 'Wrote "Specific aims" as draft. The user can see it now.' });
    assert.deepEqual(t.document().sections.aims, {
      content: "1. Measure X", status: SectionStatus.DRAFT, source: SectionSource.ASSISTANT, updated_at: "written",
    });
    assert.deepEqual(t.changed(), ["aims"]);
  });

  it("accepts an explicit status and lists each section once however often it is written", async () => {
    const t = tool();
    await t.run({ section_id: "notes", content: "a" });
    await t.run({ section_id: "aims", content: "b", status: "complete" });
    await t.run({ section_id: "notes", content: "c" });
    assert.equal(t.document().sections.aims.status, SectionStatus.COMPLETE);
    assert.equal(t.document().sections.notes.content, "c");
    assert.deepEqual(t.changed(), ["notes", "aims"]);
  });

  it("refuses an unknown section, empty content, or an unknown status without writing", async () => {
    const t = tool();
    const unknown = await t.run({ section_id: "budget", content: "x" });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /Unknown section 'budget'. Sections: aims, notes/);
    const blank = await t.run({ section_id: "aims", content: "   " });
    assert.equal(blank.ok, false);
    const status = await t.run({ section_id: "aims", content: "x", status: "empty" });
    assert.equal(status.ok, false);
    assert.equal(t.document().sections.aims.status, SectionStatus.EMPTY);
    assert.deepEqual(t.changed(), []);
  });
});
