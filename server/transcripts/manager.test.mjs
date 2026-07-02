import test from "node:test";
import assert from "node:assert/strict";

import { MANAGER_STAGES, runTranscriptManager } from "./manager.mjs";
import {
  generateCompanyReport,
  renderFinalReportMarkdown,
  trendArrow,
} from "./report.mjs";

const documents = [
  {
    ticker: "ACME",
    quarter: "Q1",
    year: 2026,
    chunks: [{
      id: "q1-capex",
      text: "We expect CapEx growth to moderate through the year.",
      topics: ["CapEx"],
      speaker: "CFO",
      role: "Management",
      kind: "answer",
      tone: {
        composite: { score: -0.1, investorConfidence: 58, label: "Measured" },
      },
    }],
    facts: [{
      id: "q1-capex-f1",
      chunkId: "q1-capex",
      topic: "CapEx",
      topics: ["CapEx"],
      statement: "We expect CapEx growth to moderate through the year.",
      speaker: "CFO",
      role: "Management",
      kind: "answer",
      confidence: "High",
      forwardLooking: true,
      sentiment: { score: -0.1, investorConfidence: 58 },
    }],
  },
  {
    ticker: "ACME",
    quarter: "Q2",
    year: 2026,
    chunks: [{
      id: "q2-capex",
      text: "We now expect CapEx to accelerate significantly next quarter.",
      topics: ["CapEx"],
      speaker: "CFO",
      role: "Management",
      kind: "answer",
      tone: {
        composite: { score: 0.8, investorConfidence: 92, label: "Highly confident" },
      },
    }],
    facts: [{
      id: "q2-capex-f1",
      chunkId: "q2-capex",
      topic: "CapEx",
      topics: ["CapEx"],
      statement: "We now expect CapEx to accelerate significantly next quarter.",
      speaker: "CFO",
      role: "Management",
      kind: "answer",
      confidence: "High",
      forwardLooking: true,
      sentiment: { score: 0.8, investorConfidence: 92 },
    }],
  },
];

test("stage 11 runs every deterministic manager node in order", async () => {
  const result = await runTranscriptManager({ documents }, {}, { retryAttempts: 1 });
  assert.deepEqual(result.events.map((event) => event.stage), MANAGER_STAGES);
  assert.equal(result.events[0].status, "reused");
  assert.equal(result.events.find((event) => event.stage === "embed").status, "skipped");
  assert.equal(result.events.find((event) => event.stage === "retrieve").status, "passthrough");
  assert.equal(result.analysis.summary.documentCount, 2);
  assert.equal(result.reports.length, 1);
});

test("stage 11 retries an injected adapter and records its successful attempt", async () => {
  let calls = 0;
  const result = await runTranscriptManager(
    { documents },
    {
      embed: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary embedding failure");
        return { indexed: documents.length };
      },
    },
    { retryAttempts: 2 },
  );
  assert.equal(calls, 2);
  assert.equal(result.events.find((event) => event.stage === "embed").attempt, 2);
});

test("stage 12 produces confidence, directional topics, evidence, and markdown", async () => {
  const result = await runTranscriptManager({ documents });
  const report = generateCompanyReport(result.analysis, "ACME");
  assert.equal(report.overallConfidence, 92);
  assert.equal(report.tone, "Substantially More Confident");
  assert.equal(report.topics[0].topic, "CapEx");
  assert.equal(report.topics[0].direction, "↑↑↑");
  assert.match(report.notableChange.narrative, /more confident.*CapEx.*2026 Q2/i);
  assert.equal(report.notableChange.evidence.length, 2);
  assert.ok(report.contradictions.length >= 1);

  const markdown = renderFinalReportMarkdown(report);
  assert.match(markdown, /# ACME/);
  assert.match(markdown, /Overall confidence:\*\* 92/);
  assert.match(markdown, /Potential contradictions/);
});

test("report arrows encode trend magnitude", () => {
  assert.equal(trendArrow(0.6), "↑↑↑");
  assert.equal(trendArrow(-0.3), "↓↓");
  assert.equal(trendArrow(0.01), "→");
});
