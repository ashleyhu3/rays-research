'use strict';

const { classifyTopics } = require('./topics');

const MIN_CHUNK_TOKENS = 80;
const MAX_CHUNK_TOKENS = 430;

function estimateTokens(text) {
  return (String(text || '').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[^\sA-Za-z0-9]/g) || []).length;
}

function splitSentences(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return [];
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    return [...segmenter.segment(value)].map(item => item.segment.trim()).filter(Boolean);
  }
  return value.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(item => item.trim()).filter(Boolean);
}

function splitOversizedSentence(sentence, maxTokens = MAX_CHUNK_TOKENS) {
  if (estimateTokens(sentence) <= maxTokens) return [sentence];
  const words = sentence.split(/\s+/);
  const parts = [];
  let current = [];
  for (const word of words) {
    if (current.length && estimateTokens([...current, word].join(' ')) > maxTokens) {
      parts.push(current.join(' '));
      current = [];
    }
    current.push(word);
  }
  if (current.length) parts.push(current.join(' '));
  return parts;
}

function semanticChunkDocument(document) {
  const chunks = [];

  for (const block of document.speaker_blocks || []) {
    const sentences = splitSentences(block.text).flatMap(sentence => splitOversizedSentence(sentence));
    let buffer = [];
    let bufferTokens = 0;
    let boundaryTopic = null;
    let chunkNumber = 0;

    const flush = () => {
      const text = buffer.join(' ').trim();
      buffer = [];
      bufferTokens = 0;
      boundaryTopic = null;
      if (!text) return;

      const classification = classifyTopics(text);
      chunkNumber += 1;
      chunks.push({
        id: `${document.ticker}-${document.fiscal_period}-b${block.id}-c${chunkNumber}`,
        ticker: document.ticker,
        quarter: document.quarter,
        year: document.year,
        fiscal_period: document.fiscal_period,
        speaker: block.speaker,
        title: block.title,
        role: block.role,
        section: block.section,
        kind: block.kind,
        timestamp: block.timestamp,
        sourceBlockId: block.id,
        chunkInBlock: chunkNumber,
        topic: classification.primaryTopic,
        topics: classification.topics,
        topicConfidence: Number(classification.confidence.toFixed(3)),
        tokenCount: estimateTokens(text),
        tokenCountMethod: 'deterministic_estimate',
        text,
      });
    };

    for (const sentence of sentences) {
      const sentenceTokens = estimateTokens(sentence);
      const sentenceTopic = classifyTopics(sentence).primaryTopic;
      const effectiveTopic = sentenceTopic === 'Other' ? boundaryTopic : sentenceTopic;
      const topicChanged = boundaryTopic
        && effectiveTopic
        && effectiveTopic !== boundaryTopic
        && bufferTokens >= MIN_CHUNK_TOKENS;
      const exceedsLimit = buffer.length && bufferTokens + sentenceTokens > MAX_CHUNK_TOKENS;

      if (topicChanged || exceedsLimit) flush();
      buffer.push(sentence);
      bufferTokens += sentenceTokens;
      if (sentenceTopic !== 'Other') boundaryTopic = sentenceTopic;
    }
    flush();
  }

  const topicCounts = new Map();
  for (const chunk of chunks) {
    for (const topic of chunk.topics) topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }
  const topicSummary = [...topicCounts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));

  return {
    schemaVersion: 1,
    ticker: document.ticker,
    quarter: document.quarter,
    year: document.year,
    fiscal_period: document.fiscal_period,
    sourceProvider: document.metadata?.provider || 'unknown',
    processedAt: new Date().toISOString(),
    chunking: {
      strategy: 'speaker_topic_paragraph',
      minTokens: MIN_CHUNK_TOKENS,
      maxTokens: MAX_CHUNK_TOKENS,
      tokenCountMethod: 'deterministic_estimate',
    },
    stats: {
      sourceBlocks: document.stats?.totalBlocks || document.speaker_blocks?.length || 0,
      chunks: chunks.length,
      taggedChunks: chunks.filter(chunk => chunk.topic !== 'Other').length,
      topics: topicSummary.length,
      tokens: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
    },
    topicSummary,
    chunks,
  };
}

module.exports = {
  MAX_CHUNK_TOKENS,
  MIN_CHUNK_TOKENS,
  estimateTokens,
  semanticChunkDocument,
  splitSentences,
};
