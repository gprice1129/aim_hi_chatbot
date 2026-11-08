import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { render_document } from "#core/document.js";
import {
  DocumentAuthor,
  SectionStatus,
  empty_document,
  write_section,
  type Document,
  type DocumentTemplate,
} from "common";

const NOW = "2026-11-06T00:00:00.000Z";

const TEMPLATE: DocumentTemplate = {
  id: "irb-test",
  title: "Test Protocol",
  sections: [
    { id: "aims", title: "Specific aims", required: true },
    { id: "notes", title: "Reviewer notes", required: false },
  ],
};

// A document with `aims` written by the user and `notes` by the assistant.
function written(): Document {
  const by_user = write_section(TEMPLATE, empty_document(TEMPLATE, [DocumentAuthor.USER, DocumentAuthor.ASSISTANT]), {
    section_id: "aims", text: "1. Measure X", status: SectionStatus.COMPLETE,
    author: DocumentAuthor.USER, revision: 0,
  }, NOW);
  assert.ok(by_user.ok);
  const by_assistant = write_section(TEMPLATE, by_user.value, {
    section_id: "notes", text: "Consider exempt category 4.", status: SectionStatus.DRAFT,
    author: DocumentAuthor.ASSISTANT, revision: 1,
  }, NOW);
  assert.ok(by_assistant.ok);
  return by_assistant.value;
}

describe("render_document", () => {
  it("marks every unwritten section, required ones as such", () => {
    const empty = empty_document(TEMPLATE, [DocumentAuthor.ASSISTANT]);
    assert.equal(render_document(TEMPLATE, empty), [
      "### Specific aims (id: aims, required)\nNot written yet.",
      "### Reviewer notes (id: notes)\nNot written yet.",
    ].join("\n\n"));
  });

  it("gives each written section its status, author, time and text, in template order", () => {
    assert.equal(render_document(TEMPLATE, written()), [
      "### Specific aims (id: aims, required)\n"
        + `Status: complete. Last written by the user, directly in the document at ${NOW}.\n\n`
        + "1. Measure X",
      "### Reviewer notes (id: notes)\n"
        + `Status: draft. Last written by you at ${NOW}.\n\n`
        + "Consider exempt category 4.",
    ].join("\n\n"));
  });

  it("leaves out a section the template does not name", () => {
    const trimmed: DocumentTemplate = { ...TEMPLATE, sections: [TEMPLATE.sections[1]] };
    const text = render_document(trimmed, written());
    assert.doesNotMatch(text, /Specific aims/);
    assert.match(text, /^### Reviewer notes/);
  });
});
