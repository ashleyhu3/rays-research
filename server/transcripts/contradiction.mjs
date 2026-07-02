import { cosineSimilarity, tokenize } from "./timeline.mjs";

const OPPOSING_DIRECTIONS = Object.freeze([
  [["increase", "increasing", "accelerate", "accelerated", "accelerating", "raise", "higher", "grow", "up"],
    ["decrease", "decreasing", "moderate", "moderating", "lower", "decline", "declining", "reduce", "down"]],
  [["expand", "expanding", "improve", "improving", "strong", "strengthen"],
    ["contract", "contracting", "deteriorate", "deteriorating", "weak", "weaken"]],
  [["shortage", "constrained", "constraint", "tight"],
    ["surplus", "oversupply", "ample", "available"]],
  [["confident", "certain", "visibility"],
    ["uncertain", "uncertainty", "unclear", "limited visibility"]],
  [["ahead", "exceed", "exceeding", "above"],
    ["behind", "miss", "missing", "below"]],
]);

const FORWARD_LOOKING_PATTERN = /\b(expect|forecast|guidance|outlook|anticipate|project|target|will|should)\b/i;
const SUBJECT_STOP_WORDS = new Set([
  "accelerate", "accelerated", "accelerating", "above", "ahead", "below", "behind",
  "billion", "certain", "company", "confident", "current", "decline", "declining",
  "decrease", "decreasing", "down", "expect", "fiscal", "forecast", "grow", "guidance",
  "higher", "increase", "increasing", "lower", "million", "moderate", "moderating",
  "next", "outlook", "percent", "quarter", "raise", "reduce", "significantly", "target",
  "uncertain", "up", "year",
]);

function hasTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function opposingSignals(before, after) {
  const matches = [];
  for (const [positive, negative] of OPPOSING_DIRECTIONS) {
    const beforePositive = positive.filter((term) => hasTerm(before, term));
    const beforeNegative = negative.filter((term) => hasTerm(before, term));
    const afterPositive = positive.filter((term) => hasTerm(after, term));
    const afterNegative = negative.filter((term) => hasTerm(after, term));
    if (beforePositive.length && !beforeNegative.length && afterNegative.length && !afterPositive.length) {
      matches.push({ before: beforePositive[0], after: afterNegative[0] });
    }
    if (beforeNegative.length && !beforePositive.length && afterPositive.length && !afterNegative.length) {
      matches.push({ before: beforeNegative[0], after: afterPositive[0] });
    }
  }
  return matches;
}

function subjectTokens(text) {
  const normalized = String(text)
    .replace(/\bcapital expenditures?\b/gi, "capex")
    .replace(/\bcustomers\b/gi, "customer");
  return new Set(tokenize(normalized).filter(
    (token) => token.length >= 3
      && !SUBJECT_STOP_WORDS.has(token)
      && !/^\d+(?:\.\d+)?$/.test(token),
  ));
}

function commonSubjects(before, after) {
  const left = subjectTokens(before);
  const right = subjectTokens(after);
  return [...left].filter((token) => right.has(token));
}

function scoreCandidate(previous, current, before, after, signals) {
  const sentimentDifference = Math.abs(current.sentimentScore - previous.sentimentScore);
  const statementSimilarity = cosineSimilarity(before.text, after.text);
  const forwardLooking = before.forwardLooking
    || after.forwardLooking
    || FORWARD_LOOKING_PATTERN.test(before.text)
    || FORWARD_LOOKING_PATTERN.test(after.text);
  let score = 0;
  if (signals.length) score += 0.55;
  if (sentimentDifference >= 0.65) score += 0.2;
  if (statementSimilarity >= 0.15) score += 0.1;
  if (forwardLooking) score += 0.1;
  score += Math.min(before.confidenceScore, after.confidenceScore) * 0.05;
  return {
    score: Math.min(1, score),
    sentimentDifference,
    statementSimilarity,
    forwardLooking,
  };
}

export function detectTimelineContradictions(timeline, options = {}) {
  if (!timeline?.topic || !Array.isArray(timeline.points)) {
    throw new TypeError("timeline must contain a topic and points array");
  }
  const minimumScore = options.minimumScore ?? 0.55;
  const minimumStatementSimilarity = options.minimumStatementSimilarity ?? 0.12;
  const contradictions = [];

  for (let index = 1; index < timeline.points.length; index += 1) {
    const previous = timeline.points[index - 1];
    const current = timeline.points[index];
    for (const after of current.observations || []) {
      if (/analyst/i.test(after.role || "") || /question/i.test(after.kind || "")) continue;
      const before = (previous.observations || []).reduce((best, observation) => {
        if (/analyst/i.test(observation.role || "") || /question/i.test(observation.kind || "")) {
          return best;
        }
        const similarity = cosineSimilarity(observation.text, after.text);
        return !best || similarity > best.similarity ? { observation, similarity } : best;
      }, null);
      if (!before || before.similarity < minimumStatementSimilarity) continue;

      const signals = opposingSignals(before.observation.text, after.text);
      const sharedSubjects = commonSubjects(before.observation.text, after.text);
      if (!sharedSubjects.length) continue;
      const candidate = scoreCandidate(
        previous,
        current,
        before.observation,
        after,
        signals,
      );
      if (candidate.score < minimumScore) continue;
      contradictions.push({
        company: timeline.company,
        topic: timeline.topic,
        from: previous.period,
        to: current.period,
        severity: candidate.score >= 0.8 ? "high" : candidate.score >= 0.65 ? "medium" : "low",
        confidence: Number(candidate.score.toFixed(4)),
        reason: signals.length
          ? `Direction changed from “${signals[0].before}” to “${signals[0].after}”.`
          : "The sentiment of comparable forward-looking statements reversed.",
        evidence: [
          {
            period: previous.period,
            statement: before.observation.text,
            speaker: before.observation.speaker,
          },
          { period: current.period, statement: after.text, speaker: after.speaker },
        ],
        signals,
        sharedSubjects,
        sentimentDifference: Number(candidate.sentimentDifference.toFixed(4)),
        statementSimilarity: Number(candidate.statementSimilarity.toFixed(4)),
        status: "potential_contradiction",
        requiresReview: true,
      });
    }
  }

  return contradictions.sort((left, right) => right.confidence - left.confidence);
}

export function detectContradictions(timelines, options = {}) {
  if (!Array.isArray(timelines)) throw new TypeError("timelines must be an array");
  return timelines.flatMap((timeline) => detectTimelineContradictions(timeline, options));
}
