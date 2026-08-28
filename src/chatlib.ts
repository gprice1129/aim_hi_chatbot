/*
 * The exposed interface of the chatbot package.
 */

export {
  make_ally,
} from "#bot/ally.js";

export {
  make_grant_reviewer,
  GrantReviewMode,
} from "#bot/grant_reviewer.js";

export {
  make_chat_summarizer,
} from "#bot/chat_summarizer.js";

export type {
  ChatSummarizer,
} from "#bot/chat_summarizer.js";

export {
  BotFailure,
} from "#core/result.js";

export type {
  BotReply,
} from "#core/result.js";

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
