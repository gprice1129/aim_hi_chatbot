import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ToolRegistry, ToolParamType } from "#core/tool.js";
import type { Tool, ToolInput, ToolOutcome } from "#core/tool.js";

function stub(
    name: string,
    run: (input: ToolInput) => Promise<ToolOutcome>): Tool {
  return {
    name,
    description: `stub tool ${name}`,
    schema: {
      properties: {
        q: { type: ToolParamType.String, description: "a query" },
      },
      required: ["q"],
    },
    run,
  };
}

function ok(name: string): Tool {
  return stub(name, async (input) => ({ ok: true, value: JSON.stringify(input) }));
}

describe("ToolRegistry", () => {
  it("exposes its tools in registration order", () => {
    const registry = new ToolRegistry([ok("b"), ok("a")]);
    assert.deepEqual(registry.tools().map((t) => t.name), ["b", "a"]);
    assert.equal(registry.size(), 2);
    assert.equal(registry.get("a")?.name, "a");
    assert.equal(registry.get("nope"), null);
  });

  it("rejects duplicate tool names", () => {
    assert.throws(() => new ToolRegistry([ok("dup"), ok("dup")]), /duplicate tool name 'dup'/);
  });

  it("dispatches a call and tags the outcome with its id", async () => {
    const registry = new ToolRegistry([ok("echo")]);
    const result = await registry.run({ id: "toolu_1", name: "echo", input: { q: "hi" } });
    assert.deepEqual(result, { id: "toolu_1", ok: true, value: '{"q":"hi"}' });
  });

  it("turns an unknown tool name into a failed result naming what exists", async () => {
    const registry = new ToolRegistry([ok("kg_search"), ok("kg_get")]);
    const result = await registry.run({ id: "toolu_2", name: "kg_serch", input: {} });
    assert.equal(result.ok, false);
    assert.equal(result.id, "toolu_2");
    assert.match(result.ok ? "" : result.error, /Unknown tool 'kg_serch'/);
    assert.match(result.ok ? "" : result.error, /kg_search, kg_get/);
  });

  it("turns a throwing tool into a failed result rather than propagating", async () => {
    const registry = new ToolRegistry([
      stub("boom", async () => { throw new Error("disk on fire"); }),
    ]);
    const result = await registry.run({ id: "toolu_3", name: "boom", input: {} });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /Tool 'boom' failed: disk on fire/);
  });

  it("preserves request order across a batch", async () => {
    const registry = new ToolRegistry([ok("a"), ok("b"), ok("c")]);
    const results = await registry.run_all([
      { id: "1", name: "c", input: { q: "c" } },
      { id: "2", name: "a", input: { q: "a" } },
      { id: "3", name: "b", input: { q: "b" } },
    ]);
    assert.deepEqual(results.map((r) => r.id), ["1", "2", "3"]);
    assert.deepEqual(
      results.map((r) => (r.ok ? r.value : null)),
      ['{"q":"c"}', '{"q":"a"}', '{"q":"b"}']);
  });

  it("runs a batch concurrently", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const registry = new ToolRegistry([
      stub("waiter", async () => { await gate; return { ok: true, value: "waited" }; }),
      stub("opener", async () => { open(); return { ok: true, value: "opened" }; }),
    ]);
    const results = await registry.run_all([
      { id: "1", name: "waiter", input: {} },
      { id: "2", name: "opener", input: {} },
    ]);
    assert.deepEqual(results.map((r) => (r.ok ? r.value : null)), ["waited", "opened"]);
  });
});
