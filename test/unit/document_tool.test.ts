import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { UpdateSectionTool } from "#tools/document.js";
import {
  DocumentAuthor,
  SectionStatus,
  empty_document,
  type Document,
  type DocumentTemplate,
} from "common";

const TEMPLATE: DocumentTemplate = {
  id: "irb-test",
  title: "Test Protocol",
  sections: [
    {
      metadata: { id: "aims", title: "Specific aims", required: true },
      guidance: { model: "The aims." },
    },
    {
      metadata: { id: "notes", title: "Reviewer notes", required: false },
      guidance: { model: "The notes." },
    },
  ],
};

// A fresh document from TEMPLATE, writable by `writable_by`.
function fresh(
    writable_by: DocumentAuthor[] = [DocumentAuthor.USER, DocumentAuthor.ASSISTANT]): Document {
  return empty_document(TEMPLATE, writable_by);
}

function tool_over(document: Document): UpdateSectionTool {
  return new UpdateSectionTool(TEMPLATE, document, () => "2026-11-06T00:00:00.000Z");
}

describe("UpdateSectionTool", () => {
  it("is named update_section and offers the template's sections and the statuses short of complete", () => {
    const tool = tool_over(fresh());
    assert.equal(tool.name, "update_section");
    assert.deepEqual(tool.schema.properties["section_id"].choices, ["aims", "notes"]);
    assert.deepEqual(
      tool.schema.properties["status"].choices, ["incomplete", "draft", "needs_review"]);
    assert.deepEqual(tool.schema.required, ["section_id", "content"]);
    assert.doesNotMatch(tool.description, /'complete' once/);
    assert.match(tool.description, /Only the user can mark a section complete/);
  });

  it("writes a section as the assistant, a draft unless told otherwise", async () => {
    const tool = tool_over(fresh());
    const outcome = await tool.run({ section_id: "aims", content: "1. Measure X" });
    assert.deepEqual(outcome, { ok: true, value: "Wrote 'aims' as draft." });
    assert.deepEqual(tool.document().sections["aims"], {
      text: "1. Measure X",
      status: SectionStatus.DRAFT,
      written_by: DocumentAuthor.ASSISTANT,
      written_at: "2026-11-06T00:00:00.000Z",
    });
    assert.equal(tool.document().revision, 1);
  });

  it("builds each write on the last, and takes the status given", async () => {
    const tool = tool_over(fresh());
    await tool.run({ section_id: "notes", content: "a" });
    await tool.run({ section_id: "aims", content: "b", status: "needs_review" });
    const rewritten = await tool.run({ section_id: "notes", content: "c", status: "incomplete" });
    assert.deepEqual(rewritten, { ok: true, value: "Wrote 'notes' as incomplete." });
    assert.equal(tool.document().revision, 3);
    assert.equal(tool.document().sections["aims"].status, SectionStatus.NEEDS_REVIEW);
    assert.equal(tool.document().sections["notes"].text, "c");
  });

  it("leaves the document it was given untouched", async () => {
    const given = fresh();
    const tool = tool_over(given);
    await tool.run({ section_id: "aims", content: "1. Measure X" });
    assert.deepEqual(given, fresh());
  });

  it("refuses an unknown section, blank content, or an unknown status, writing nothing", async () => {
    const tool = tool_over(fresh());
    assert.deepEqual(await tool.run({ section_id: "budget", content: "x" }), {
      ok: false, error: "Unknown section 'budget'. Sections: aims, notes",
    });
    const blank = await tool.run({ section_id: "aims", content: "   " });
    assert.equal(blank.ok, false);
    assert.deepEqual(await tool.run({ section_id: "aims", content: "x", status: "empty" }), {
      ok: false, error: "'status' must be one of: incomplete, draft, needs_review.",
    });
    assert.deepEqual(tool.document(), fresh());
  });

  it("never marks a section complete, whatever the model asks", async () => {
    const tool = tool_over(fresh());
    assert.deepEqual(await tool.run({ section_id: "aims", content: "x", status: "complete" }), {
      ok: false,
      error: "Only the user can mark a section complete. Use 'needs_review' to ask them to.",
    });
    assert.deepEqual(tool.document(), fresh());
  });

  it("refuses a document the assistant may not write", async () => {
    const tool = tool_over(fresh([DocumentAuthor.USER]));
    assert.deepEqual(await tool.run({ section_id: "aims", content: "x" }), {
      ok: false,
      error: "This document is not yours to write. Tell the user what you would change.",
    });
    assert.deepEqual(tool.document(), fresh([DocumentAuthor.USER]));
  });
});
