export {
  ModelType,
  Chatbot
}

import { Anthropic } from "@anthropic-ai/sdk";

type APIKey = string;

enum ModelType {
  Haiku = "claude-haiku-4-5",
  Opus = "claude-opus-4-6",
  Sonnet = "claude-sonnet-4-6"
}

enum ModelEffortScale {
  Low = "low",
  Medium = "medium",
  High = "high",
  Max = "max"
}
type ModelEffort = ModelEffortScale | null;

enum AnthropicRole {
  Assistant = "assistant",
  User = "user"
}
interface StringRoleMap {
  [key: string]: AnthropicRole
}
const map_str_anthropic_role: StringRoleMap = Object.freeze({
  assistant: AnthropicRole.Assistant,
  user: AnthropicRole.User
});
function str_to_anthropic_role(str: string): AnthropicRole {
  const role = map_str_anthropic_role[str];
  if (role !== undefined) return role;
  throw new TypeError(`In src/chatbot.ts:str_to_anthropic_role:\n  No converstion from ${str} to AnthropicRole`);
}

interface ModelOpts {
  api_key: APIKey;
  model_type: ModelType;
  max_tokens: number
  system_prompt?: string;
}

class Model {
  private _type: string
  private _effort: ModelEffort;
  constructor(type: ModelType, effort: ModelEffort) {
    this._type = type;
    this._effort = effort;
  }

  public type() { return this._type };
  public effort() { return this._effort };
}

function make_model(type: ModelType) {
  switch(type) {
    case ModelType.Haiku: return new Model(type, null);
    case ModelType.Sonnet: return new Model(type, ModelEffortScale.Low);
    case ModelType.Opus: return new Model(type, ModelEffortScale.Low);
  }
}

class Chatbot {
  private _system_prompt: string | null;
  private _client: Anthropic;
  private _max_tokens: number;
  private _model: Model;
  private _messages: Anthropic.MessageParam[];

  constructor(opts: ModelOpts) {
    this._system_prompt = opts.system_prompt ?? null;
    this._max_tokens = opts.max_tokens;
    this._client = new Anthropic({ apiKey: opts.api_key });
    this._model = make_model(opts.model_type);
    this._messages = [];
  }

  private _create_msg(role: AnthropicRole, msg: string): Anthropic.MessageParam {
    return { role: role, content: msg };
  }

  private _extract_role(msg: Anthropic.Message): AnthropicRole {
    return str_to_anthropic_role(msg.role);
  }

  private _extract_content(msg: Anthropic.Message): string {
    for (const content of msg.content) {
      if (content.type === "text") {
        return content.text;
      }
    }
    return "";
  }

  public async send_recv_msg(user_msg: string): Promise<string> {
    this._messages.push(this._create_msg(AnthropicRole.User, user_msg));
    const model_msg = await this._client.messages.create({
      model: this._model.type(),
      max_tokens: this._max_tokens,
      system: this._system_prompt ?? undefined,
      output_config: { effort: this._model.effort() ?? undefined },
      messages: this._messages
    });
    const model_role = this._extract_role(model_msg);
    const model_content = this._extract_content(model_msg);
    this._messages.push(this._create_msg(model_role, model_content));
    console.log(this._messages);
    return model_content;
  }
}
