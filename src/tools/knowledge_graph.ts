export {
  make_knowledge_graph_tools,
  KnowledgeGraphSearchTool,
  KnowledgeGraphGetTool,
  KG_SEARCH,
  KG_GET,
}

import {
  ToolParamType,
  type Tool,
  type ToolInput,
  type ToolOutcome,
  type ToolSchema,
} from "#core/tool.js";
import { estimate_tokens, DEFAULT_CHARS_PER_TOKEN } from "#core/tokens.js";
import {
  as_integer,
  as_string_list,
  require_string,
  require_string_list,
} from "#core/tool_input.js";
import {
  type GraphNode,
  type KnowledgeGraphSource,
  NODE_TYPES,
  NODE_LEVELS,
  NODE_AUDIENCES,
  NODE_RELATIONS,
} from "knowledge_graph";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how a knowledge graph is offered to a model as two
 * capabilities:
 *   1. A search that returns compressed candidates
 *   2. An open that returns whole nodes.
 *
 * Keeping the two apart lets a model judge what is worth reading before paying
 * to read it.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * kg_search returns summaries only. A model reads those summaries, chooses ids
 * from them, then spends context on the full text kg_get returns for those ids.
 *
 * The descriptions and schemas below are what a model reads to make that
 * choice. Rewording a description may change model behaviour.
 *
 * Neither tool reads a corpus. A KnowledgeGraphSource supplies the GraphNodes,
 * and the composition root chooses which source. How that source stores and
 * ranks GraphNodes is invisible here.
 */

const KG_SEARCH = "kg_search";
const KG_GET = "kg_get";

/*
 * Idea: Construct the suite of knowledge graph tool serach based on a single
 * representation.
 *
 * (KnowledgeGraphSource) => Tool[]
 * Pure
 * Public
 */
function make_knowledge_graph_tools(source: KnowledgeGraphSource): Tool[] {
  return [
    new KnowledgeGraphSearchTool(source),
    new KnowledgeGraphGetTool(source),
  ];
}

/*
 * Idea: The model's entry into the graph. Match a query, answer with
 * summaries only.
 */
class KnowledgeGraphSearchTool implements Tool {
  public readonly name = KG_SEARCH;
  public readonly description =
    "Search the AI-literacy knowledge graph and return the best-matching nodes "
    + "as id, title, type, level and summary -- never full text. Each summary "
    + "is written as a compressed answer, so read the summaries and then call "
    + KG_GET + " on the ids worth opening. Search by what the user is actually "
    + "asking about, in their own words; the index matches alternate and "
    + "vendor names as well as titles. Use the filters to narrow by node type "
    + "(a risk, a policy, a worked case), by level, or by audience. Call this "
    + "before answering any question about AI tools, practices, risks or "
    + "institutional policy -- the graph is authoritative and overrides "
    + "general knowledge, especially for policy nodes.";
  public readonly schema: ToolSchema = {
    properties: {
      query: {
        type: ToolParamType.String,
        description:
          "What to look for, in natural language or as keywords. Prefer the "
          + "user's own wording, including any product name they used.",
      },
      type: {
        type: ToolParamType.Array,
        description:
          "Restrict to these node types. Omit to search everything. Use "
          + "'policy' for institutional rules, 'risk' for failure modes, "
          + "'case' for worked examples.",
        items: {
          type: ToolParamType.String,
          description: "A node type.",
          choices: NODE_TYPES
        },
      },
      level: {
        type: ToolParamType.Array,
        description:
          "Restrict to these difficulty levels. Omit to search all "
          + "levels.",
        items: {
          type: ToolParamType.String,
          description: "A level.",
          choices: NODE_LEVELS
        },
      },
      audience: {
        type: ToolParamType.Array,
        description:
          "Restrict to nodes written for these audiences. Omit unless the "
          + "user's role is known.",
        items: {
          type: ToolParamType.String,
          description: "An audience.",
          choices: NODE_AUDIENCES
        },
      },
      limit: {
        type: ToolParamType.Integer,
        description:
          `Maximum hits to return. Default ${_DEFAULT_LIMIT}, `
          + `maximum ${_MAX_LIMIT}.`,
      },
    },
    required: ["query"],
  };

  private _source: KnowledgeGraphSource;

  constructor(source: KnowledgeGraphSource) {
    this._source = source;
  }

  /*
   * Idea: Answer a query with candidates cheap enough to triage.
   *
   * (ToolInput) => ToolOutcome
   * Side Effect: queries the source, which may perform I/O
   * Public
   */
  public async run(input: ToolInput): Promise<ToolOutcome> {
    const query = require_string(input, "query");
    if (!query.ok) return query;
    const limit = Math.min(
      _MAX_LIMIT,
      Math.max(1, as_integer(input["limit"]) ?? _DEFAULT_LIMIT)
    );
    const hits = await this._source.search(query.value, {
      limit,
      types:     as_string_list(input["type"]) ?? undefined,
      levels:    as_string_list(input["level"]) ?? undefined,
      audiences: as_string_list(input["audience"]) ?? undefined,
    });

    if (0 === hits.length) {
      return {
        ok: true,
        value: JSON.stringify({
          query: query.value,
          returned: 0,
          hits: [],
          note:
            "No nodes matched. Try broader or fewer terms, drop any filters, "
            + "or search for the general topic rather than the specific phrasing.",
        }),
      };
    }
    return {
      ok: true,
      value: JSON.stringify({
        query: query.value,
        returned: hits.length,
        // The source ranks best-first and the order carries that ranking, so
        // no score is sent: its scale is the provider's, not the model's.
        hits: hits.map((node) => ({
          id:      node.id,
          title:   node.title,
          type:    node.type,
          level:   node.level,
          summary: node.summary,
        })),
      }),
    };
  }
}

/*
 * Idea: Open the nodes a model chose, answer with full text and edges.
 */
class KnowledgeGraphGetTool implements Tool {
  public readonly name = KG_GET;
  public readonly description =
    "Open knowledge-graph nodes by id and return their full text plus their "
    + `edges (${NODE_RELATIONS.join(", ")}). Use the ids returned by ` + KG_SEARCH
    + ". Request every id you need in one call. Follow the edges of what you "
    + "open: a skill's governed_by policies and warns_about risks are part of "
    + "a correct answer, not optional extras. Nodes of type 'case' "
    + "deliberately contain a worked failure alongside a good run -- read the "
    + "whole node before quoting any part of it, and never present the failed "
    + "run as guidance.";
  public readonly schema: ToolSchema = {
    properties: {
      ids: {
        type: ToolParamType.Array,
        description:
          `The node ids to open, as returned by ${KG_SEARCH}. At most `
          + `${_MAX_GET_IDS} per call.`,
        items: {
          type: ToolParamType.String,
          description: "A node id."
        },
      },
    },
    required: ["ids"],
  };

  private _source: KnowledgeGraphSource;

  constructor(source: KnowledgeGraphSource) {
    this._source = source;
  }

  /*
   * Idea: Answer with the whole of each node a model asked for.
   *
   * (ToolInput) => ToolOutcome
   * An id that resolves to nothing is reported rather than failing the call,
   * so a model can still use whatever did resolve.
   * Side Effect: queries the source, which may perform I/O
   * Public
   */
  public async run(input: ToolInput): Promise<ToolOutcome> {
    const ids = require_string_list(input, "ids", {
      hint: `Use the node ids returned by ${KG_SEARCH}.`,
    });
    if (!ids.ok) return ids;
    const requested = ids.value.slice(0, _MAX_GET_IDS);
    const ignored = ids.value.slice(_MAX_GET_IDS);
    const opened = await Promise.all(requested.map((id) => this._source.get(id)));
    const nodes = [];
    const missing: string[] = [];
    for (let i = 0; i < requested.length; i++) {
      const node = opened[i];
      if (null === node) {
        missing.push(requested[i]);
        continue;
      }
      nodes.push(_render(node));
    }
    return {
      ok: true,
      value: JSON.stringify({
        nodes,
        ...(missing.length > 0 ? { missing } : {}),
        ...(ignored.length > 0
          ? {
              ignored,
              note: `At most ${_MAX_GET_IDS} ids are opened per call; request the rest separately.`,
            }
          : {}),
      }),
    };
  }
}

// Stated to the model in the schema description below, so changing this
// changes what a model expects as well as what it gets.
const _DEFAULT_LIMIT = 8;
const _MAX_LIMIT = 20;
// More than this in one call is the model hedging rather than choosing; the
// extras are reported back so it can ask again if it meant them.
const _MAX_GET_IDS = 10;
// Bodies are authored at 200-800 words (cases up to 1500), so this clears a
// whole node with room to spare and only bites on an outlier.
const _MAX_BODY_TOKENS = 4_000;

/*
 * Idea: Narrow a node to what a model should spend reading.
 *
 * (GraphNode) => object
 * Pure
 * Private
 */
function _render(node: GraphNode): Record<string, unknown> {
  const truncated = estimate_tokens(node.body) > _MAX_BODY_TOKENS;
  const body = truncated
    ? node.body.slice(0, _MAX_BODY_TOKENS * DEFAULT_CHARS_PER_TOKEN)
      + `\n\n[…truncated: body exceeded ${_MAX_BODY_TOKENS} tokens…]`
    : node.body;
  return {
    id:      node.id,
    title:   node.title,
    type:    node.type,
    level:   node.level,
    ...(node.audiences.length > 0 ? { audiences: node.audiences } : {}),
    ...(node.aliases.length > 0 ? { aliases: node.aliases } : {}),
    ...(Object.keys(node.edges).length > 0 ? { edges: node.edges } : {}),
    body,
    ...(truncated ? { truncated: true } : {}),
  };
}
