export {
  ModelMessage,
  ModelEffort,
  ModelThinking,
  ModelCaching,
  ModelOutputLimit,
  ModelOpts,
  Model,
}
export {
  AnthropicModelEffortScale as ModelEffortScale,
  AnthropicModelThinkingMode as ModelThinkingMode,
  AnthropicModelCacheTtl as ModelCacheTtl,
} from "#model/anthropic.js";

import { Anthropic } from "@anthropic-ai/sdk";
import {
  AnthropicModelEffort,
  AnthropicModelThinking,
  AnthropicModelCaching,
  AnthropicModelOutputLimit,
  AnthropicModelOpts } from "#model/anthropic.js";
import { Memory } from "#core/memory.js";
import { ToolCall, ToolResult } from "#core/tool.js";

type ModelMessage = Anthropic.Message;
type ModelEffort = AnthropicModelEffort;
type ModelThinking = AnthropicModelThinking;
type ModelCaching = AnthropicModelCaching;
type ModelOutputLimit = AnthropicModelOutputLimit;
type ModelOpts = AnthropicModelOpts;

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
