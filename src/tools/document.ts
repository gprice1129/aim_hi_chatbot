export {
  UpdateSectionTool,
}

import {
  ToolParamType,
  type Tool,
  type ToolInput,
  type ToolOutcome,
  type ToolSchema,
} from "#core/tool.js";
import { as_string, require_string } from "#core/tool_input.js";
import {
  DocumentAuthor,
  DocumentWriteError,
  SectionStatus,
  write_section,
  type Document,
  type DocumentTemplate,
  type Result,
} from "common";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how a document is offered to a model as one capability:
 * writing a section whole, as the assistant.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * The tool writes to its own copy of the document it was given, and keeps
 * nothing anywhere else. Whoever built the tool reads the copy back.
 *
 * The description and schema below are what a model reads to decide when and
 * how to write. Rewording them may change model behaviour.
 */

const UPDATE_SECTION = "update_section";

// The statuses the assistant may give. Only the user marks a section complete.
const _STATUSES: readonly SectionStatus[] = [
  SectionStatus.INCOMPLETE,
  SectionStatus.DRAFT,
  SectionStatus.NEEDS_REVIEW,
];

/*
 * Idea: The assistant's hand on one document that follows a template.
 */
class UpdateSectionTool implements Tool {
  public readonly name = UPDATE_SECTION;
  public readonly description: string;
  public readonly schema: ToolSchema;

  private _template: DocumentTemplate;
  private _document: Document;
  private _now: () => string;

  constructor(
      template: DocumentTemplate,
      document: Document,
      now: () => string = () => new Date().toISOString()) {
    this._template = template;
    this._document = document;
    this._now = now;
    this.description =
      "Write or rewrite one section of the document the user sees beside this "
      + "conversation. Call it as soon as you know enough to write a section, "
      + "and again whenever what you learn changes it. Pass the section's whole "
      + "text in markdown, not a change to it: what you pass replaces what is "
      + "there. Give the section's status: 'incomplete' while it has known "
      + "gaps, 'draft' once it is whole but unpolished, and 'needs_review' once "
      + "it is ready for the user to check. Only the user can mark a section "
      + "complete. Do not write facts the user has not given you; ask instead. "
      + "A section the user wrote themselves is theirs: rewrite it only when "
      + "they ask, or to fix something you have told them about.";
    this.schema = {
      properties: {
        section_id: {
          type: ToolParamType.String,
          description: "Which section to write.",
          choices: template.sections.map((section) => section.id),
        },
        content: {
          type: ToolParamType.String,
          description: "The section's full text, in markdown.",
        },
        status: {
          type: ToolParamType.String,
          description: `Where the section stands. Defaults to '${SectionStatus.DRAFT}'.`,
          choices: _STATUSES,
        },
      },
      required: ["section_id", "content"],
    };
  }

  /*
   * Idea: The document as the assistant has left it.
   *
   * (void) => Document
   * Pure
   * Public
   */
  public document(): Document {
    return this._document;
  }

  /*
   * Idea: Write one section as the assistant, against the copy held.
   *
   * (ToolInput) => ToolOutcome
   * Side Effect: replaces the copy held
   * Public
   */
  public async run(input: ToolInput): Promise<ToolOutcome> {
    const section_id = require_string(input, "section_id");
    if (!section_id.ok) return section_id;
    const content = require_string(input, "content");
    if (!content.ok) return content;
    const status = _read_status(input["status"]);
    if (!status.ok) return status;
    const written = write_section(this._template, this._document, {
      section_id: section_id.value,
      text: content.value,
      status: status.value,
      author: DocumentAuthor.ASSISTANT,
      revision: this._document.revision,
    }, this._now());
    if (!written.ok) {
      return { ok: false, error: this._refusal(written.error, section_id.value) };
    }
    this._document = written.value;
    return { ok: true, value: `Wrote '${section_id.value}' as ${status.value}.` };
  }

  /*
   * Idea: A refused write, in words a model can act on.
   *
   * (DocumentWriteError, string) => string
   * Pure
   * Private
   */
  private _refusal(error: DocumentWriteError, section_id: string): string {
    switch (error) {
      case DocumentWriteError.NOT_PERMITTED:
        return "This document is not yours to write. Tell the user what you would change.";
      case DocumentWriteError.NO_SUCH_SECTION: {
        const known = this._template.sections.map((section) => section.id).join(", ");
        return `Unknown section '${section_id}'. Sections: ${known}`;
      }
      case DocumentWriteError.STALE:
        return "The document changed while you were writing. Nothing was written.";
    }
  }
}

/*
 * Idea: The status a model gave, or a draft when it gave none.
 *
 * (unknown) => Result<SectionStatus>
 * Complete is refused in words that say whose call it is.
 * Pure
 * Private
 */
function _read_status(value: unknown): Result<SectionStatus> {
  const raw = as_string(value);
  if (null === raw || "" === raw.trim()) return { ok: true, value: SectionStatus.DRAFT };
  if (SectionStatus.COMPLETE === raw) {
    return {
      ok: false,
      error: "Only the user can mark a section complete. Use 'needs_review' to ask them to.",
    };
  }
  const found = _STATUSES.find((status) => status === raw);
  if (undefined === found) {
    return { ok: false, error: `'status' must be one of: ${_STATUSES.join(", ")}.` };
  }
  return { ok: true, value: found };
}
