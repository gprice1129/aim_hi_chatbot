import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { make_knowledge_graph_tools, KG_SEARCH, KG_GET } from "#tools/knowledge_graph.js";
import type { Tool, ToolInput } from "#core/tool.js";
import {
  NODE_TYPES,
  NODE_LEVELS,
  NODE_STATUSES,
  NODE_AUDIENCES,
  NODE_RELATIONS,
  type GraphNode,
  type SearchFilters,
  type KnowledgeGraphSource,
} from "knowledge_graph";

const NODES: GraphNode[] = [
  {
    id: "hallucinated-citations",
    title: "Fabricated citations",
    summary: "Language models invent plausible-looking references.",
    type: "risk",
    level: "foundational",
    draft: false,
    deprecated: false,
    audiences: ["researcher", "clinician"],
    aliases: ["fake references", "bogus citations"],
    edges: {
      parent: ["m03-evaluating-ai-output"],
      governed_by: ["phi-and-hipaa-in-ai-tools"],
    },
    body: "# Fabricated citations\n\n## How it shows up\nA cited paper does not exist.",
  },
  {
    id: "transcribing-audio",
    title: "Transcribing audio",
    summary: "Turning recorded speech into text you can search and quote.",
    type: "skill",
    level: "applied",
    draft: false,
    deprecated: false,
    audiences: ["researcher", "developer"],
    aliases: ["transcription"],
    edges: {
      uses_tool: ["whisper"],
      governed_by: ["phi-and-hipaa-in-ai-tools"],
    },
    body: "# Transcribing audio\n\n## How it is done\nRun the recording through a speech model.",
  },
  {
    id: "whisper",
    title: "Whisper",
    summary: "An open-weight speech-to-text model used for transcription.",
    type: "tool",
    level: "applied",
    draft: false,
    deprecated: false,
    audiences: ["developer"],
    aliases: ["speech to text"],
    edges: { parent: ["m07-media"] },
    body: "# Whisper\n\nA transcription model that runs on audio locally.",
  },
  {
    id: "phi-and-hipaa-in-ai-tools",
    title: "PHI and HIPAA in AI tools",
    summary: "Which patient data may be sent to a third-party model.",
    type: "policy",
    level: "foundational",
    draft: false,
    deprecated: false,
    audiences: ["clinician", "researcher"],
    aliases: ["hipaa policy"],
    edges: {},
    body: "# PHI and HIPAA in AI tools\n\nPatient data must stay inside the approved boundary.",
  },
];

class FakeGraph implements KnowledgeGraphSource {
  public last_filters: SearchFilters = { limit: 0 };

  public async get(id: string): Promise<GraphNode | null> {
    return NODES.find((n) => n.id === id) ?? null;
  }

  public async search(query: string, filters: SearchFilters): Promise<GraphNode[]> {
    this.last_filters = filters;
    const wanted = query.toLowerCase();
    return NODES.filter((n) =>
      [n.title, n.summary, ...n.aliases].join(" ").toLowerCase().includes(wanted));
  }
}

const source = new FakeGraph();
const [search_tool, get_tool] = make_knowledge_graph_tools(source);

// Tools answer in JSON so the model gets an unambiguous structure; tests read
// it back the same way.
async function call(tool: Tool, input: ToolInput): Promise<any> {
  const outcome = await tool.run(input);
  assert.equal(outcome.ok, true, outcome.ok ? "" : `unexpected failure: ${outcome.error}`);
  return JSON.parse(outcome.ok ? outcome.value : "{}");
}

async function fails(tool: Tool, input: ToolInput): Promise<string> {
  const outcome = await tool.run(input);
  assert.equal(outcome.ok, false, "expected the call to fail");
  return outcome.ok ? "" : outcome.error;
}

describe("ontology terms the tools state to the model", () => {
  const VOCABULARY = new Set([
    ...NODE_TYPES, ...NODE_LEVELS, ...NODE_STATUSES,
    ...NODE_AUDIENCES, ...NODE_RELATIONS,
  ]);

  // Everywhere a tool addresses the model in prose.
  function prose(tool: Tool): string[] {
    const found = [tool.description];
    for (const param of Object.values(tool.schema.properties)) {
      found.push(param.description);
      if (undefined !== param.items) found.push(param.items.description);
    }
    return found;
  }

  it("quotes no term the ontology does not declare", () => {
    for (const tool of [search_tool, get_tool]) {
      for (const text of prose(tool)) {
        for (const [, term] of text.matchAll(/'([a-z][a-z_]*)'/g)) {
          assert.ok(VOCABULARY.has(term), `${tool.name}: undeclared term '${term}'`);
        }
      }
    }
  });

  it("names every relation a node may carry", () => {
    for (const relation of NODE_RELATIONS) {
      assert.ok(
        get_tool.description.includes(relation),
        `${KG_GET} does not name the '${relation}' relation`);
    }
  });
});

describe(KG_SEARCH, () => {
  it("returns summaries and never bodies", async () => {
    const result = await call(search_tool, { query: "fake references" });
    assert.equal(result.returned, result.hits.length);
    const [hit] = result.hits;
    assert.equal(hit.id, "hallucinated-citations");
    assert.deepEqual(
      Object.keys(hit).sort(),
      ["id", "level", "summary", "title", "type"]);
    assert.equal("body" in hit, false);
  });

  it("sends no relevance score to the model", async () => {
    const result = await call(search_tool, { query: "transcription" });
    assert.ok(result.hits.length > 0);
    assert.equal(result.hits.some((h: any) => "score" in h), false);
  });

  it("preserves the source's ranking order", async () => {
    const result = await call(search_tool, { query: "transcription" });
    const expected = await source.search("transcription", { limit: 8 });
    assert.ok(expected.length > 1, "fixture must match more than one node");
    assert.deepEqual(result.hits.map((h: any) => h.id), expected.map((n) => n.id));
  });

  it("rejects a missing or empty query", async () => {
    assert.match(await fails(search_tool, {}), /'query' is required/);
    assert.match(await fails(search_tool, { query: "   " }), /'query' is required/);
    assert.match(await fails(search_tool, { query: 42 }), /'query' is required/);
  });

  it("reports an empty result with a recoverable hint", async () => {
    const result = await call(search_tool, { query: "quantum chromodynamics" });
    assert.equal(result.returned, 0);
    assert.deepEqual(result.hits, []);
    assert.match(result.note, /broader or fewer terms/);
  });

  it("forwards filters, accepting a bare string where a list is declared", async () => {
    await call(search_tool, { query: "patient data", type: "policy" });
    assert.deepEqual(source.last_filters.types, ["policy"]);
    assert.equal(source.last_filters.levels, undefined);
    assert.equal(source.last_filters.audiences, undefined);
  });

  it("clamps the limit before it crosses the port", async () => {
    await call(search_tool, { query: "transcription" });
    assert.equal(source.last_filters.limit, 8);
    await call(search_tool, { query: "transcription", limit: 0 });
    assert.equal(source.last_filters.limit, 1);
    await call(search_tool, { query: "transcription", limit: 500 });
    assert.equal(source.last_filters.limit, 20);
  });
});

describe(KG_GET, () => {
  it("opens nodes with their body and edges", async () => {
    const result = await call(get_tool, { ids: ["transcribing-audio", "whisper"] });
    assert.deepEqual(result.nodes.map((n: any) => n.id), ["transcribing-audio", "whisper"]);
    const [skill] = result.nodes;
    assert.match(skill.body, /## How it is done/);
    assert.deepEqual(skill.edges.uses_tool, ["whisper"]);
    assert.deepEqual(skill.edges.governed_by, ["phi-and-hipaa-in-ai-tools"]);
    assert.equal("missing" in result, false);
  });

  it("projects only the ontology the model needs", async () => {
    const [node] = (await call(get_tool, { ids: ["hallucinated-citations"] })).nodes;
    assert.deepEqual(
      Object.keys(node).sort(),
      ["aliases", "audiences", "body", "edges", "id", "level",
       "title", "type"]);
    assert.equal("score" in node, false);
  });

  it("reports ids it could not resolve without failing the call", async () => {
    const result = await call(get_tool, { ids: ["whisper", "no-such-node"] });
    assert.deepEqual(result.nodes.map((n: any) => n.id), ["whisper"]);
    assert.deepEqual(result.missing, ["no-such-node"]);
  });

  it("returns nodes in the order they were requested", async () => {
    const result = await call(get_tool, { ids: ["whisper", "hallucinated-citations", "transcribing-audio"] });
    assert.deepEqual(
      result.nodes.map((n: any) => n.id),
      ["whisper", "hallucinated-citations", "transcribing-audio"]);
  });

  it("rejects a missing or malformed ids list", async () => {
    assert.match(await fails(get_tool, {}), /'ids' is required/);
    assert.match(await fails(get_tool, { ids: [] }), /'ids' is required/);
    assert.match(await fails(get_tool, { ids: 7 }), /'ids' is required/);
  });

  it("caps how many nodes one call opens and says what it ignored", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `filler-${i}`);
    const result = await call(get_tool, { ids: ["whisper", ...ids] });
    assert.equal(result.ignored.length, 3);
    assert.deepEqual(result.ignored, ["filler-9", "filler-10", "filler-11"]);
    assert.match(result.note, /at most 10 ids are opened per call/i);
  });
});
