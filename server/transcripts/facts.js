'use strict';

const { splitSentences } = require('./chunker');
const { classifyTopics } = require('./topics');

const FORWARD_RX = /\b(?:expect(?:s|ed)?|anticipat(?:e|es|ed)|guidance|outlook|forecast|next quarter|next year|full year|going forward|we will|we plan|we intend|target(?:s|ed)?|project(?:s|ed)?)\b/i;
const CHANGE_RX = /\b(?:grew|growth|increase[ds]?|decrease[ds]?|decline[ds]?|improv(?:e|ed|ing)|expand(?:ed|ing)?|compress(?:ed|ion)?|accelerat(?:e|ed|ing)|slowed?|exceeded|missed|reached|surpassed)\b/i;
const BOILERPLATE_RX = /\b(?:forward-looking statements?|safe harbor|non-gaap|reconciliation|sec filings?|conference (?:has now ended|is being recorded))\b/i;
const METRIC_RX = /(?:[$€£]\s?\d[\d,.]*(?:\s?(?:million|billion|trillion))?|\b\d+(?:\.\d+)?\s?(?:%|basis points?|bps|x|times|million|billion|trillion|thousand|gigawatts?|megawatts?|kilowatts?|tokens?|customers?|users?|seats?|devices?|years?|months?))(?=\s|[.,;:)]|$)/gi;

function metricType(value) {
  const text = value.toLowerCase();
  if (/[$€£]|million|billion|trillion/.test(text)) return 'currency_or_scale';
  if (/%/.test(text)) return 'percentage';
  if (/basis points|bps/.test(text)) return 'basis_points';
  if (/\b(?:x|times)\b/.test(text)) return 'multiple';
  if (/gigawatts?|megawatts?|kilowatts?/.test(text)) return 'capacity';
  if (/years?|months?/.test(text)) return 'time';
  return 'operating_metric';
}

function extractMetrics(text) {
  const matches = String(text || '').match(METRIC_RX) || [];
  return [...new Set(matches.map(value => value.trim()))].map(value => ({
    value,
    type: metricType(value),
  }));
}

function extractFacts(enrichment) {
  const facts = [];

  for (const chunk of enrichment.chunks || []) {
    if (chunk.role === 'Operator') continue;
    let factInChunk = 0;
    for (const sentence of splitSentences(chunk.text)) {
      if (BOILERPLATE_RX.test(sentence)) continue;
      const metrics = extractMetrics(sentence);
      const forwardLooking = FORWARD_RX.test(sentence);
      const classification = classifyTopics(sentence);
      const hasTopic = classification.primaryTopic !== 'Other';
      const materialChange = CHANGE_RX.test(sentence) && hasTopic;
      if (!metrics.length && !(forwardLooking && hasTopic) && !materialChange) continue;

      factInChunk += 1;
      const confidence = metrics.length && hasTopic
        ? 'High'
        : metrics.length || (forwardLooking && hasTopic)
        ? 'Medium'
        : 'Low';
      facts.push({
        id: `${chunk.id}-f${factInChunk}`,
        chunkId: chunk.id,
        ticker: chunk.ticker,
        quarter: chunk.quarter,
        year: chunk.year,
        fiscal_period: chunk.fiscal_period,
        topic: classification.primaryTopic === 'Other' ? chunk.topic : classification.primaryTopic,
        topics: classification.topics.length ? classification.topics : chunk.topics,
        statement: sentence,
        speaker: chunk.speaker,
        title: chunk.title,
        role: chunk.role,
        section: chunk.section,
        kind: chunk.kind,
        sourceBlockId: chunk.sourceBlockId,
        confidence,
        forwardLooking,
        metrics,
        sentiment: chunk.tone?.composite || null,
      });
    }
  }

  const topics = new Map();
  for (const fact of facts) topics.set(fact.topic, (topics.get(fact.topic) || 0) + 1);
  return {
    facts,
    factSummary: {
      total: facts.length,
      highConfidence: facts.filter(fact => fact.confidence === 'High').length,
      forwardLooking: facts.filter(fact => fact.forwardLooking).length,
      withMetrics: facts.filter(fact => fact.metrics.length).length,
      topics: [...topics.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
    },
  };
}

module.exports = {
  extractFacts,
  extractMetrics,
  metricType,
};
