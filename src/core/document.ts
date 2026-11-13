export {
  render_document,
}

import {
  DocumentAuthor,
  type Document,
  type DocumentTemplate,
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
 * (DocumentTemplate, Document) => string
 * Sections the template does not name are left out.
 * Pure
 * Public
 */
function render_document(template: DocumentTemplate, document: Document): string {
  return template.sections
    .map((section) => _render_section(section, document))
    .join("\n\n");
}

/*
 * (TemplateSection, Document) => string
 * Pure
 * Private
 */
function _render_section(section: TemplateSection, document: Document): string {
  const { id, title, required } = section.metadata;
  const heading =
    `### ${title} (id: ${id}${required ? ", required" : ""})\n`
    + `Belongs here: ${section.guidance.model}`;
  if (!Object.hasOwn(document.sections, id)) {
    return `${heading}\nNot written yet.`;
  }
  const written = document.sections[id];
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
