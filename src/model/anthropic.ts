export {
  AnthropicModelEffortScale,
  AnthropicModelEffort,
  AnthropicModelType,
  AnthropicModelOpts,
  AnthropicModel,
}

import { Anthropic } from "@anthropic-ai/sdk";
import { APIKey } from "#core/types.js";
import { Model } from "#core/model.js";
import { Memory } from "#core/memory.js";

enum AnthropicStopReason {
  END_TURN = 'end_turn',
  MAX_TOKENS = 'max_tokens',
  STOP_SEQ = 'stop_sequence',
  TOOL = 'tool_use',
}
enum AnthropicModelEffortScale {
  Low = "low",
  Medium = "medium",
  High = "high",
  Max = "max"
}
type AnthropicModelEffort = AnthropicModelEffortScale | null;
enum AnthropicModelType {
  Haiku = "claude-haiku-4-5",
  Opus = "claude-opus-4-6",
  Sonnet = "claude-sonnet-4-6"
}
enum AnthropicRole {
  Assistant = "assistant",
  User = "user",
}
enum AnthropicContentType {
  TEXT = "text",
  TOOL = "tool_use",
}
interface AnthropicModelOpts {
  effort?: AnthropicModelEffort;
  system_prompt?: string;
  max_tokens?: number;
}

class AnthropicModel implements Model {
  private _client: Anthropic;
  private _type: AnthropicModelType;
  private _effort: AnthropicModelEffort;
  private _max_tokens: number;
  constructor(
      key: APIKey,
      type: AnthropicModelType,
      effort: AnthropicModelEffort = null,
      max_tokens: number = 1028,
  ) {
    this._client = new Anthropic({ apiKey: key });
    this._type = type;
    this._effort = effort;
    this._max_tokens = max_tokens;
  }

  public str_to_memory(str: string): Memory {
    return {
      role: AnthropicRole.User,
      content: str,
    }
  }

  public async gen_message(memories: Anthropic.MessageParam[], opts: AnthropicModelOpts): Promise<Anthropic.Message> {
    return await this._client.messages.create({
      model: this._type,
      max_tokens: opts.max_tokens ?? this._max_tokens,
      system: opts.system_prompt,
      output_config: { effort: opts.effort ?? this._effort ?? undefined },
      messages: memories,
    });
  }

  public extract_content(msg: Anthropic.Message): string[] | false {
    console.log(`Token usage metrics: ${JSON.stringify(msg.usage,null,2)}`);
    const stop_reason = msg.stop_reason;
    if (AnthropicStopReason.END_TURN !== stop_reason) {
      console.error(`Error: API message extraction failed. Stop reason: ${stop_reason}`);
      return false; 
    }
    const text_blocks = [];
    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i];
      if (AnthropicContentType.TEXT === block.type) {
        text_blocks.push(block.text);
      }
    }
    return text_blocks;
  }
}
