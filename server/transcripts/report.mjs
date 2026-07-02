import { cosineSimilarity } from "./timeline.mjs";

const DEFAULT_TOPIC_LIMIT = 8;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round(value, digits = 4) {
  return Number((Number(value) || 0).toFixed(digits));
}

function trendArrow(delta) {
  if (delta >= 0.5) return "↑↑↑";
  if (delta >= 0.25) return "↑↑";
  if (delta >= 0.08) return "↑";
  if (delta <= -0.5) return "↓↓↓";
  if (delta <= -0.25) return "↓↓";
  if (delta <= -0.08) return "↓";
  return "→";
}

function toneLabel(delta) {
  if (delta >= 0.25) return "Substantially More Confident";
  if (delta >= 0.1) return "Increasingly Confident";
  if (delta <= -0.25) return "Substantially More Cautious";
  if (delta <= -0.1) return "Increasingly Cautious";
  return "Stable";
}

function observationEvidence(point, limit = 2) {
  return (point?.observations || [])
    .slice()
    .sort((left, right) => right.confidenceScore - left.confidenceScore)
    .slice(0, limit)
    .map((observation) => ({
      period: point.period,
      statement: observation.text,
      speaker: observation.speaker,
      section: observation.section,
      confidence: Math.round(clamp(observation.confidenceScore) * 100),
    }));
}

function topicSignal(timeline) {
  const first = timeline.points[0];
  const latest = timeline.points.at(-1);
  const sentimentDelta = latest.sentimentScore - first.sentimentScore;
  const confidenceDelta = latest.confidenceScore - first.confidenceScore;
  const combinedDelta = sentimentDelta * 0.65 + confidenceDelta * 0.35;
  return {
    topic: timeline.topic,
    direction: trendArrow(combinedDelta),
    trendScore: round(combinedDelta),
    sentiment: latest.sentiment,
    sentimentScore: latest.sentimentScore,
    confidence: Math.round(clamp(latest.confidenceScore) * 100),
    confidenceDelta: round(confidenceDelta),
    firstPeriod: first.period,
    latestPeriod: latest.period,
    observationCount: timeline.points.reduce(
      (total, point) => total + point.observationCount,
      0,
    ),
    evidence: observationEvidence(latest, 1),
  };
}

function weightedConfidence(timelines, pointSelector) {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const timeline of timelines) {
    const point = pointSelector(timeline);
    if (!point) continue;
    const weight = Math.max(1, point.observationCount);
    weightedScore += clamp(point.confidenceScore) * weight;
    totalWeight += weight;
  }
  return totalWeight ? weightedScore / totalWeight : 0;
}

function notableChanges(timelines) {
  const changes = [];
  for (const timeline of timelines) {
    for (let index = 1; index < timeline.points.length; index += 1) {
      const previous = timeline.points[index - 1];
      const current = timeline.points[index];
      const jump = timeline.jumps[index - 1];
      const confidenceDelta = current.confidenceScore - previous.confidenceScore;
      const sentimentDelta = current.sentimentScore - previous.sentimentScore;
      const previousManagement = (previous.observations || []).filter(
        (observation) => !/analyst/i.test(observation.role || "")
          && !/question/i.test(observation.kind || ""),
      );
      const currentManagement = (current.observations || []).filter(
        (observation) => !/analyst/i.test(observation.role || "")
          && !/question/i.test(observation.kind || ""),
      );
      const evidencePair = previousManagement.flatMap((before) => (
        currentManagement.map((after) => {
          const similarity = cosineSimilarity(before.text, after.text);
          return {
            before,
            after,
            similarity,
            score: similarity * (
              1 + Math.abs(after.sentimentScore - before.sentimentScore)
            ),
          };
        })
      )).filter((pair) => pair.similarity >= 0.15)
        .sort((left, right) => right.score - left.score)[0];
      if (!evidencePair) continue;
      const wordingNovelty = evidencePair ? 1 - evidencePair.similarity : 0;
      const magnitude = (
        Math.abs(sentimentDelta) * 1.2
        + Math.abs(confidenceDelta) * 0.25
        + (jump?.semanticDistance || 0)
      ) * Math.max(0.2, wordingNovelty);
      changes.push({
        topic: timeline.topic,
        from: previous.period,
        to: current.period,
        magnitude,
        confidenceDelta: evidencePair.after.confidenceScore
          - evidencePair.before.confidenceScore,
        sentimentDelta: evidencePair.after.sentimentScore
          - evidencePair.before.sentimentScore,
        semanticDistance: jump?.semanticDistance || 0,
        statementSimilarity: evidencePair?.similarity || 0,
        evidence: evidencePair ? [
          {
            period: previous.period,
            statement: evidencePair.before.text,
            speaker: evidencePair.before.speaker,
            section: evidencePair.before.section,
            confidence: Math.round(clamp(evidencePair.before.confidenceScore) * 100),
          },
          {
            period: current.period,
            statement: evidencePair.after.text,
            speaker: evidencePair.after.speaker,
            section: evidencePair.after.section,
            confidence: Math.round(clamp(evidencePair.after.confidenceScore) * 100),
          },
        ] : [],
      });
    }
  }
  return changes.sort((left, right) => right.magnitude - left.magnitude);
}

function changeNarrative(change) {
  if (!change) return "No multi-quarter change is available yet.";
  if (change.confidenceDelta >= 0.1) {
    return `Management became substantially more confident regarding ${change.topic} beginning in ${change.to}.`;
  }
  if (change.confidenceDelta <= -0.1) {
    return `Management became more cautious regarding ${change.topic} beginning in ${change.to}.`;
  }
  if (change.sentimentDelta > 0) {
    return `${change.topic} language became more positive between ${change.from} and ${change.to}.`;
  }
  if (change.sentimentDelta < 0) {
    return `${change.topic} language became more cautious between ${change.from} and ${change.to}.`;
  }
  return `${change.topic} wording changed materially between ${change.from} and ${change.to}.`;
}

function companyAnalysis(analysis, company) {
  const timelines = analysis.timelines.filter((timeline) => timeline.company === company);
  return {
    timelines,
    comparisons: analysis.comparisons.filter((comparison) => comparison.company === company),
    contradictions: analysis.contradictions.filter(
      (contradiction) => contradiction.company === company,
    ),
  };
}

export function generateCompanyReport(analysis, company, options = {}) {
  if (!analysis?.timelines || !Array.isArray(analysis.timelines)) {
    throw new TypeError("analysis must contain timelines");
  }
  const scoped = companyAnalysis(analysis, company);
  if (!scoped.timelines.length) throw new Error(`No timelines found for ${company}.`);

  const latestConfidence = weightedConfidence(scoped.timelines, (timeline) => timeline.points.at(-1));
  const initialConfidence = weightedConfidence(scoped.timelines, (timeline) => timeline.points[0]);
  const confidenceDelta = latestConfidence - initialConfidence;
  const topicLimit = options.topicLimit ?? DEFAULT_TOPIC_LIMIT;
  const topics = scoped.timelines
    .map(topicSignal)
    .sort((left, right) => (
      right.observationCount - left.observationCount
      || Math.abs(right.trendScore) - Math.abs(left.trendScore)
    ))
    .slice(0, topicLimit);
  const reportTopics = new Set(topics.map((topic) => topic.topic));
  const notableTimelines = scoped.timelines.filter(
    (timeline) => reportTopics.has(timeline.topic),
  );
  const change = notableChanges(notableTimelines)[0] || null;

  return {
    company,
    generatedAt: new Date().toISOString(),
    overallConfidence: Math.round(latestConfidence * 100),
    confidenceDelta: round(confidenceDelta),
    tone: toneLabel(confidenceDelta),
    topics,
    notableChange: {
      narrative: changeNarrative(change),
      ...(change ? {
        topic: change.topic,
        from: change.from,
        to: change.to,
        sentimentDelta: round(change.sentimentDelta),
        confidenceDelta: round(change.confidenceDelta),
        semanticDistance: round(change.semanticDistance),
        statementSimilarity: round(change.statementSimilarity),
        evidence: change.evidence,
      } : { evidence: [] }),
    },
    contradictions: scoped.contradictions,
    evidence: topics.flatMap((topic) => topic.evidence).slice(0, 6),
    coverage: {
      periods: [...new Set(scoped.timelines.flatMap(
        (timeline) => timeline.points.map((point) => point.period),
      ))],
      topics: scoped.timelines.length,
      comparisons: scoped.comparisons.reduce(
        (total, comparison) => total + comparison.comparisons.length,
        0,
      ),
      potentialContradictions: scoped.contradictions.length,
    },
  };
}

export function generateFinalReports(analysis, options = {}) {
  const companies = options.company
    ? [options.company]
    : [...new Set(analysis.timelines.map((timeline) => timeline.company))];
  return companies.map((company) => generateCompanyReport(analysis, company, options));
}

export function renderFinalReportMarkdown(report) {
  const topicRows = report.topics.length
    ? report.topics.map(
      (topic) => `| ${topic.topic} | ${topic.direction} | ${topic.sentiment} | ${topic.confidence} |`,
    ).join("\n")
    : "| No topics | → | Neutral | 0 |";
  const evidence = report.notableChange.evidence.length
    ? report.notableChange.evidence.map(
      (item) => `- **${item.period} — ${item.speaker || "Unknown speaker"}:** ${item.statement}`,
    ).join("\n")
    : "- No multi-quarter evidence is available.";
  const contradictions = report.contradictions.length
    ? report.contradictions.map(
      (item) => `- **${item.topic}, ${item.from} → ${item.to}:** ${item.reason}`,
    ).join("\n")
    : "- None detected.";

  return [
    `# ${report.company}`,
    "",
    `**Overall confidence:** ${report.overallConfidence}`,
    "",
    `**Tone:** ${report.tone}`,
    "",
    "| Topic | Direction | Latest sentiment | Confidence |",
    "| --- | ---: | --- | ---: |",
    topicRows,
    "",
    "## Notable change",
    "",
    report.notableChange.narrative,
    "",
    "## Evidence",
    "",
    evidence,
    "",
    "## Potential contradictions",
    "",
    contradictions,
    "",
  ].join("\n");
}

export { toneLabel, trendArrow };
