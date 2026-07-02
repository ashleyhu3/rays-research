import { buildTopicTimelines } from "./timeline.mjs";
import { compareTopicsAcrossQuarters } from "./comparison.mjs";
import { detectContradictions } from "./contradiction.mjs";

export function analyzeLongitudinalTopics(documents, options = {}) {
  const timelines = buildTopicTimelines(documents, options.timeline);
  const contradictions = detectContradictions(timelines, options.contradiction);
  return {
    generatedAt: new Date().toISOString(),
    timelines,
    comparisons: compareTopicsAcrossQuarters(timelines, options.comparison),
    contradictions,
    summary: {
      documentCount: documents.length,
      companyCount: new Set(timelines.map((timeline) => timeline.company)).size,
      topicCount: timelines.length,
      largeJumpCount: timelines.reduce(
        (total, timeline) => total + timeline.jumps.filter((jump) => jump.isLargeJump).length,
        0,
      ),
      contradictionCount: contradictions.length,
    },
  };
}
