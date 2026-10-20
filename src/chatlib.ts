/*
 * The exposed interface of the chatbot package.
 */

export {
  make_ally,
  ALLY_MODES,
} from "#bot/ally.js";

export {
  make_grant_reviewer,
  GrantReviewMode,
  GRANT_REVIEW_MODES,
} from "#bot/grant_reviewer.js";

export {
  make_document_builder,
  DOCUMENT_BUILDER_MODES,
} from "#bot/document_builder.js";

export type {
  DocumentBuilder,
} from "#bot/document_builder.js";

export {
  SectionStatus,
  SectionSource,
  parse_document_template,
  parse_document_state,
  empty_document,
  migrate_document,
  apply_section_update,
} from "#core/document.js";

export type {
  DocumentTemplate,
  TemplateSection,
  DocumentState,
  SectionState,
  SectionUpdate,
} from "#core/document.js";

export {
  UPDATE_SECTION,
} from "#tools/document.js";

export {
  make_chat_summarizer,
  CHAT_SUMMARY_MODES,
} from "#bot/chat_summarizer.js";

export type {
  ChatSummarizer,
} from "#bot/chat_summarizer.js";

export {
  load_prompts,
} from "#prompts/prompts.js";

export type {
  PromptRequirements,
} from "#prompts/prompts.js";

export type {
  PromptNode,
} from "#prompts/prompt_tree.js";

export {
  ToolRegistry,
} from "#core/tool.js";

export type {
  Tool,
} from "#core/tool.js";

export {
  make_knowledge_graph_tools,
} from "#tools/knowledge_graph.js";

export {
  BotFailure,
} from "#core/result.js";

export type {
  BotReply,
} from "#core/result.js";

export type {
  ReplyEvent,
  ReplyStream,
  ToolRound,
} from "#core/stream.js";

export {
  ModelProfile,
  make_model,
  default_model_params,
} from "#model/models.js";

export type {
  ModelParams,
} from "#model/models.js";

export {
  MockModel,
} from "#model/mock.js";

export {
  ModelEffortScale,
  ModelThinkingMode,
  ModelCacheTtl,
} from "#core/model.js";

export type {
  Model,
  ModelEffort,
  ModelThinking,
  ModelCaching,
} from "#core/model.js";

export type {
  Endpoint,
} from "#core/types.js";

export type {
  Memory,
} from "#core/memory.js";

export type {
  HistorySource,
  ProjectContextSource,
  ProjectContext,
} from "#core/context.js";
