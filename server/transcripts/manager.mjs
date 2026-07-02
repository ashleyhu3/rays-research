import {
  Annotation,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";

import { parseTranscriptDocument } from "./parser.js";
import { semanticChunkDocument } from "./chunker.js";
import { extractFacts } from "./facts.js";
import { attachCompositeTone } from "./tone.js";
import { buildTopicTimelines } from "./timeline.mjs";
import { compareTopicsAcrossQuarters } from "./comparison.mjs";
import { detectContradictions } from "./contradiction.mjs";
import { generateFinalReports } from "./report.mjs";

export const MANAGER_STAGES = Object.freeze([
  "download",
  "parse",
  "chunk",
  "embed",
  "retrieve",
  "topicExtraction",
  "sentiment",
  "factExtraction",
  "comparison",
  "contradictions",
  "summary",
]);

const TranscriptManagerState = Annotation.Root({
  input: Annotation(),
  documents: Annotation(),
  embeddings: Annotation(),
  retrieved: Annotation(),
  topicStats: Annotation(),
  timelines: Annotation(),
  comparisons: Annotation(),
  contradictionResults: Annotation(),
  analysis: Annotation(),
  reports: Annotation(),
  events: Annotation({
    reducer: (current, update) => [...(current || []), ...(update || [])],
    default: () => [],
  }),
});

function now() {
  return new Date().toISOString();
}

function sourceDocuments(input) {
  const supplied = input.documents || input.transcripts || input.enrichments;
  if (!supplied) return [];
  return Array.isArray(supplied) ? supplied : [supplied];
}

function hasChunks(document) {
  return Array.isArray(document?.chunks) && document.chunks.length > 0;
}

async function retry(handler, attempts, stage) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { value: await handler(), attempt };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
  }
  throw new Error(`${stage} failed after ${attempts} attempt(s): ${lastError?.message}`, {
    cause: lastError,
  });
}

function mergeFacts(document) {
  if (Array.isArray(document.facts) && document.facts.length) return document;
  return { ...document, ...extractFacts(document) };
}

function normalizeTone(document) {
  return attachCompositeTone(document);
}

function graphNodes(dependencies, options) {
  return {
    async download(state) {
      const supplied = sourceDocuments(state.input);
      if (supplied.length) return { documents: supplied, stageStatus: "reused" };
      if (!dependencies.download) {
        throw new Error("A download adapter or input documents are required.");
      }
      const downloaded = await dependencies.download(state.input);
      return {
        documents: Array.isArray(downloaded) ? downloaded : [downloaded],
        stageStatus: "completed",
      };
    },

    async parse(state) {
      return {
        documents: state.documents.map((document) => (
          hasChunks(document) || Array.isArray(document?.blocks)
            ? document
            : parseTranscriptDocument(document)
        )),
      };
    },

    async chunk(state) {
      return {
        documents: state.documents.map((document) => (
          hasChunks(document)
            ? document
            : semanticChunkDocument(document, options.chunking)
        )),
      };
    },

    async embed(state) {
      if (!dependencies.embed) return { embeddings: null, stageStatus: "skipped" };
      return {
        embeddings: await dependencies.embed(state.documents, {
          input: state.input,
          options: options.embedding,
        }),
      };
    },

    async retrieve(state) {
      if (!dependencies.retrieve) {
        return {
          retrieved: state.documents.flatMap((document) => document.chunks || []),
          stageStatus: "passthrough",
        };
      }
      return {
        retrieved: await dependencies.retrieve({
          query: state.input.query,
          documents: state.documents,
          embeddings: state.embeddings,
          options: options.retrieval,
        }),
      };
    },

    async topicExtraction(state) {
      const taggedChunks = state.documents.reduce(
        (total, document) => total + (document.chunks || []).filter(
          (chunk) => Array.isArray(chunk.topics) && chunk.topics.length,
        ).length,
        0,
      );
      return { topicStats: { taggedChunks } };
    },

    async sentiment(state) {
      if (dependencies.sentiment) {
        const analyzed = await dependencies.sentiment(state.documents, options.sentiment);
        return {
          documents: (Array.isArray(analyzed) ? analyzed : [analyzed]).map(normalizeTone),
        };
      }
      return { documents: state.documents.map(normalizeTone) };
    },

    async factExtraction(state) {
      return { documents: state.documents.map(mergeFacts) };
    },

    async comparison(state) {
      const timelines = buildTopicTimelines(state.documents, options.timeline);
      return {
        timelines,
        comparisons: compareTopicsAcrossQuarters(timelines, options.comparison),
      };
    },

    async contradictions(state) {
      return {
        contradictionResults: detectContradictions(state.timelines, options.contradiction),
      };
    },

    async summary(state) {
      const analysis = {
        generatedAt: now(),
        timelines: state.timelines,
        comparisons: state.comparisons,
        contradictions: state.contradictionResults,
        summary: {
          documentCount: state.documents.length,
          companyCount: new Set(state.timelines.map((timeline) => timeline.company)).size,
          topicCount: state.timelines.length,
          largeJumpCount: state.timelines.reduce(
            (total, timeline) => total + timeline.jumps.filter(
              (jump) => jump.isLargeJump,
            ).length,
            0,
          ),
          contradictionCount: state.contradictionResults.length,
        },
      };
      return {
        analysis,
        reports: generateFinalReports(analysis, options.report),
      };
    },
  };
}

export function createTranscriptManagerGraph(dependencies = {}, options = {}) {
  const attempts = Math.max(1, options.retryAttempts ?? 2);
  const nodes = graphNodes(dependencies, options);
  const eventLog = [];
  const graph = new StateGraph(TranscriptManagerState);

  for (const stage of MANAGER_STAGES) {
    graph.addNode(stage, async (state) => {
      const startedAt = now();
      const started = performance.now();
      try {
        const result = await retry(() => nodes[stage](state), attempts, stage);
        const { stageStatus, ...updates } = result.value;
        const event = {
          stage,
          status: stageStatus || "completed",
          attempt: result.attempt,
          startedAt,
          completedAt: now(),
          durationMs: Math.round((performance.now() - started) * 100) / 100,
        };
        eventLog.push(event);
        return { ...updates, events: [event] };
      } catch (error) {
        error.pipelineState = { stage, events: [...eventLog] };
        throw error;
      }
    });
  }

  graph.addEdge(START, MANAGER_STAGES[0]);
  for (let index = 1; index < MANAGER_STAGES.length; index += 1) {
    graph.addEdge(MANAGER_STAGES[index - 1], MANAGER_STAGES[index]);
  }
  graph.addEdge(MANAGER_STAGES.at(-1), END);
  return graph.compile();
}

export async function runTranscriptManager(input = {}, dependencies = {}, options = {}) {
  const graph = createTranscriptManagerGraph(dependencies, options);
  return graph.invoke({
    input,
    documents: [],
    embeddings: null,
    retrieved: [],
    topicStats: null,
    timelines: [],
    comparisons: [],
    contradictionResults: [],
    analysis: null,
    reports: [],
    events: [],
  });
}

export default runTranscriptManager;
