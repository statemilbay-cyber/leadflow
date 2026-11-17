// Code node "Decide route" (run once for each item).
// The routing rules live in one place, after either classifier:
//   spam                                        → archive
//   sales inquiry, urgent or budget ≥ threshold → alert (Telegram ping to the team)
//   everything else                             → reply (draft waits for a human)
const lead = $json;
const highValueUsd = Number($env.LEADFLOW_HIGH_VALUE_USD || 5000);

let route = "reply";
if (lead.category === "spam") {
  route = "archive";
} else if (
  lead.category === "sales_inquiry" &&
  (lead.urgency === "high" || (lead.budget_usd ?? 0) >= highValueUsd)
) {
  route = "alert";
}

const classification = {
  category: lead.category,
  urgency: lead.urgency,
  budget_usd: lead.budget_usd ?? null,
  language: lead.language,
  summary: lead.summary,
  draft_reply: lead.draft_reply,
  classifier: lead.classifier,
};

return { json: { ...lead, route, raw: JSON.stringify(classification) } };
