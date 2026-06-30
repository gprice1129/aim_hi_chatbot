export {
  ModelProfile,
  make_model,
}

import { Endpoint } from "#core/types.js";
import { Model } from "#core/model.js";
import {
  AnthropicModel,
  AnthropicModelType,
  AnthropicModelEffortScale,
} from "#model/anthropic.js";

/*
 * A named, provider-agnostic model configuration. Profiles describe the kind of
 * model wanted by capability
 */
enum ModelProfile {
  // Cheap, low-latency conversational model.
  Fast = "fast",
  // Heavy reasoning model with a large output budget for one-shot analysis.
  Deep = "deep",
  // Cheap model with a small output cap for out-of-band chat summarization
  Summary = "summary",
}

/*
 * (Endpoint, ModelProfile) => Model
 * Pure
 * Public
 */
function make_model(endpoint: Endpoint, profile: ModelProfile): Model {
  switch (profile) {
    case ModelProfile.Fast:
      return new AnthropicModel(endpoint, AnthropicModelType.Haiku, null, 2048);
    case ModelProfile.Deep:
      return new AnthropicModel(
        endpoint, AnthropicModelType.Opus, AnthropicModelEffortScale.Max, 16384);
    case ModelProfile.Summary:
      return new AnthropicModel(endpoint, AnthropicModelType.Haiku, null, 512);
  }
}
