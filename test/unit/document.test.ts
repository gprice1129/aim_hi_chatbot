import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  SectionSource,
  SectionStatus,
  apply_section_update,
  empty_document,
  migrate_document,
  parse_document_state,
  parse_document_template,
  render_document,
  render_template_guidance,
} from "#core/document.js";
import { IRB_TEMPLATE } from "../support/prompts.ts";

const NOW = "2026-10-20T00:00:00.000Z";

describe("parse_document_template", () => {
  it("accepts a well-formed template and keeps section order", () => {
    const raw = JSON.parse(JSON.stringify(IRB_TEMPLATE));
    const parsed = parse_document_template(raw);
    assert.deepEqual(parsed, { ok: true, value: IRB_TEMPLATE });
  });

  it("names what is wrong", () => {
    const bad = (patch: object, where: RegExp) => {
      const raw = { ...JSON.parse(JSON.stringify(IRB_TEMPLATE)), ...patch };
      const parsed = parse_document_template(raw);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.match(parsed.error, where);
    };
    bad({ id: "Bad Id" }, /template id/);
    bad({ title: "" }, /title/);
    bad({ sections: [] }, /sections/);
    bad({ sections: [IRB_TEMPLATE.sections[0], IRB_TEMPLATE.sections[0]] }, /duplicate section id 'aims'/);
    bad({ sections: [{ ...IRB_TEMPLATE.sections[0], id: "has-dash" }] }, /section 0: id/);
    bad({ sections: [{ ...IRB_TEMPLATE.sections[0], model_guidance: "" }] }, /model_guidance/);
    bad({ sections: [{ ...IRB_TEMPLATE.sections[0], required: "yes" }] }, /required/);
    assert.equal(parse_document_template(null).ok, false);
  });
});

describe("empty_document and migrate_document", () => {
  it("starts every section empty at revision 0", () => {
    const doc = empty_document(IRB_TEMPLATE, NOW);
    assert.equal(doc.template_id, "irb-test");
    assert.equal(doc.revision, 0);
    assert.deepEqual(Object.keys(doc.sections), ["aims", "notes"]);
    assert.deepEqual(doc.sections.aims, {
      content: "", status: SectionStatus.EMPTY, source: SectionSource.ASSISTANT, updated_at: NOW,
    });
  });

  it("adds sections the template gained and drops ones it lost, keeping content and revision", () => {
    const stale = {
      template_id: "irb-test",
      revision: 4,
      sections: {
        aims: { content: "Aim 1", status: SectionStatus.DRAFT, source: SectionSource.USER, updated_at: NOW },
        gone: { content: "old", status: SectionStatus.COMPLETE, source: SectionSource.ASSISTANT, updated_at: NOW },
      },
    };
    const doc = migrate_document(IRB_TEMPLATE, stale, "later");
    assert.equal(doc.revision, 4);
    assert.deepEqual(Object.keys(doc.sections), ["aims", "notes"]);
    assert.equal(doc.sections.aims.content, "Aim 1");
    assert.equal(doc.sections.notes.status, SectionStatus.EMPTY);
    assert.equal(doc.sections.notes.updated_at, "later");
  });
});

describe("parse_document_state", () => {
  it("round-trips a saved document", () => {
    const doc = empty_document(IRB_TEMPLATE, NOW);
    assert.deepEqual(parse_document_state(JSON.parse(JSON.stringify(doc))), { ok: true, value: doc });
  });

  it("refuses a malformed one", () => {
    assert.equal(parse_document_state({ template_id: "x", revision: -1, sections: {} }).ok, false);
    assert.equal(parse_document_state({ template_id: "x", revision: 0, sections: { a: { content: 1 } } }).ok, false);
    assert.equal(parse_document_state({
      template_id: "x", revision: 0,
      sections: { a: { content: "", status: "weird", source: "user", updated_at: NOW } },
    }).ok, false);
  });
});

describe("apply_section_update", () => {
  it("replaces one section and leaves the revision alone", () => {
    const before = empty_document(IRB_TEMPLATE, NOW);
    const after = apply_section_update(before, {
      section_id: "aims", content: "Aim 1", status: SectionStatus.COMPLETE, source: SectionSource.USER,
    }, "later");
    assert.equal(after.revision, 0);
    assert.deepEqual(after.sections.aims, {
      content: "Aim 1", status: SectionStatus.COMPLETE, source: SectionSource.USER, updated_at: "later",
    });
    assert.equal(after.sections.notes, before.sections.notes);
    // Pure: the input is untouched.
    assert.equal(before.sections.aims.content, "");
  });
});

describe("rendering for the model", () => {
  it("renders the template with ids and whether each section is required", () => {
    const text = render_template_guidance(IRB_TEMPLATE);
    assert.match(text, /^# Test Protocol/);
    assert.match(text, /### Specific aims \(id: aims, required\)\nThe aims\./);
    assert.match(text, /### Reviewer notes \(id: notes, optional\)\nFlags\./);
  });

  it("renders the document with status and author, and marks empty sections", () => {
    const doc = apply_section_update(empty_document(IRB_TEMPLATE, NOW), {
      section_id: "aims", content: "Aim 1", status: SectionStatus.DRAFT, source: SectionSource.USER,
    }, NOW);
    const text = render_document(IRB_TEMPLATE, doc);
    assert.match(text, /### Specific aims \(id: aims\)\nStatus: draft\. Last written by the user, directly in the document at /);
    assert.match(text, /Aim 1/);
    assert.match(text, /### Reviewer notes \(id: notes\)\nStatus: empty\n\n\(nothing written yet\)/);
  });
});
