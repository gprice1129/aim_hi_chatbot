export {
  render_document,
}

import {
  DocumentAuthor,
  type Document,
  type DocumentTemplate,
  type TemplateGuidance,
  type TemplateSection,
} from "common";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how a document is shown to a model: every section its
 * template names, in order, with what belongs in it, where it stands and who
 * last wrote it.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * The rendering is what a model reads to know what to write, what has been
 * written and by whom, so it can speak of the user's sections as the user's.
 * Rewording it may change model behaviour.
 */

/*
 * Idea: The document as text a model reads.
 *
 * (DocumentTemplate, TemplateGuidance, Document) => string
 * Sections the template does not name are left out.
 * Pure
 * Public
 */
function render_document(
    template: DocumentTemplate, guidance: TemplateGuidance, document: Document): string {
  return template.sections
    .map((section) => _render_section(section, guidance[section.id], document))
    .join("\n\n");
}

/*
 * (TemplateSection, string, Document) => string
 * Pure
 * Private
 */
function _render_section(section: TemplateSection, guidance: string, document: Document): string {
  const heading =
    `### ${section.title} (id: ${section.id}${section.required ? ", required" : ""})\n`
    + `Belongs here: ${guidance}`;
  if (!Object.hasOwn(document.sections, section.id)) {
    return `${heading}\nNot written yet.`;
  }
  const written = document.sections[section.id];
  return `${heading}\n`
    + `Status: ${written.status}. Last written by ${_author(written.written_by)} `
    + `at ${written.written_at}.\n\n`
    + written.text;
}

/*
 * (DocumentAuthor) => string
 * Pure
 * Private
 */
function _author(author: DocumentAuthor): string {
  switch (author) {
    case DocumentAuthor.USER: return "the user, directly in the document";
    case DocumentAuthor.ASSISTANT: return "you";
  }
}
