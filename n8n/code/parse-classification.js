// Code node "Parse classification" (run once for each item).
// Turns the Messages API response into a classified lead. Throwing sends the execution to
// the error workflow, which records it in the workflow_errors table.
const response = $json;
const { lead } = $("Build Claude request").item.json;

if (response.type === "error") {
  throw new Error(`Anthropic API error: ${response.error?.message ?? "unknown"}`);
}
if (response.stop_reason === "refusal") {
  throw new Error("The model declined to classify this lead");
}
if (response.stop_reason === "max_tokens") {
  throw new Error("The classification was cut off (max_tokens)");
}

// Thinking and fallback blocks may precede the answer; only text blocks carry the JSON.
const text = (response.content ?? [])
  .filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("");

let classification;
try {
  classification = JSON.parse(text);
} catch {
  throw new Error(`Expected JSON from the classifier, got: ${text.slice(0, 200)}`);
}

return { json: { ...lead, ...classification, classifier: response.model } };
