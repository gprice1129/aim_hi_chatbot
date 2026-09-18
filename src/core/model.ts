export {
  ModelMessage,
  ModelEffortScale,
  ModelEffort,
  ModelThinkingMode,
  ModelThinking,
  ModelCacheTtl,
  ModelCaching,
  ModelOutputLimit,
  ModelOpts,
  ModelStream,
  Model,
}

import { Anthropic } from "@anthropic-ai/sdk";
import { Memory } from "#core/memory.js";
import { Tool, ToolCall, ToolResult } from "#core/tool.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines what a model is to the rest of the package: the options a
 * caller may set on a turn, the stream a caller observes it through, and the
 * operations every model answers. None of it names a provider. A provider's
 * implementation translates each of these into its own API.
 */

// A message as the provider returns it. Still the Anthropic shape: the
// operations below read it, so a caller never has to.
type ModelMessage = Anthropic.Message;

// How hard the model tries, where a model offers the choice.
enum ModelEffortScale {
  Low = "low",
  Medium = "medium",
  High = "high",
  Max = "max",
}

type ModelEffort = ModelEffortScale | null;

enum ModelThinkingMode {
  Adaptive = "adaptive",
  Enabled = "enabled",
  Disabled = "disabled",
}

// Whether and how the model reasons before answering. null leaves it unset;
// which modes a model accepts is the provider's to check.
type ModelThinking =
  | { type: ModelThinkingMode.Adaptive }
  | { type: ModelThinkingMode.Enabled, budget_tokens: number }
  | { type: ModelThinkingMode.Disabled }
  | null;

enum ModelCacheTtl {
  FiveMinutes = "5m",
  OneHour = "1h",
}

// How long the request prefix may be cached; null disables caching.
type ModelCaching = ModelCacheTtl | null;

// Hard cap on output tokens (thinking + text) per response.
type ModelOutputLimit = number;

// What a host can observe and control while a model generates one turn.
interface ModelStream {
  // Receives each piece of reply text as the model writes it.
  on_delta: (delta: string) => void;
  // Aborts the turn. The provider call rejects, and the rejection is the host's
  // to classify.
  abort_signal: AbortSignal;
}

/*
 * Idea: How one turn should be generated.
 */
interface ModelOpts {
  // Present, the reply is produced as it is written and each piece reaches
  // on_delta; absent, it is generated whole and seen only as the message.
  stream?: ModelStream;
  system_prompt?: string;
  tools?: Tool[];
  effort?: ModelEffort;
  thinking?: ModelThinking;
  caching?: ModelCaching;
  max_tokens?: ModelOutputLimit;
}

interface Model {
  str_to_memory(arg0: string): Memory;
  gen_message(arg0: Memory[], arg1: ModelOpts): Promise<ModelMessage>;
  extract_content(arg0: ModelMessage): string[] | false;
  // Whether this turn is a request to run tools rather than a reply.
  wants_tools(arg0: ModelMessage): boolean;
  // Requested tools this turn.
  extract_tool_calls(arg0: ModelMessage): ToolCall[];
  // The assistant turn as a Memory, so its tool requests can be replayed. A
  // provider requires its own tool request back in the transcript before it
  // will accept the matching results.
  msg_to_memory(arg0: ModelMessage): Memory;
  // Tool results as the next Memory to send.
  tool_results_to_memory(arg0: ToolResult[]): Memory;
}
