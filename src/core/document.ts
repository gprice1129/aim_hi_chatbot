export {
  SectionStatus,
  SectionSource,
  parse_document_template,
  parse_document_state,
  empty_document,
  migrate_document,
  apply_section_update,
  render_template_guidance,
  render_document,
}
export type {
  DocumentTemplate,
  TemplateSection,
  DocumentState,
  SectionState,
  SectionUpdate,
}

import { is_boolean, is_object, is_string, type Result } from "common";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * A document built in a guided conversation is a fixed list of sections, named
 * by a template, each holding markdown the model or the user wrote. The
 * template says what the sections are and what belongs in each; the state says
 * what has been written so far and by whom.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * Templates are content: JSON files read once at startup and validated here,
 * so a bot built later can trust its template. The state lives with the chat
 * and is read back every turn. Rendering turns both into the text the model
 * reads in its system prompt.
 */

enum SectionStatus {
  EMPTY = "empty",
  DRAFT = "draft",
  COMPLETE = "complete",
}

// Who last wrote a section.
enum SectionSource {
  ASSISTANT = "assistant",
  USER = "user",
}

/*
 * Idea: One section of the template.
 *
 * `model_guidance` is written for the model: what belongs here and what to
 * ask. `user_placeholder` is what a person sees while the section is empty.
 */
interface TemplateSection {
  id: string;
  title: string;
  required: boolean;
  model_guidance: string;
  user_placeholder?: string;
}

interface DocumentTemplate {
  id: string;
  title: string;
  sections: TemplateSection[];
}

interface SectionState {
  // Markdown.
  content: string;
  status: SectionStatus;
  source: SectionSource;
  updated_at: string;
}

/*
 * Idea: The document as it stands.
 *
 * `revision` counts saves; a write that names a stale revision is refused, so
 * two writers cannot silently overwrite each other.
 */
interface DocumentState {
  template_id: string;
  revision: number;
  sections: Record<string, SectionState>;
}

/*
 * Idea: One section rewritten whole.
 */
interface SectionUpdate {
  section_id: string;
  content: string;
  status: SectionStatus.DRAFT | SectionStatus.COMPLETE;
  source: SectionSource;
}

const TEMPLATE_ID = /^[a-z0-9-]+$/;
const SECTION_ID = /^[a-z0-9_]+$/;

/*
 * Idea: A template as authored, or the first thing wrong with it.
 *
 * (unknown) => Result<DocumentTemplate>
 * Section ids are the names the model calls the tool with, so they are kept
 * simple and unique.
 * Pure
 * Public
 */
function parse_document_template(value: unknown): Result<DocumentTemplate> {
  if (!is_object(value)) return { ok: false, error: "template must be an object" };
  const { id, title, sections } = value as Record<string, unknown>;
  if (!is_string(id) || !TEMPLATE_ID.test(id)) {
    return { ok: false, error: "template id must be lowercase letters, digits and dashes" };
  }
  if (!is_string(title) || "" === title.trim()) {
    return { ok: false, error: `template ${id}: title must be a non-empty string` };
  }
  if (!Array.isArray(sections) || 0 === sections.length) {
    return { ok: false, error: `template ${id}: sections must be a non-empty array` };
  }
  const parsed: TemplateSection[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of sections.entries()) {
    const section = _parse_section(raw, `template ${id}: section ${index}`);
    if (!section.ok) return section;
    if (seen.has(section.value.id)) {
      return { ok: false, error: `template ${id}: duplicate section id '${section.value.id}'` };
    }
    seen.add(section.value.id);
    parsed.push(section.value);
  }
  return { ok: true, value: { id, title, sections: parsed } };
}

function _parse_section(raw: unknown, where: string): Result<TemplateSection> {
  if (!is_object(raw)) return { ok: false, error: `${where}: must be an object` };
  const { id, title, required, model_guidance, user_placeholder } = raw as Record<string, unknown>;
  if (!is_string(id) || !SECTION_ID.test(id)) {
    return { ok: false, error: `${where}: id must be lowercase letters, digits and underscores` };
  }
  if (!is_string(title) || "" === title.trim()) {
    return { ok: false, error: `${where} (${id}): title must be a non-empty string` };
  }
  if (!is_boolean(required)) {
    return { ok: false, error: `${where} (${id}): required must be a boolean` };
  }
  if (!is_string(model_guidance) || "" === model_guidance.trim()) {
    return { ok: false, error: `${where} (${id}): model_guidance must be a non-empty string` };
  }
  if (undefined !== user_placeholder && !is_string(user_placeholder)) {
    return { ok: false, error: `${where} (${id}): user_placeholder must be a string` };
  }
  const section: TemplateSection = { id, title, required, model_guidance };
  if (undefined !== user_placeholder) section.user_placeholder = user_placeholder;
  return { ok: true, value: section };
}

/*
 * Idea: A stored state read back, or what is wrong with it.
 *
 * (unknown) => Result<DocumentState>
 * Strict about shape, not about the template: `migrate_document` reconciles
 * the sections with the template afterwards.
 * Pure
 * Public
 */
function parse_document_state(value: unknown): Result<DocumentState> {
  if (!is_object(value)) return { ok: false, error: "document must be an object" };
  const { template_id, revision, sections } = value as Record<string, unknown>;
  if (!is_string(template_id)) return { ok: false, error: "document template_id must be a string" };
  if (!Number.isInteger(revision) || (revision as number) < 0) {
    return { ok: false, error: "document revision must be a non-negative integer" };
  }
  if (!is_object(sections)) return { ok: false, error: "document sections must be an object" };
  const parsed: Record<string, SectionState> = {};
  for (const [id, raw] of Object.entries(sections as Record<string, unknown>)) {
    if (!is_object(raw)) return { ok: false, error: `document section ${id}: must be an object` };
    const { content, status, source, updated_at } = raw as Record<string, unknown>;
    if (!is_string(content)) return { ok: false, error: `document section ${id}: content must be a string` };
    if (!_is_status(status)) return { ok: false, error: `document section ${id}: unknown status` };
    if (!_is_source(source)) return { ok: false, error: `document section ${id}: unknown source` };
    if (!is_string(updated_at)) return { ok: false, error: `document section ${id}: updated_at must be a string` };
    parsed[id] = { content, status, source, updated_at };
  }
  return { ok: true, value: { template_id, revision: revision as number, sections: parsed } };
}

function _is_status(value: unknown): value is SectionStatus {
  return (Object.values(SectionStatus) as unknown[]).includes(value);
}

function _is_source(value: unknown): value is SectionSource {
  return (Object.values(SectionSource) as unknown[]).includes(value);
}

/*
 * (DocumentTemplate, string) => DocumentState
 * Every section present and empty, at revision 0.
 * Pure
 * Public
 */
function empty_document(template: DocumentTemplate, now: string): DocumentState {
  const sections: Record<string, SectionState> = {};
  for (const section of template.sections) {
    sections[section.id] = _empty_section(now);
  }
  return { template_id: template.id, revision: 0, sections };
}

/*
 * (DocumentTemplate, DocumentState, string) => DocumentState
 * The state reconciled with the template: sections the template gained are
 * added empty, sections it dropped are removed, template order is kept.
 * Content and revision are untouched.
 * Pure
 * Public
 */
function migrate_document(
    template: DocumentTemplate, document: DocumentState, now: string): DocumentState {
  const sections: Record<string, SectionState> = {};
  for (const section of template.sections) {
    sections[section.id] = document.sections[section.id] ?? _empty_section(now);
  }
  return { template_id: template.id, revision: document.revision, sections };
}

/*
 * (DocumentState, SectionUpdate, string) => DocumentState
 * The document with one section rewritten. The revision is the caller's to
 * bump when it saves.
 * Pure
 * Public
 */
function apply_section_update(
    document: DocumentState, update: SectionUpdate, now: string): DocumentState {
  return {
    ...document,
    sections: {
      ...document.sections,
      [update.section_id]: {
        content: update.content,
        status: update.status,
        source: update.source,
        updated_at: now,
      },
    },
  };
}

/*
 * (DocumentTemplate) => string
 * The template as the model reads it: each section's id, title, whether it is
 * required, and what belongs in it.
 * Pure
 * Public
 */
function render_template_guidance(template: DocumentTemplate): string {
  const parts = template.sections.map((section) =>
    `### ${section.title} (id: ${section.id}, ${section.required ? "required" : "optional"})\n`
    + section.model_guidance);
  return `# ${template.title}\n\n${parts.join("\n\n")}`;
}

/*
 * (DocumentTemplate, DocumentState) => string
 * The document as the model reads it: every section in template order with
 * its status, who last wrote it, and its text.
 * Pure
 * Public
 */
function render_document(template: DocumentTemplate, document: DocumentState): string {
  const parts = template.sections.map((section) => {
    const state = document.sections[section.id];
    if (undefined === state || SectionStatus.EMPTY === state.status) {
      return `### ${section.title} (id: ${section.id})\nStatus: empty\n\n(nothing written yet)`;
    }
    const by = SectionSource.USER === state.source
      ? "the user, directly in the document" : "you";
    return `### ${section.title} (id: ${section.id})\n`
      + `Status: ${state.status}. Last written by ${by} at ${state.updated_at}.\n\n`
      + state.content;
  });
  return parts.join("\n\n");
}

function _empty_section(now: string): SectionState {
  return {
    content: "",
    status: SectionStatus.EMPTY,
    source: SectionSource.ASSISTANT,
    updated_at: now,
  };
}
