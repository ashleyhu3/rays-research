import test from "node:test";
import assert from "node:assert/strict";

import { buildTopicTimelines, normalizePeriod } from "./timeline.mjs";
import { compareTopicTimeline } from "./comparison.mjs";
import { detectTimelineContradictions } from "./contradiction.mjs";
import { analyzeLongitudinalTopics } from "./longitudinal.mjs";

const documents = [
  {
    company: "Example Cloud",
    quarter: "Q1",
    fiscalYear: 2026,
    facts: [
      {
        topic: "CapEx",
        statement: "We expect CapEx growth to moderate through the year.",
        sentiment: "neutral",
        confidence: "high",
        forwardLooking: true,
        speaker: "CFO",
        embedding: [1, 0, 0],
      },
      {
        topic: "Cloud",
        statement: "Cloud demand remains healthy and customer growth is strong.",
        sentiment: "positive",
        confidence: 0.8,
      },
    ],
  },
  {
    company: "Example Cloud",
    period: "2026Q2",
    facts: [
      {
        topic: "CapEx",
        statement: "We now expect CapEx to accelerate significantly next quarter.",
        sentiment: "very positive",
        confidence: "high",
        forwardLooking: true,
        speaker: "CFO",
        embedding: [0, 1, 0],
      },
      {
        topic: "CapEx",
        statement: "Power availability is a new supply risk.",
        sentiment: "negative",
        confidence: 0.9,
      },
      {
        topic: "Cloud",
        statement: "Cloud demand remains healthy and customer growth is strong.",
        sentiment: "positive",
        confidence: 0.8,
      },
    ],
  },
];

test("normalizes common fiscal-quarter formats", () => {
  assert.deepEqual(normalizePeriod({ period: "FY2025 Q4" }), {
    label: "2025 Q4",
    year: 2025,
    quarter: 4,
    sortKey: 20254,
  });
  assert.equal(normalizePeriod({ quarter: "Q2", fiscalYear: 2026 }).label, "2026 Q2");
});

test("stage 8 builds ordered topic timelines and detects large jumps", () => {
  const capex = buildTopicTimelines(documents).find((timeline) => timeline.topic === "CapEx");
  assert.deepEqual(capex.points.map((point) => point.period), ["2026 Q1", "2026 Q2"]);
  assert.equal(capex.jumps[0].similarityMethod, "embedding-cosine");
  assert.equal(capex.jumps[0].isLargeJump, true);
  assert.ok(capex.jumps[0].reasons.includes("meaning changed"));
});

test("stage 9 compares only matching topic discussions across quarters", () => {
  const capex = buildTopicTimelines(documents).find((timeline) => timeline.topic === "CapEx");
  const comparison = compareTopicTimeline(capex).comparisons[0];
  assert.equal(comparison.from, "2026 Q1");
  assert.equal(comparison.to, "2026 Q2");
  assert.equal(comparison.newGuidance.length, 1);
  assert.ok(comparison.newConcerns.some((statement) => statement.includes("supply risk")));
});

test("stage 10 flags a directional contradiction with cited evidence", () => {
  const capex = buildTopicTimelines(documents).find((timeline) => timeline.topic === "CapEx");
  const contradictions = detectTimelineContradictions(capex);
  assert.ok(contradictions.length >= 1);
  assert.equal(contradictions[0].status, "potential_contradiction");
  assert.match(contradictions[0].reason, /moderate.*accelerate/i);
  assert.deepEqual(
    contradictions[0].evidence.map((item) => item.period),
    ["2026 Q1", "2026 Q2"],
  );
});

test("stable repeated language does not create a contradiction", () => {
  const cloud = buildTopicTimelines(documents).find((timeline) => timeline.topic === "Cloud");
  assert.deepEqual(detectTimelineContradictions(cloud), []);
});

test("combined longitudinal analysis returns stage 8 through 10 outputs", () => {
  const result = analyzeLongitudinalTopics(documents);
  assert.ok(result.timelines.length >= 2);
  assert.ok(result.comparisons.length >= 2);
  assert.ok(result.contradictions.length >= 1);
  assert.equal(result.summary.documentCount, 2);
  assert.equal(result.summary.contradictionCount, result.contradictions.length);
});
