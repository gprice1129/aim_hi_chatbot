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
  Text = "text",
  Document = "document",
}
interface AnthropicModelOpts {
  effort: AnthropicModelEffort;
  system_prompt: string;
  max_tokens: number;
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
}
