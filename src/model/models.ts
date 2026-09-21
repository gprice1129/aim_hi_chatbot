export {
  ModelProfile,
  ModelParams,
  default_model_params,
  make_model,
}

import { Endpoint } from "#core/types.js";
import {
  Model,
  ModelEffort,
  ModelEffortScale,
  ModelThinking,
  ModelThinkingMode,
  ModelCaching,
  ModelOutputLimit,
} from "#core/model.js";
import {
  AnthropicModel,
  AnthropicModelType,
} from "#model/anthropic.js";

/*
 * A named, provider-agnostic model configuration. Profiles describe the kind of
 * model wanted by capability
 */
enum ModelProfile {
  // Cheap, low-latency conversational model.
  Fast = "fast",
  // Capable conversational model, for chat that must follow tool directives.
  Chat = "chat",
  // Heavy reasoning model with a large output budget for one-shot analysis.
  Deep = "deep",
  // Cheap model with a small output cap for out-of-band chat summarization
  Summary = "summary",
}

// Generation parameters for a model; null leaves a parameter unset so it is
// omitted from API requests.
interface ModelParams {
  effort: ModelEffort;
  thinking: ModelThinking;
  caching: ModelCaching;
  max_tokens: ModelOutputLimit;
}

const _PROFILE_TYPE: Record<ModelProfile, AnthropicModelType> = {
  [ModelProfile.Fast]: AnthropicModelType.Haiku,
  [ModelProfile.Chat]: AnthropicModelType.Opus,
  [ModelProfile.Deep]: AnthropicModelType.Opus,
  [ModelProfile.Summary]: AnthropicModelType.Haiku,
};

const _PROFILE_PARAMS: Record<ModelProfile, ModelParams> = {
  [ModelProfile.Fast]: {
    effort: null, thinking: null, caching: null, max_tokens: 8192 },
  [ModelProfile.Chat]: {
    effort: null,
    thinking: { type: ModelThinkingMode.Adaptive },
    caching: null, max_tokens: 8192 },
  [ModelProfile.Deep]: {
    effort: ModelEffortScale.Max,
    thinking: null, caching: null, max_tokens: 16384 },
  [ModelProfile.Summary]: {
    effort: null, thinking: null, caching: null, max_tokens: 512 },
};

/*
 * (ModelProfile) => ModelParams
 * The default generation parameters for a profile.
 * Pure
 * Public
 */
function default_model_params(profile: ModelProfile): ModelParams {
  return { ..._PROFILE_PARAMS[profile] };
}

/*
 * (Endpoint, ModelProfile, ModelParams?) => Model
 * Pure
 * Public
 */
function make_model(
    endpoint: Endpoint,
    profile: ModelProfile,
    params: ModelParams = _PROFILE_PARAMS[profile],
): Model {
  return new AnthropicModel(
    endpoint,
    _PROFILE_TYPE[profile],
    params.effort,
    params.max_tokens,
    params.thinking,
    params.caching,
  );
}
