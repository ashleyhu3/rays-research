'use strict';

const AI = /\b(?:artificial intelligence|generative ai|genai|ai)\b/i;
const CLOUD = /\b(?:cloud|azure|google cloud|gcp|aws|amazon web services|oracle cloud|oci)\b/i;
const FORWARD = /\b(?:guidance|outlook|forecast|expect(?:s|ed)?|anticipat(?:e|es|ed)|next quarter|next year|full year|going forward|will (?:grow|increase|decrease|decline|remain|be)|plan(?:s|ned)? to)\b/i;
const GROWTH = /\b(?:growth|grew|grown|growing|increase[ds]?|accelerat(?:e|ed|ing|ion)|up \d+(?:\.\d+)?%|revenue)\b/i;
const REVENUE = /\b(?:revenue|sales|bookings|arr|annual recurring revenue|commercial rpo)\b/i;
const COST = /\b(?:cost|expense|spend|efficien(?:cy|t)|per dollar|economics)\b/i;

const TOPIC_RULES = [
  { topic: 'CapEx Guidance', all: [/\b(?:capex|capital expenditures?|capital spending)\b/i, FORWARD] },
  { topic: 'Cloud Guidance', all: [CLOUD, FORWARD] },
  { topic: 'AI Guidance', all: [AI, FORWARD] },
  { topic: 'Cloud Growth', all: [CLOUD, GROWTH] },
  { topic: 'AI Revenue', all: [AI, REVENUE] },
  { topic: 'Inference Cost', all: [/\binferenc(?:e|ing)\b/i, COST] },
  { topic: 'Enterprise AI', all: [/\benterprise(?:s)?\b/i, AI] },
  { topic: 'AI Customers', all: [AI, /\b(?:customers?|clients?|users?|adoption|seats|deploy(?:ed|ment|ments)?)\b/i] },
  { topic: 'AI Monetization', all: [AI, /\b(?:moneti[sz](?:e|ation|ing)|paid|pricing|commerciali[sz]|revenue per|subscription)\b/i] },
  { topic: 'AI Infrastructure', any: [/\bai (?:infrastructure|factory|capacity|compute|cluster|accelerator)\b/i, /\binfrastructure (?:for|to support) ai\b/i] },
  { topic: 'CapEx', any: [/\b(?:capex|capital expenditures?|capital spending)\b/i] },
  { topic: 'GPU', any: [/\b(?:gpus?|graphics processing units?|nvidia|gb200|gb300|h100|h200|blackwell|ai accelerators?)\b/i] },
  { topic: 'Datacenter', any: [/\bdata\s*cent(?:er|re)s?\b/i, /\bdatacenters?\b/i] },
  { topic: 'Inference', any: [/\binferenc(?:e|ing)\b/i] },
  { topic: 'Training', any: [/\b(?:pre-?training|post-?training|model training|training workloads?|train(?:ed|ing) models?)\b/i] },
  { topic: 'Azure', any: [/\bazure\b/i] },
  { topic: 'AWS', any: [/\b(?:aws|amazon web services)\b/i] },
  { topic: 'GCP', any: [/\b(?:gcp|google cloud platform|google cloud)\b/i] },
  { topic: 'OCI', any: [/\b(?:oci|oracle cloud infrastructure|oracle cloud)\b/i] },
  { topic: 'OpenAI', any: [/\bopenai\b/i, /\bchatgpt\b/i] },
  { topic: 'Anthropic', any: [/\banthropic\b/i, /\bclaude\b/i] },
  { topic: 'Gemini', any: [/\bgemini\b/i] },
  { topic: 'LLM', any: [/\b(?:llms?|large language models?|foundation models?|frontier models?)\b/i] },
  { topic: 'Tokens', any: [/\btokens?\b/i, /\btoken throughput\b/i] },
  { topic: 'Margins', any: [/\b(?:gross|operating|contribution) margins?\b/i, /\bmargin (?:expansion|compression|pressure|improvement)\b/i] },
  { topic: 'Energy', any: [/\b(?:energy|electricity|renewable|nuclear|solar|wind energy)\b/i] },
  { topic: 'Power', any: [/\b(?:power capacity|power grid|gigawatts?|megawatts?|watts?|power generation)\b/i] },
  { topic: 'Semiconductors', any: [/\b(?:semiconductors?|chips?|silicon|foundry|fabs?|custom asic|tpu)\b/i] },
  { topic: 'Networking', any: [/\b(?:networking|ethernet|infiniband|interconnects?|optical network|network infrastructure)\b/i] },
  { topic: 'Demand', any: [/\b(?:demand|consumption|bookings demand|customer demand)\b/i] },
  { topic: 'Supply', any: [/\b(?:supply|capacity constraint|constrained capacity|shortage|inventory)\b/i] },
  { topic: 'Pricing', any: [/\b(?:pricing|price increases?|price decreases?|average selling price|asps?)\b/i] },
];

const TOPICS = TOPIC_RULES.map(rule => rule.topic);

function matches(regex, text) {
  regex.lastIndex = 0;
  return regex.test(text);
}

function scoreRule(rule, text) {
  const allMatches = (rule.all || []).map(pattern => matches(pattern, text));
  if (allMatches.some(value => !value)) return null;
  const anyMatches = (rule.any || []).map(pattern => matches(pattern, text));
  if (rule.any?.length && !anyMatches.some(Boolean)) return null;

  const signals = allMatches.filter(Boolean).length + anyMatches.filter(Boolean).length;
  const specificity = (rule.all?.length || 0) * 2 + (rule.any?.length || 0);
  return {
    name: rule.topic,
    score: signals * 10 + specificity,
    confidence: Math.min(0.98, 0.58 + signals * 0.12 + (rule.all?.length || 0) * 0.05),
  };
}

function classifyTopics(text) {
  const value = String(text || '');
  const ranked = TOPIC_RULES
    .map(rule => scoreRule(rule, value))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || TOPICS.indexOf(a.name) - TOPICS.indexOf(b.name));

  return {
    primaryTopic: ranked[0]?.name || 'Other',
    confidence: ranked[0]?.confidence || 0,
    topics: ranked.map(result => result.name),
    scores: ranked,
  };
}

module.exports = { TOPICS, TOPIC_RULES, classifyTopics };
