import assert from "node:assert/strict"
import test from "node:test"

import { strip } from "../index.mjs"

test("a plain request is returned untouched", () => {
  const body = JSON.stringify({
    model: "gpt-6.1-sol",
    input: [{ role: "user", content: "hi" }],
  })
  const r = strip(body)
  assert.equal(r.stripped, 0)
  assert.equal(r.body, body)
})

test("previous_response_id and item ids go", () => {
  const r = strip(JSON.stringify({
    model: "gpt-6.1-sol",
    previous_response_id: "resp_abc",
    input: [
      { type: "message", id: "msg_1", role: "user", content: "hi" },
      { type: "message", id: "msg_2", role: "assistant", content: "yo" },
    ],
  }))
  assert.equal(r.stripped, 3)
  const j = JSON.parse(r.body)
  assert.equal("previous_response_id" in j, false)
  assert.deepEqual(j.input.map((i) => i.id), [undefined, undefined])
  // content survives
  assert.deepEqual(j.input.map((i) => i.content), ["hi", "yo"])
})

test("encrypted reasoning is dropped, call_id and tool args survive", () => {
  const r = strip(JSON.stringify({
    input: [
      { type: "reasoning", id: "rs_1", encrypted_content: "gAAA", summary: [] },
      { type: "function_call", id: "fc_1", call_id: "call_9", name: "read", arguments: '{"p":1}' },
      { type: "function_call_output", call_id: "call_9", output: "ok" },
    ],
  }))
  const j = JSON.parse(r.body)
  assert.equal(j.input.length, 2)
  assert.equal(j.input[0].type, "function_call")
  assert.equal(j.input[0].call_id, "call_9")
  assert.equal(j.input[0].arguments, '{"p":1}')
  assert.equal(j.input[1].call_id, "call_9")
})

test("a reasoning item emptied by the strip is removed", () => {
  const j = JSON.parse(strip(JSON.stringify({
    input: [{ type: "reasoning", id: "rs_1", encrypted_content: "gAAA" }],
  })).body)
  assert.deepEqual(j.input, [])
})

test("a reasoning item with a summary stays", () => {
  const j = JSON.parse(strip(JSON.stringify({
    input: [{ type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "t" }] }],
  })).body)
  assert.equal(j.input.length, 1)
  assert.equal("id" in j.input[0], false)
})

test("non-JSON bodies are left alone", () => {
  const r = strip("not json at all")
  assert.equal(r.stripped, 0)
  assert.equal(r.body, "not json at all")
})

test("nothing to strip still reports zero", () => {
  const r = strip(JSON.stringify({ model: "m", input: "plain string input" }))
  assert.equal(r.stripped, 0)
})
