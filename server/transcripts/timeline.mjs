// Native ESM: this analysis layer is loaded from the legacy CommonJS server via dynamic import.
const DEFAULT_JUMP_THRESHOLDS = Object.freeze({
  semanticDistance: 0.45,
  sentimentDifference: 0.65,
});

const SENTIMENT_LABELS = Object.freeze({
  "very negative": -1,
  bearish: -0.75,
  negative: -0.6,
  concerned: -0.45,
  cautious: -0.25,
  neutral: 0,
  mixed: 0,
  careful: 0,
  positive: 0.6,
  bullish: 0.75,
  optimistic: 0.75,
  "very positive": 1,
});

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for",
  "from", "had", "has", "have", "in", "is", "it", "its", "of", "on", "or",
  "our", "that", "the", "their", "this", "to", "was", "we", "were", "will",
  "with", "would",
]);

function clamp(value, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeTopic(topic) {
  const value = typeof topic === "object"
    ? firstDefined(topic?.name, topic?.label, topic?.topic)
    : topic;
  return String(value || "").trim();
}

function topicKey(topic) {
  return normalizeTopic(topic).toLowerCase().replace(/\s+/g, " ");
}

function topicValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(normalizeTopic).filter(Boolean);
}

function sentimentScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value);
  }
  if (!value) return 0;
  if (typeof value === "object") {
    const direct = firstDefined(value.score, value.sentimentScore, value.compound);
    if (typeof direct === "number") return clamp(direct);
    if (Number.isFinite(value.positive) || Number.isFinite(value.negative)) {
      return clamp(Number(value.positive || 0) - Number(value.negative || 0));
    }
    return sentimentScore(firstDefined(value.label, value.sentiment, value.classification));
  }
  const normalized = String(value).trim().toLowerCase().replace(/[_-]+/g, " ");
  if (normalized in SENTIMENT_LABELS) return SENTIMENT_LABELS[normalized];
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? clamp(numeric) : 0;
}

function confidenceScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value > 1 ? value / 100 : value, 0, 1);
  }
  if (!value) return 0.5;
  if (typeof value === "object") {
    return confidenceScore(firstDefined(value.score, value.confidenceScore, value.confidence));
  }
  const normalized = String(value).trim().toLowerCase();
  if (["very high", "certain"].includes(normalized)) return 1;
  if (["high", "confident"].includes(normalized)) return 0.85;
  if (["medium", "moderate"].includes(normalized)) return 0.65;
  if (["low", "uncertain"].includes(normalized)) return 0.35;
  if (normalized === "very low") return 0.15;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0.5;
}

function sentimentLabel(score) {
  if (score >= 0.65) return "Very Positive";
  if (score >= 0.2) return "Positive";
  if (score <= -0.65) return "Very Negative";
  if (score <= -0.2) return "Negative";
  return "Neutral";
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9]+(?:\.[0-9]+)?/g)
    ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) || [];
}

function termVector(text) {
  const vector = new Map();
  for (const token of tokenize(text)) vector.set(token, (vector.get(token) || 0) + 1);
  return vector;
}

function cosineSimilarity(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (!left.length || left.length !== right.length) return 0;
    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
      const a = Number(left[index]) || 0;
      const b = Number(right[index]) || 0;
      dot += a * b;
      leftMagnitude += a * a;
      rightMagnitude += b * b;
    }
    if (!leftMagnitude || !rightMagnitude) return 0;
    return clamp(dot / Math.sqrt(leftMagnitude * rightMagnitude), -1, 1);
  }

  const leftVector = left instanceof Map ? left : termVector(left);
  const rightVector = right instanceof Map ? right : termVector(right);
  if (!leftVector.size || !rightVector.size) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const count of leftVector.values()) leftMagnitude += count * count;
  for (const count of rightVector.values()) rightMagnitude += count * count;
  for (const [token, count] of leftVector) dot += count * (rightVector.get(token) || 0);
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function averageVectors(vectors) {
  const usable = vectors.filter(
    (vector) => Array.isArray(vector) && vector.length && vector.every(Number.isFinite),
  );
  if (!usable.length || usable.some((vector) => vector.length !== usable[0].length)) return null;
  return usable[0].map(
    (_, index) => usable.reduce((sum, vector) => sum + vector[index], 0) / usable.length,
  );
}

function normalizePeriod(document) {
  const metadata = document?.metadata || {};
  const rawPeriod = String(firstDefined(
    document?.period,
    document?.quarter,
    metadata.period,
    metadata.quarter,
    "",
  )).toUpperCase();
  const rawYear = firstDefined(
    document?.fiscalYear,
    document?.year,
    metadata.fiscalYear,
    metadata.year,
  );
  const combined = `${rawPeriod} ${rawYear || ""}`;
  const quarterMatch = combined.match(/(?:FY\s*)?(\d{4})\s*[- ]?Q([1-4])|Q([1-4])\s*(?:FY\s*)?(\d{4})/);
  const quarter = Number(quarterMatch?.[2] || quarterMatch?.[3] || rawPeriod.match(/Q([1-4])/)?.[1]);
  const year = Number(
    quarterMatch?.[1]
      || quarterMatch?.[4]
      || rawYear
      || String(firstDefined(document?.earningsDate, document?.date, metadata.date, "")).match(/\d{4}/)?.[0],
  );
  const dateValue = firstDefined(document?.earningsDate, document?.date, metadata.earningsDate, metadata.date);
  const dateTimestamp = dateValue ? Date.parse(dateValue) : Number.NaN;

  if (Number.isInteger(year) && quarter >= 1 && quarter <= 4) {
    return { label: `${year} Q${quarter}`, year, quarter, sortKey: year * 10 + quarter };
  }
  if (Number.isFinite(dateTimestamp)) {
    const date = new Date(dateTimestamp);
    const calendarQuarter = Math.floor(date.getUTCMonth() / 3) + 1;
    return {
      label: `${date.getUTCFullYear()} Q${calendarQuarter}`,
      year: date.getUTCFullYear(),
      quarter: calendarQuarter,
      sortKey: dateTimestamp,
    };
  }
  return { label: rawPeriod || "Unknown period", year: null, quarter: null, sortKey: Infinity };
}

function nestedArrays(document, paths) {
  return paths.flatMap((path) => {
    const value = path.split(".").reduce((current, key) => current?.[key], document);
    return Array.isArray(value) ? value : [];
  });
}

function toneIndex(document) {
  const tones = nestedArrays(document, [
    "tones", "tone", "toneAnalyses", "toneAnalysis", "analysis.tones", "analysis.tone",
  ]);
  return new Map(tones.map((tone) => [
    String(firstDefined(tone.chunkId, tone.chunk_id, tone.id, tone.index)),
    tone,
  ]));
}

function observationsFrom(document) {
  const facts = nestedArrays(document, [
    "facts", "extractedFacts", "informationExtraction.facts", "analysis.facts",
  ]);
  const sourceItems = facts.length
    ? facts
    : nestedArrays(document, ["chunks", "sections", "analysis.chunks"]);
  const tones = toneIndex(document);

  return sourceItems.flatMap((item, index) => {
    const tone = tones.get(String(firstDefined(item.chunkId, item.chunk_id, item.id, index))) || {};
    const topics = topicValues(firstDefined(item.topics, item.topic, item.metadata?.topics));
    const text = String(firstDefined(item.statement, item.text, item.content, item.quote, "")).trim();
    if (!topics.length || !text) return [];
    const score = sentimentScore(firstDefined(
      item.sentimentScore,
      item.sentiment,
      tone.sentimentScore,
      tone.sentiment,
      tone.financialSentiment,
    ));
    const confidence = confidenceScore(firstDefined(
      item.sentiment?.investorConfidence,
      item.tone?.composite?.investorConfidence,
      tone.composite?.investorConfidence,
      item.confidenceScore,
      item.confidence,
      tone.confidenceScore,
      tone.confidence,
    ));
    const embedding = firstDefined(item.embedding, item.vector, item.metadata?.embedding);
    return topics.map((topic) => ({
      topic,
      text,
      sentimentScore: score,
      confidenceScore: confidence,
      embedding: Array.isArray(embedding) ? embedding : null,
      speaker: firstDefined(item.speaker, item.metadata?.speaker, null),
      role: firstDefined(item.role, item.metadata?.role, null),
      kind: firstDefined(item.kind, item.metadata?.kind, null),
      section: firstDefined(item.section, item.metadata?.section, null),
      forwardLooking: Boolean(firstDefined(item.forwardLooking, item.forward_looking, false)),
      sourceId: firstDefined(item.id, item.chunkId, item.chunk_id, index),
    }));
  });
}

function documentCompany(document) {
  const metadata = document?.metadata || {};
  return String(firstDefined(
    document?.company,
    document?.companyName,
    metadata.company,
    metadata.companyName,
    document?.ticker,
    document?.symbol,
    metadata.ticker,
    metadata.symbol,
    "Unknown company",
  ));
}

function aggregatePoint(group) {
  const observations = group.observations;
  const totalWeight = observations.reduce((sum, item) => sum + item.confidenceScore, 0);
  const sentiment = totalWeight
    ? observations.reduce(
      (sum, item) => sum + item.sentimentScore * item.confidenceScore,
      0,
    ) / totalWeight
    : 0;
  const confidence = observations.length
    ? observations.reduce((sum, item) => sum + item.confidenceScore, 0) / observations.length
    : 0;
  const text = observations.map((item) => item.text).join("\n");
  return {
    period: group.period.label,
    year: group.period.year,
    quarter: group.period.quarter,
    sortKey: group.period.sortKey,
    sentimentScore: Number(sentiment.toFixed(4)),
    sentiment: sentimentLabel(sentiment),
    confidenceScore: Number(confidence.toFixed(4)),
    observationCount: observations.length,
    statements: observations.map((item) => item.text),
    observations,
    text,
    embedding: averageVectors(observations.map((item) => item.embedding)),
  };
}

function jumpBetween(previous, current, thresholds) {
  const useEmbeddings = previous.embedding && current.embedding;
  const semanticSimilarity = useEmbeddings
    ? cosineSimilarity(previous.embedding, current.embedding)
    : cosineSimilarity(previous.text, current.text);
  const semanticDistance = 1 - semanticSimilarity;
  const signedSentimentDifference = current.sentimentScore - previous.sentimentScore;
  const sentimentDifference = Math.abs(signedSentimentDifference);
  const reasons = [];
  if (semanticDistance >= thresholds.semanticDistance) reasons.push("meaning changed");
  if (sentimentDifference >= thresholds.sentimentDifference) reasons.push("sentiment changed");
  return {
    from: previous.period,
    to: current.period,
    semanticSimilarity: Number(semanticSimilarity.toFixed(4)),
    semanticDistance: Number(semanticDistance.toFixed(4)),
    similarityMethod: useEmbeddings ? "embedding-cosine" : "term-frequency-cosine",
    sentimentDifference: Number(sentimentDifference.toFixed(4)),
    sentimentDirection: signedSentimentDifference > 0.05
      ? "more positive"
      : signedSentimentDifference < -0.05 ? "more negative" : "stable",
    isLargeJump: reasons.length > 0,
    reasons,
  };
}

export function buildTopicTimelines(documents, options = {}) {
  if (!Array.isArray(documents)) throw new TypeError("documents must be an array");
  const thresholds = { ...DEFAULT_JUMP_THRESHOLDS, ...(options.jumpThresholds || {}) };
  const grouped = new Map();

  for (const document of documents) {
    const company = documentCompany(document);
    const period = normalizePeriod(document);
    for (const observation of observationsFrom(document)) {
      const key = `${company.toLowerCase()}\u0000${topicKey(observation.topic)}\u0000${period.label}`;
      const current = grouped.get(key) || {
        company,
        topic: observation.topic,
        period,
        observations: [],
      };
      current.observations.push(observation);
      grouped.set(key, current);
    }
  }

  const timelines = new Map();
  for (const group of grouped.values()) {
    const key = `${group.company.toLowerCase()}\u0000${topicKey(group.topic)}`;
    const timeline = timelines.get(key) || {
      company: group.company,
      topic: group.topic,
      points: [],
      jumps: [],
    };
    timeline.points.push(aggregatePoint(group));
    timelines.set(key, timeline);
  }

  return [...timelines.values()]
    .map((timeline) => {
      timeline.points.sort((left, right) => left.sortKey - right.sortKey);
      timeline.jumps = timeline.points.slice(1).map(
        (point, index) => jumpBetween(timeline.points[index], point, thresholds),
      );
      return timeline;
    })
    .sort((left, right) => (
      left.company.localeCompare(right.company) || left.topic.localeCompare(right.topic)
    ));
}

export {
  confidenceScore,
  cosineSimilarity,
  normalizePeriod,
  sentimentLabel,
  sentimentScore,
  tokenize,
};
