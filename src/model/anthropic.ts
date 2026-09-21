export {
  AnthropicModelType,
  AnthropicModel,
}

import { Anthropic } from "@anthropic-ai/sdk";
import { Endpoint } from "#core/types.js";
import {
  Model,
  ModelEffort,
  ModelEffortScale,
  ModelThinking,
  ModelThinkingMode,
  ModelCaching,
  ModelCacheTtl,
  ModelOutputLimit,
  ModelOpts,
} from "#core/model.js";
import type { ReplyStream } from "#core/stream.js";
import { Memory } from "#core/memory.js";
import {
  ToolParamType,
  type Tool,
  type ToolCall,
  type ToolParam,
  type ToolResult,
} from "#core/tool.js";
import { as_tool_input } from "#core/tool_input.js";

enum AnthropicStopReason {
  END_TURN = 'end_turn',
  MAX_TOKENS = 'max_tokens',
  STOP_SEQ = 'stop_sequence',
  TOOL = 'tool_use',
}
enum AnthropicModelType {
  Haiku = "claude-haiku-4-5",
  Opus = "claude-opus-4-7",
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

// The API rejects thinking budgets below this floor.
const MIN_THINKING_BUDGET = 1024;

// The most output tokens a reply generated whole may ask for. The SDK refuses
// a non-streaming request it expects to run over ten minutes, and it expects
// 128,000 tokens an hour, so the cap is ten minutes' worth. A streamed reply
// has no such limit.
const MAX_WHOLE_REPLY_TOKENS = Math.floor(128_000 * 10 / 60);

// The generation parameters a request carries, every one resolved: the
// per-call option where set, the model's standing value otherwise.
type _AnthropicOpts = Required<Pick<ModelOpts, "effort"
                                               | "thinking"
                                               | "caching"
                                               | "max_tokens">>;

// One turn's request
type _AnthropicRequest =
  | { params: Anthropic.MessageCreateParamsNonStreaming; stream?: undefined }
  | { params: Anthropic.MessageCreateParamsStreaming; stream: ReplyStream };


class AnthropicModel implements Model {
  private _client: Anthropic;
  private _type: AnthropicModelType;
  private _effort: ModelEffort;
  private _thinking: ModelThinking;
  private _caching: ModelCaching;
  private _max_tokens: ModelOutputLimit;
  constructor(
      endpoint: Endpoint,
      type: AnthropicModelType,
      effort: ModelEffort = null,
      max_tokens: ModelOutputLimit,
      thinking: ModelThinking = null,
      caching: ModelCaching = null,
  ) {
    _validate_options(type, { effort, thinking, caching, max_tokens });
    this._client = new Anthropic({
      apiKey: endpoint.api_key,
      baseURL: endpoint.base_url,
    });
    this._type = type;
    this._effort = effort;
    this._thinking = thinking;
    this._caching = caching;
    this._max_tokens = max_tokens;
  }

  public str_to_memory(str: string): Memory {
    return {
      role: AnthropicRole.User,
      content: str,
    }
  }

  /*
   * (Memory[], ModelOpts) => ModelMessage
   * Generate one turn. Turn generation can be configured via ModelOpts.
   * Side Effect: network call to the provider; calls opts.stream.on_event
   * Public
   */
  public async gen_message(memories: Anthropic.MessageParam[],
                           opts: ModelOpts): Promise<Anthropic.Message> {
    const { params, stream } = this._to_request(memories, opts);
    if (undefined === stream) {
      return await this._client.messages.create(params);
    }
    // The host's abort signal is an SDK request option, not an API parameter.
    const request_opts = { signal: stream.abort_signal };
    const request = this._client.messages.stream(params, request_opts);
    request.on("text", (text) => stream.on_event({ type: "text", text }));
    return await request.finalMessage();
  }

  /*
   * (MessageParam[], ModelOpts) => _AnthropicRequest
   * The request the anthropic API accepts for one turn.
   * Pure
   * Private
   */
  private _to_request(memories: Anthropic.MessageParam[],
                      opts: ModelOpts): _AnthropicRequest {
    const base_opts: _AnthropicOpts = {
      effort:     opts.effort     ?? this._effort,
      thinking:   opts.thinking   ?? this._thinking,
      caching:    opts.caching    ?? this._caching,
      max_tokens: opts.max_tokens ?? this._max_tokens,
    };
    _validate_options(this._type, base_opts);
    const { effort, thinking, caching, max_tokens } = base_opts;
    // Only a whole reply is bound by the SDK's non-streaming limit, so the
    // check lives here, where whether the reply streams is known.
    if (undefined === opts.stream && max_tokens > MAX_WHOLE_REPLY_TOKENS) {
      throw new Error(
        `AnthropicModel config: a reply generated whole may not exceed `
        + `${MAX_WHOLE_REPLY_TOKENS} max_tokens, got ${max_tokens}; stream it or lower the cap`);
    }
    const tools = opts.tools ?? [];
    const base = {
      model: this._type,
      max_tokens,
      system: opts.system_prompt,
      ...(tools.length > 0 ? { tools: tools.map(_to_anthropic_tool) } : {}),
      ...(null !== effort ? { output_config: { effort: _to_anthropic_effort(effort) } } : {}),
      ...(null !== thinking ? { thinking: _to_anthropic_thinking(thinking) } : {}),
      // Top-level cache_control marks the last cacheable block of the request
      // prefix (system prompt + messages) for prompt caching.
      ...(null !== caching ? { cache_control: _to_anthropic_cache_control(caching) } : {}),
      messages: memories,
    };
    const stream = opts.stream;
    if (undefined === stream) return { params: { ...base, stream: false } };
    return { params: { ...base, stream: true }, stream };
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

  /*
   * (Anthropic.Message) => boolean
   * Whether the turn stopped to call tools rather than to reply.
   * Pure
   * Public
   */
  public wants_tools(msg: Anthropic.Message): boolean {
    return AnthropicStopReason.TOOL === msg.stop_reason;
  }

  /*
   * (Anthropic.Message) => ToolCall[]
   * The tool_use blocks of a turn, as provider-agnostic calls.
   * Pure
   * Public
   */
  public extract_tool_calls(msg: Anthropic.Message): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const block of msg.content) {
      if (AnthropicContentType.TOOL !== block.type) continue;
      calls.push({ id: block.id, name: block.name, input: as_tool_input(block.input) });
    }
    return calls;
  }

  /*
   * (Anthropic.Message) => Memory
   * The assistant turn, replayed verbatim. The API requires each tool_use block
   * to be present in the transcript before it will accept the tool_result that
   * answers it, so the whole content array is kept rather than just its text.
   * Pure
   * Public
   */
  public msg_to_memory(msg: Anthropic.Message): Memory {
    return {
      role: AnthropicRole.Assistant,
      content: msg.content as Anthropic.ContentBlockParam[],
    };
  }

  /*
   * (ToolResult[]) => Memory
   * Tool results as the user turn that answers a tool request. A failure is
   * sent as an is_error result so the model can see what went wrong to choose
   * a different call.
   * Pure
   * Public
   */
  public tool_results_to_memory(results: ToolResult[]): Memory {
    return {
      role: AnthropicRole.User,
      content: results.map((result): Anthropic.ToolResultBlockParam => ({
        type: "tool_result",
        tool_use_id: result.id,
        content: result.ok ? result.value : result.error,
        ...(result.ok ? {} : { is_error: true }),
      })),
    };
  }
}

/*
 * (AnthropicModelType, _AnthropicOpts) => void
 * Throws on parameter combinations the API is known to reject so
 * misconfiguration surfaces as a developer error at the call site instead of
 * an opaque 400 at request time.
 * Pure
 * Private
 */
function _validate_options(type: AnthropicModelType,
                           opts: _AnthropicOpts): void {
  const { effort, thinking, max_tokens } = opts;
  if (!Number.isInteger(max_tokens) || max_tokens < 1) {
    throw new Error(
      `AnthropicModel config: max_tokens must be a positive integer, got ${max_tokens}`);
  }
  if (null !== effort && AnthropicModelType.Haiku === type) {
    throw new Error(
      `AnthropicModel config: ${type} rejects the effort parameter; leave effort unset`);
  }
  if (null === thinking) return;
  switch (thinking.type) {
    case ModelThinkingMode.Adaptive:
      if (AnthropicModelType.Haiku === type) {
        throw new Error(
          `AnthropicModel config: ${type} does not support adaptive thinking; `
          + `use ${ModelThinkingMode.Enabled} with a budget_tokens`);
      }
      break;
    case ModelThinkingMode.Enabled:
      if (AnthropicModelType.Opus === type) {
        throw new Error(
          `AnthropicModel config: ${type} rejects budget_tokens thinking; `
          + `use ${ModelThinkingMode.Adaptive}`);
      }
      if (thinking.budget_tokens < MIN_THINKING_BUDGET) {
        throw new Error(
          `AnthropicModel config: thinking budget_tokens must be >= `
          + `${MIN_THINKING_BUDGET}, got ${thinking.budget_tokens}`);
      }
      if (thinking.budget_tokens >= max_tokens) {
        throw new Error(
          `AnthropicModel config: thinking budget_tokens `
          + `(${thinking.budget_tokens}) must be < max_tokens (${max_tokens})`);
      }
      break;
    case ModelThinkingMode.Disabled:
      break;
  }
}

/*
 * (ModelEffortScale) => OutputConfig["effort"]
 * Pure
 * Private
 */
function _to_anthropic_effort(
    effort: Exclude<ModelEffort, null>): NonNullable<Anthropic.OutputConfig["effort"]> {
  switch (effort) {
    case ModelEffortScale.Low: return "low";
    case ModelEffortScale.Medium: return "medium";
    case ModelEffortScale.High: return "high";
    case ModelEffortScale.Max: return "max";
  }
}

/*
 * (ModelCacheTtl) => CacheControlEphemeral
 * Pure
 * Private
 */
function _to_anthropic_cache_control(
    caching: Exclude<ModelCaching, null>): Anthropic.CacheControlEphemeral {
  switch (caching) {
    case ModelCacheTtl.FiveMinutes: return { type: "ephemeral", ttl: "5m" };
    case ModelCacheTtl.OneHour: return { type: "ephemeral", ttl: "1h" };
  }
}

/*
 * (ModelThinking) => ThinkingConfigParam
 * Pure
 * Private
 */
function _to_anthropic_thinking(
    thinking: Exclude<ModelThinking, null>): Anthropic.ThinkingConfigParam {
  switch (thinking.type) {
    case ModelThinkingMode.Adaptive: return { type: "adaptive" };
    case ModelThinkingMode.Enabled: return {
      type: "enabled",
      budget_tokens: thinking.budget_tokens
    };
    case ModelThinkingMode.Disabled: return { type: "disabled" };
  }
}
/*
 * (Tool) => Anthropic.Tool
 * Translate a Tool declaration into the API's tool schema.
 * Pure
 * Private
 */
function _to_anthropic_tool(tool: Tool): Anthropic.Tool {
  const properties: Record<string, unknown> = {};
  for (const [name, param] of Object.entries(tool.schema.properties)) {
    properties[name] = _tool_param_to_json_schema(param);
  }
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties,
      required: tool.schema.required,
    },
  };
}

/*
 * (ToolParam) => Record<string, unknown>
 * Translate one tool parameter into its JSON Schema fragment. An Array
 * parameter with no declared element type is left unconstrained rather than
 * guessed at.
 * Pure
 * Private
 */
function _tool_param_to_json_schema(param: ToolParam): Record<string, unknown> {
  return {
    type: param.type,
    description: param.description,
    ...(undefined !== param.choices ? { enum: param.choices } : {}),
    ...(ToolParamType.Array === param.type && undefined !== param.items
      ? { items: _tool_param_to_json_schema(param.items) }
      : {}),
  };
}
