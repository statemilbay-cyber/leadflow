// Code node "Validate lead" (run once for each item).
// Normalises the webhook payload and lists every validation problem at once.
const body = $json.body ?? {};
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const lead = {
  name: text(body.name, 200),
  email: text(body.email, 320).toLowerCase(),
  company: text(body.company, 200),
  message: text(body.message, 5000),
  source: text(body.source, 100) || "website",
};

const errors = [];
if (!lead.message) errors.push("message is required");
if (!lead.name && !lead.email) errors.push("name or email is required");
if (lead.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) errors.push("email is not valid");

return { json: { ...lead, valid: errors.length === 0, errors } };
