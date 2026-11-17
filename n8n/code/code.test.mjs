// Unit tests for the Code node sources. Run with: node --test n8n/code
// n8n executes a Code node's source as a function body with $json, $env and $() in scope;
// the harness below does the same, so these tests exercise the exact code n8n runs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const here = new URL(".", import.meta.url);
const samples = JSON.parse(readFileSync(new URL("../../samples/leads.json", import.meta.url), "utf8"));

function node(file) {
  const source = readFileSync(new URL(file, here), "utf8");
  const fn = new Function("$json", "$env", "$", source);
  return (json, { env = {}, nodes = {} } = {}) =>
    fn(json, env, (name) => ({ item: { json: nodes[name] } })).json;
}

const validate = node("validate-lead.js");
const classify = node("rules-classifier.js");
const buildRequest = node("build-claude-request.js");
const parse = node("parse-classification.js");
const decide = node("decide-route.js");

test("validation normalises fields and collects every error", () => {
  const ok = validate({ body: { name: " Ann ", email: "ANN@Example.com", message: " Hi " } });
  assert.equal(ok.valid, true);
  assert.equal(ok.email, "ann@example.com");
  assert.equal(ok.source, "website");

  const bad = validate({ body: { email: "nope", message: "" } });
  assert.equal(bad.valid, false);
  assert.deepEqual(bad.errors, ["message is required", "email is not valid"]);
});

for (const sample of samples.filter((s) => s.expect.status === 200)) {
  test(`rules classifier + routing: ${sample.name}`, () => {
    const lead = validate({ body: sample.payload });
    const routed = decide(classify(lead, { env: { LEADFLOW_COMPANY: "Acme" } }));
    for (const [key, value] of Object.entries(sample.expect)) {
      if (key !== "status") assert.equal(routed[key], value, `${key} for "${sample.name}"`);
    }
    assert.equal(routed.classifier, "rules");
    assert.equal(JSON.parse(routed.raw).category, routed.category);
    if (routed.category === "spam") assert.equal(routed.draft_reply, "");
    else assert.match(routed.draft_reply, /Acme/);
  });
}

test("budget parsing handles k-suffixes, separators and euros", () => {
  const budget = (message) => classify(validate({ body: { name: "A", message } })).budget_usd;
  assert.equal(budget("Our budget is $12k for the project"), 12000);
  assert.equal(budget("Budget: USD 4,500 for the website"), 4500);
  assert.equal(budget("We can spend €5.000 on the redesign"), 5400);
  assert.equal(budget("Need a quote for a website"), null);
});

test("the Claude request enforces the JSON schema and opts into fallbacks", () => {
  const { lead, request } = buildRequest({ name: "Ann", email: "a@b.co", company: "", message: "Hi" });
  assert.equal(lead.name, "Ann");
  assert.equal(request.model, "claude-opus-5-5");
  assert.equal(request.fallbacks, "default");
  assert.equal(request.output_config.format.type, "json_schema");
  const schema = request.output_config.format.schema;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
  assert.match(request.messages[0].content, /<lead>/);
  assert.match(request.system, /untrusted sender/);
  assert.equal(buildRequest({}, { env: { LEADFLOW_MODEL: "claude-sonnet-5-5" } }).request.model, "claude-sonnet-5-5");
});

test("parsing reads the text block and keeps the lead", () => {
  const classification = { category: "support", urgency: "medium", budget_usd: null, language: "en", summary: "s", draft_reply: "d" };
  const response = {
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(classification) }],
  };
  const nodes = { "Build Claude request": { lead: { name: "Ann", message: "Hi" } } };
  const result = parse(response, { nodes });
  assert.equal(result.name, "Ann");
  assert.equal(result.category, "support");
  assert.equal(result.classifier, "claude-opus-5-5");
});

test("parsing fails loudly on refusals, truncation, API errors and non-JSON", () => {
  const nodes = { "Build Claude request": { lead: {} } };
  assert.throws(() => parse({ stop_reason: "refusal", content: [] }, { nodes }), /declined/);
  assert.throws(() => parse({ stop_reason: "max_tokens", content: [] }, { nodes }), /cut off/);
  assert.throws(() => parse({ type: "error", error: { message: "invalid x-api-key" } }, { nodes }), /invalid x-api-key/);
  assert.throws(
    () => parse({ stop_reason: "end_turn", content: [{ type: "text", text: "Sure!" }] }, { nodes }),
    /Expected JSON/,
  );
});

test("routing threshold is configurable", () => {
  const lead = { category: "sales_inquiry", urgency: "medium", budget_usd: 3000 };
  assert.equal(decide(lead).route, "reply");
  assert.equal(decide(lead, { env: { LEADFLOW_HIGH_VALUE_USD: "2500" } }).route, "alert");
});

test("summaries skip greetings", () => {
  const lead = validate({ body: { name: "Maya", message: "Hi! We need a new website for our clinic. Thanks." } });
  assert.equal(classify(lead).summary, "Sales inquiry from Maya: We need a new website for our clinic.");
});
