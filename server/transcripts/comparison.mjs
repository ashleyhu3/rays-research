import { cosineSimilarity } from "./timeline.mjs";

const GUIDANCE_PATTERN = /\b(expect|forecast|guidance|outlook|anticipate|project|target|will|should)\b/i;
const CONCERN_PATTERN = /\b(concern|risk|uncertain|pressure|headwind|challenge|weak|shortage|delay|volatile)\b/i;

function uniqueStatements(statements) {
  return [...new Set((statements || []).map((value) => String(value).trim()).filter(Boolean))];
}

function unmatched(source, candidates, threshold) {
  return source.filter((statement) => {
    const closest = Math.max(0, ...candidates.map((candidate) => cosineSimilarity(statement, candidate)));
    return closest < threshold;
  });
}

function wordingChanges(previous, current, lowerThreshold, upperThreshold) {
  const changes = [];
  for (const before of previous) {
    let best = null;
    let similarity = 0;
    for (const after of current) {
      const candidateSimilarity = cosineSimilarity(before, after);
      if (candidateSimilarity > similarity) {
        best = after;
        similarity = candidateSimilarity;
      }
    }
    if (best && similarity >= lowerThreshold && similarity < upperThreshold) {
      changes.push({
        before,
        after: best,
        cosineSimilarity: Number(similarity.toFixed(4)),
      });
    }
  }
  return changes;
}

export function compareTopicTimeline(timeline, options = {}) {
  if (!timeline?.topic || !Array.isArray(timeline.points)) {
    throw new TypeError("timeline must contain a topic and points array");
  }
  const noveltyThreshold = options.noveltyThreshold ?? 0.45;
  const wordingLowerThreshold = options.wordingLowerThreshold ?? 0.3;
  const wordingUpperThreshold = options.wordingUpperThreshold ?? 0.88;
  const confidenceThreshold = options.confidenceThreshold ?? 0.1;

  const comparisons = timeline.points.slice(1).map((current, index) => {
    const previous = timeline.points[index];
    const before = uniqueStatements(previous.statements);
    const after = uniqueStatements(current.statements);
    const added = unmatched(after, before, noveltyThreshold);
    const removed = unmatched(before, after, noveltyThreshold);
    const confidenceDelta = current.confidenceScore - previous.confidenceScore;
    return {
      topic: timeline.topic,
      from: previous.period,
      to: current.period,
      newGuidance: added.filter((statement) => GUIDANCE_PATTERN.test(statement)),
      removedGuidance: removed.filter((statement) => GUIDANCE_PATTERN.test(statement)),
      changedWording: wordingChanges(
        before,
        after,
        wordingLowerThreshold,
        wordingUpperThreshold,
      ),
      newConcerns: added.filter((statement) => CONCERN_PATTERN.test(statement)),
      confidenceChange: confidenceDelta >= confidenceThreshold
        ? "increased"
        : confidenceDelta <= -confidenceThreshold ? "decreased" : "stable",
      confidenceDelta: Number(confidenceDelta.toFixed(4)),
      sentimentChange: Number(
        (current.sentimentScore - previous.sentimentScore).toFixed(4),
      ),
    };
  });

  return {
    company: timeline.company,
    topic: timeline.topic,
    periods: timeline.points.map((point) => point.period),
    comparisons,
  };
}

export function compareTopicsAcrossQuarters(timelines, options = {}) {
  if (!Array.isArray(timelines)) throw new TypeError("timelines must be an array");
  return timelines.filter((timeline) => timeline.points?.length > 1)
    .map((timeline) => compareTopicTimeline(timeline, options));
}

export function buildCrossQuarterPrompt(timeline) {
  const discussions = timeline.points.map((point) => (
    `${point.period}\n${point.statements.map((statement) => `- ${statement}`).join("\n")}`
  )).join("\n\n");
  return [
    `Compare only these ${timeline.topic} discussions for ${timeline.company}.`,
    discussions,
    "Identify new guidance, removed guidance, changed wording, new concerns,",
    "increased confidence, and decreased confidence. Cite the relevant periods.",
  ].join("\n\n");
}
