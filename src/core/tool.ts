export {
  ToolParamType,
  ToolRegistry,
}
export type {
  ToolParam,
  ToolSchema,
  ToolInput,
  ToolCall,
  ToolOutcome,
  ToolResult,
  Tool,
}

import type { Result } from "common";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines the application vocabulary of tool use. A tool is a
 * named capability to be exposed to a model and used as the model sees fit.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * A bot has access to tools through the ToolRegistry which defines what tools
 * the bot is allowed to use. The registry's Tools are exposed to the bot's
 * underlying model on each generation call, allowing the model to make
 * decisions about tool usage.
 *
 * A Model implementation is the adapter between the application's tool
 * vocabulary and a provider's, and it translates in both directions. Outbound,
 * a Model renders a Tool's ToolSchema into the provider's schema format, and a
 * ToolResult into the answer shape the provider expects. Inbound, a Model reads
 * the provider's response into ToolCalls.
 *
 * A ToolSchema travels outward only. No code here checks an arriving ToolCall
 * against the ToolSchema that declared the Tool.
 */

/*
 * Idea: Responsible for calling tools and ensuring a something the caller can
 * use is returned.
 */
class ToolRegistry {
  private _tools: Map<string, Tool>;

  constructor(tools: Tool[] = []) {
    this._tools = new Map();
    for (const tool of tools) {
      if (this._tools.has(tool.name)) {
        throw new Error(`ToolRegistry: duplicate tool name '${tool.name}'`);
      }
      this._tools.set(tool.name, tool);
    }
  }

  /*
   * Idea: Get all registered tools
   *
   * (void) => Tool[]
   * Pure
   * Public
   */
  public tools(): Tool[] {
    return [...this._tools.values()];
  }

  /*
   * Idea: Get the number of registered tools
   *
   * (void) => number
   * Pure
   * Public
   */
  public size(): number {
    return this._tools.size;
  }

  /*
   * Idea: Get a specific tool by name
   *
   * (string) => Tool | null
   * Pure
   * Public
   */
  public get(name: string): Tool | null {
    return this._tools.get(name) ?? null;
  }

  /*
   * Idea: Execute a single requested tool call
   *
   * (ToolCall) => ToolResult
   * An unknown name or a tool that throws both become a failed ToolResult so a
   * bad call costs the model a turn rather than ending the conversation.
   * Side Effect: runs the tool, which may perform I/O
   * Public
   */
  public async run(call: ToolCall): Promise<ToolResult> {
    const tool = this.get(call.name);
    if (null === tool) {
      const known = [...this._tools.keys()].join(", ");
      return {
        id: call.id,
        ok: false,
        error: `Unknown tool '${call.name}'. Available tools: ${known}`,
      };
    }
    try {
      const outcome = await tool.run(call.input);
      return { id: call.id, ...outcome };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        id: call.id,
        ok: false,
        error: `Tool '${call.name}' failed: ${reason}`
      };
    }
  }

  /*
   * Idea: Execute multiple requested tool calls
   *
   * (ToolCall[]) => ToolResult[]
   * Execute a turn's calls concurrently, preserving request order in the
   * results. Providers may request several tools in one turn, and they are
   * independent by construction.
   * Side Effect: runs the tools, which may perform I/O
   * Public
   */
  public async run_all(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.run(call)));
  }
}

/*
 * Idea: A single requested tool call from a model.
 *
 * `id` correlates the result back to this request and is minted by the provider
 */
interface ToolCall {
  id: string;
  name: string;
  input: ToolInput;
}

/*
 * Idea: A ToolOutcome tagged with the call it answers.
 */
type ToolResult = ToolOutcome & { id: string };

/*
 * Idea: A capability a model may request.
 *
 * A Tool declares what it is called, what it does, and the shape of its
 * arguments only. Tool call specifics are not defined here.
 *
 * A tool never throws and instead returns failures as values.
 */
interface Tool {
  // The name the model calls. Must be unique within a registry.
  name: string;
  // Reasoned over by the model
  description: string;
  schema: ToolSchema;
  run(input: ToolInput): Promise<ToolOutcome>;
}

/*
 * Idea: Received input for a tool call.
 *
 * Values are untrusted so the tool should validate before use.
 */
type ToolInput = Record<string, unknown>;

/*
 * Idea: The output from a tool call.
 *
 * The value is the text the model will read.
 */
type ToolOutcome = Result<string>;

/*
 * Idea: The advertised shape of tool input.
 */
interface ToolSchema {
  properties: Record<string, ToolParam>;
  required: string[];
}

/*
 * Idea: A single advertised parameter of a tool.
 */
interface ToolParam {
  type: ToolParamType;
  // Written for the model, not for a developer: it is the only instruction the
  // model gets about what to put here.
  description: string;
  // Restricts a String parameter to a fixed set of values.
  choices?: readonly string[];
  // Element type; required when type is Array, ignored otherwise.
  items?: ToolParam;
}

/*
 * Idea: Allowed set of types of a tool parameter.
 */
enum ToolParamType {
  String = "string",
  Number = "number",
  Integer = "integer",
  Boolean = "boolean",
  Array = "array",
}
