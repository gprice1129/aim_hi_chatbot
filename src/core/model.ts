export {
  ModelMessage,
  ModelEffort,
  ModelOpts,
  Model,
}

import { Anthropic } from "@anthropic-ai/sdk";
import {
  AnthropicModelEffort,
  AnthropicModelOpts } from "#model/anthropic.js";
import { Memory } from "#core/memory.js";

type ModelMessage = Anthropic.Message;
type ModelEffort = AnthropicModelEffort;
type ModelOpts = AnthropicModelOpts;
interface Model {
  str_to_memory(arg0: string): Memory;
  gen_message(arg0: Memory[], arg1: ModelOpts): Promise<ModelMessage>;
  extract_content(arg0: ModelMessage): string[] | false;
}
