export {
  UpdateSectionTool,
  UPDATE_SECTION,
}

import {
  ToolParamType,
  type Tool,
  type ToolInput,
  type ToolOutcome,
  type ToolSchema,
} from "#core/tool.js";
import { as_string, require_string } from "#core/tool_input.js";
import type { Result } from "common";
import {
  SectionSource,
  SectionStatus,
  apply_section_update,
  type DocumentState,
  type DocumentTemplate,
} from "#core/document.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * The one way a model writes into the document: rewriting a section whole.
 * The tool holds the working copy for the reply it serves; whoever built it
 * reads the result back when the reply is done.
 */

const UPDATE_SECTION = "update_section";

const _WRITABLE_STATUSES = [SectionStatus.DRAFT, SectionStatus.COMPLETE] as const;

class UpdateSectionTool implements Tool {
  public readonly name = UPDATE_SECTION;
  public readonly description: string;
  public readonly schema: ToolSchema;

  private _template: DocumentTemplate;
  private _document: DocumentState;
  private _changed: string[];
  private _now: () => string;

  constructor(
      template: DocumentTemplate,
      document: DocumentState,
      now: () => string = () => new Date().toISOString()) {
    this._template = template;
    this._document = document;
    this._changed = [];
    this._now = now;
    this.description =
      "Write or rewrite one section of the document the user sees beside this "
      + "conversation. Call it as soon as you know enough to write a section, "
      + "and again whenever what you learn changes it. Pass the section's whole "
      + "text in markdown, not a change to it: what you pass replaces what is "
      + "there. Mark a section 'draft' while it is thin or has open questions "
      + "and 'complete' once it would satisfy a careful reviewer. Do not write "
      + "facts the user has not given you; ask instead. A section the user wrote "
      + "themselves is theirs: rewrite it only when they ask, or to fix "
      + "something you have told them about.";
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
          description: "'draft' while thin or uncertain; 'complete' when it would satisfy a reviewer. Defaults to 'draft'.",
          choices: _WRITABLE_STATUSES,
        },
      },
      required: ["section_id", "content"],
    };
  }

  /*
   * (void) => DocumentState
   * The document with every update this tool has applied.
   * Pure
   * Public
   */
  public document(): DocumentState {
    return this._document;
  }

  /*
   * (void) => string[]
   * The ids of the sections written, in the order first written.
   * Pure
   * Public
   */
  public changed(): string[] {
    return [...this._changed];
  }

  /*
   * (ToolInput) => ToolOutcome
   * Side Effect: replaces the working copy
   * Public
   */
  public async run(input: ToolInput): Promise<ToolOutcome> {
    const section_id = require_string(input, "section_id");
    if (!section_id.ok) return section_id;
    const section = this._template.sections.find((s) => s.id === section_id.value);
    if (undefined === section) {
      const known = this._template.sections.map((s) => s.id).join(", ");
      return { ok: false, error: `Unknown section '${section_id.value}'. Sections: ${known}` };
    }
    const content = require_string(input, "content");
    if (!content.ok) return content;
    const status = _read_status(input["status"]);
    if (!status.ok) return status;
    this._document = apply_section_update(this._document, {
      section_id: section.id,
      content: content.value,
      status: status.value,
      source: SectionSource.ASSISTANT,
    }, this._now());
    if (!this._changed.includes(section.id)) this._changed.push(section.id);
    return {
      ok: true,
      value: `Wrote "${section.title}" as ${status.value}. The user can see it now.`,
    };
  }
}

function _read_status(value: unknown): Result<SectionStatus.DRAFT | SectionStatus.COMPLETE> {
  const raw = as_string(value);
  if (null === raw || "" === raw.trim()) return { ok: true, value: SectionStatus.DRAFT };
  const found = _WRITABLE_STATUSES.find((status) => status === raw);
  if (undefined === found) {
    return { ok: false, error: `'status' must be one of: ${_WRITABLE_STATUSES.join(", ")}.` };
  }
  return { ok: true, value: found };
}
