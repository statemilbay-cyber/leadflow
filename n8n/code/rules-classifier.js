// Code node "Rules classifier" (run once for each item). Used when LEADFLOW_MODE=mock.
// Deterministic, free and offline. It returns exactly the fields the Claude classifier
// returns, so everything downstream (routing, storage, alerts) behaves the same.
const lead = $json;
const company = $env.LEADFLOW_COMPANY || "Northwind Studio";
const text = `${lead.message} ${lead.company}`.toLowerCase();
const has = (pattern) => pattern.test(text);

function parseBudgetUsd(source) {
  const match = source.match(
    /(?:\$|usd\s?|€|eur\s?)\s?(\d[\d,.]*)\s?(k)?\b|(\d[\d,.]*)\s?(k)?\s?(?:usd|\$|€|eur|euros?|dollars?|долл)/i,
  );
  if (!match) return null;
  const digits = (match[1] ?? match[3]).replace(/[,.](?=\d{3}\b)/g, "").replace(",", ".");
  let value = Number.parseFloat(digits);
  if (Number.isNaN(value)) return null;
  if (match[2] || match[4]) value *= 1000;
  return Math.round(/€|eur/i.test(match[0]) ? value * 1.08 : value);
}

let category = "other";
if (has(/\b(seo|backlinks?|guest posts?|casino|betting|loan offer|rank (your|on) google|email list)\b/)) {
  category = "spam";
} else if (has(/\b(cv|resume|vacanc(y|ies)|open positions?|job|internship|hire me)\b|резюме|ваканси/)) {
  category = "job_application";
} else if (
  has(/\b(invoice|refund|bug|error|broken|not working|log ?in|password|support|outage)\b|сч[её]т|ошибк|не работает/)
) {
  category = "support";
} else if (has(/\b(partner(ship)?|resell(er|ing)|affiliate|white[- ]label|collaborat\w*)\b|партн[её]р/)) {
  category = "partnership";
} else if (
  has(
    /\b(quote|proposal|budget|pricing|price|estimate|project|website|store|shop|app|landing page|redesign|migrat\w*)\b|нужен|нужна|нужно|бюджет|сайт|лендинг|стоимост|разработ/,
  )
) {
  category = "sales_inquiry";
}

const budgetUsd = category === "spam" ? null : parseBudgetUsd(lead.message);
const urgent = has(
  /\b(asap|urgent(ly)?|today|tomorrow|this week|deadline|immediately|black friday)\b|срочно|сегодня|завтра|на этой неделе/,
);
let urgency = "low";
if (category !== "spam") {
  if (urgent || (budgetUsd ?? 0) >= 10000) urgency = "high";
  else if (category === "sales_inquiry" || category === "support") urgency = "medium";
}

const language = /[а-яё]/i.test(lead.message)
  ? "ru"
  : /[äöüß]|\b(und|nicht|wir|ich)\b/i.test(lead.message)
    ? "de"
    : "en";
const firstName = (lead.name || "").split(/\s+/)[0];

const LABELS = {
  sales_inquiry: "Sales inquiry",
  support: "Support request",
  partnership: "Partnership request",
  job_application: "Job application",
  spam: "Spam",
  other: "Message",
};
// Skip greetings such as "Hi!" or "Здравствуйте!": summarise with the first real sentence.
const sentences = lead.message.split(/(?<=[.!?])\s+/).filter(Boolean);
const gist = (sentences.find((s) => s.split(/\s+/).length >= 4) ?? sentences[0] ?? "").slice(0, 140);
const summary = `${LABELS[category]} from ${lead.name || lead.email}: ${gist}`;

const hi = firstName ? `Hi ${firstName}` : "Hi there";
const ru = firstName ? `Здравствуйте, ${firstName}!` : "Здравствуйте!";
const REPLIES = {
  en: {
    sales_inquiry: `${hi}, thanks for getting in touch about your project. Could you share your timeline and the must-have features? We'll come back with next steps within one business day.`,
    support: `${hi}, thanks for letting us know. We've logged the issue and a colleague will reply shortly.`,
    partnership: `${hi}, thanks for your interest in working together. Could you tell us a bit more about your clients and what you have in mind?`,
    job_application: `${hi}, thanks for your application. We'll review it and get back to you if there's a match.`,
    other: `${hi}, thanks for your message. A colleague will get back to you shortly.`,
  },
  ru: {
    sales_inquiry: `${ru} Спасибо за обращение. Подскажите, пожалуйста, сроки и обязательные требования к проекту — мы вернёмся с предложением в течение рабочего дня.`,
    support: `${ru} Спасибо, что сообщили. Мы зарегистрировали обращение, коллега скоро ответит.`,
    partnership: `${ru} Спасибо за интерес к сотрудничеству. Расскажите, пожалуйста, подробнее о ваших клиентах и идее.`,
    job_application: `${ru} Спасибо за отклик. Мы изучим резюме и свяжемся с вами, если будет подходящая позиция.`,
    other: `${ru} Спасибо за сообщение. Коллега скоро с вами свяжется.`,
  },
};
const signature = language === "ru" ? `\n\n— Команда ${company}` : `\n\n— ${company} team`;
const draftReply = category === "spam" ? "" : (REPLIES[language] ?? REPLIES.en)[category] + signature;

return {
  json: {
    ...lead,
    category,
    urgency,
    budget_usd: budgetUsd,
    language,
    summary,
    draft_reply: draftReply,
    classifier: "rules",
  },
};
