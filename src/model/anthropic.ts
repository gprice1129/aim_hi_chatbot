export {
  AnthropicModelEffortScale,
  AnthropicModelEffort,
  AnthropicModelThinkingMode,
  AnthropicModelThinking,
  AnthropicModelCacheTtl,
  AnthropicModelCaching,
  AnthropicModelOutputLimit,
  AnthropicModelType,
  AnthropicModelOpts,
  AnthropicModel,
}

import { Anthropic } from "@anthropic-ai/sdk";
import { Endpoint } from "#core/types.js";
import { Model } from "#core/model.js";
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
enum AnthropicModelEffortScale {
  Low = "low",
  Medium = "medium",
  High = "high",
  Max = "max"
}
type AnthropicModelEffort = AnthropicModelEffortScale | null;
enum AnthropicModelThinkingMode {
  Adaptive = "adaptive",
  Enabled = "enabled",
  Disabled = "disabled",
}
// null omits the thinking parameter entirely. Which configs a model accepts
// varies by model; see validate_config.
type AnthropicModelThinking =
  | { type: AnthropicModelThinkingMode.Adaptive }
  | { type: AnthropicModelThinkingMode.Enabled, budget_tokens: number }
  | { type: AnthropicModelThinkingMode.Disabled }
  | null;
enum AnthropicModelCacheTtl {
  FiveMinutes = "5m",
  OneHour = "1h",
}
// Prompt-cache TTL for the request prefix; null disables caching.
type AnthropicModelCaching = AnthropicModelCacheTtl | null;
// Hard cap on output tokens (thinking + text) per response.
type AnthropicModelOutputLimit = number;
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
interface AnthropicModelOpts {
  effort?: AnthropicModelEffort;
  thinking?: AnthropicModelThinking;
  caching?: AnthropicModelCaching;
  system_prompt?: string;
  max_tokens?: AnthropicModelOutputLimit;
  tools?: Tool[];
}

// The API rejects thinking budgets below this floor.
const MIN_THINKING_BUDGET = 1024;

/*
 * (AnthropicModelType, AnthropicModelEffort, AnthropicModelThinking,
 *  AnthropicModelOutputLimit) => void
 * Throws on parameter combinations the API is known to reject, so
 * misconfiguration surfaces as a developer error at the call site instead of
 * an opaque 400 at request time.
 * Pure
 * Private
 */
function validate_config(
    type: AnthropicModelType,
    effort: AnthropicModelEffort,
    thinking: AnthropicModelThinking,
    max_tokens: AnthropicModelOutputLimit,
): void {
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
    case AnthropicModelThinkingMode.Adaptive:
      if (AnthropicModelType.Haiku === type) {
        throw new Error(
          `AnthropicModel config: ${type} does not support adaptive thinking; `
          + `use ${AnthropicModelThinkingMode.Enabled} with a budget_tokens`);
      }
      break;
    case AnthropicModelThinkingMode.Enabled:
      if (AnthropicModelType.Opus === type) {
        throw new Error(
          `AnthropicModel config: ${type} rejects budget_tokens thinking; `
          + `use ${AnthropicModelThinkingMode.Adaptive}`);
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
    case AnthropicModelThinkingMode.Disabled:
      break;
  }
}

class AnthropicModel implements Model {
  private _client: Anthropic;
  private _type: AnthropicModelType;
  private _effort: AnthropicModelEffort;
  private _thinking: AnthropicModelThinking;
  private _caching: AnthropicModelCaching;
  private _max_tokens: AnthropicModelOutputLimit;
  constructor(
      endpoint: Endpoint,
      type: AnthropicModelType,
      effort: AnthropicModelEffort = null,
      max_tokens: AnthropicModelOutputLimit,
      thinking: AnthropicModelThinking = null,
      caching: AnthropicModelCaching = null,
  ) {
    validate_config(type, effort, thinking, max_tokens);
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

  public async gen_message(memories: Anthropic.MessageParam[], opts: AnthropicModelOpts): Promise<Anthropic.Message> {
    // A null parameter is unset and must be omitted from the request: some
    // models reject parameters outright (e.g. Haiku rejects effort), so
    // "unset" cannot be expressed as a value on the wire.
    const effort = opts.effort ?? this._effort;
    const thinking = opts.thinking ?? this._thinking;
    const caching = opts.caching ?? this._caching;
    const max_tokens = opts.max_tokens ?? this._max_tokens;
    // Re-validate here: per-call opts can produce a combination the
    // constructor never saw.
    validate_config(this._type, effort, thinking, max_tokens);
    const tools = opts.tools ?? [];
    return await this._client.messages.create({
      model: this._type,
      max_tokens: max_tokens,
      system: opts.system_prompt,
      ...(tools.length > 0 ? { tools: tools.map(_to_anthropic_tool) } : {}),
      ...(null !== effort ? { output_config: { effort } } : {}),
      ...(null !== thinking ? { thinking } : {}),
      // Top-level cache_control marks the last cacheable block of the request
      // prefix (system prompt + messages) for prompt caching.
      ...(null !== caching
        ? { cache_control: { type: "ephemeral", ttl: caching } }
        : {}),
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
 * (Tool) => Anthropic.Tool
 * Translate a Tool declaration into the API's tool schema.
 * Pure
 * Private
 */
function _to_anthropic_tool(tool: Tool): Anthropic.Tool {
  const properties: Record<string, unknown> = {};
  for (const [name, param] of Object.entries(tool.schema.properties)) {
    properties[name] = _to_json_schema(param);
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
 * Translate one parameter into its JSON Schema fragment. An Array parameter
 * with no declared element type is left unconstrained rather than guessed at.
 * Pure
 * Private
 */
function _to_json_schema(param: ToolParam): Record<string, unknown> {
  return {
    type: param.type,
    description: param.description,
    ...(undefined !== param.choices ? { enum: param.choices } : {}),
    ...(ToolParamType.Array === param.type && undefined !== param.items
      ? { items: _to_json_schema(param.items) }
      : {}),
  };
}
