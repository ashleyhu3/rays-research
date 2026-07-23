'use strict';

const path = require('path');
const { spawn } = require('child_process');

const { collectFromAlphaVantage } = require('./alphavantage');
const { semanticChunkDocument } = require('./chunker');
const { readEnrichmentLocal, saveEnrichment } = require('./enrichmentStore');
const { saveTranscript } = require('./store');

// Full transcript pipeline: collect → FinBERT/emotion tone → LLM tone → facts →
// key figures → publish, scoped to a single transcript. The three JS steps and
// the Python step run as child processes (they carry the proven logic); scoping
// each to --ticker/--period keeps other transcripts' Mongo data untouched and
// sidesteps the local-vs-Mongo source mismatch. Shared by the streaming Express
// endpoint and the GitHub Actions CLI (server/scripts/analyzeTranscript.js).
//
// FinBERT needs Python + the model stack. Locally that's server/.venv-transcripts;
// in CI, set TRANSCRIPT_PYTHON to the interpreter that has torch + transformers.
const SERVER_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.join(SERVER_DIR, '..');
const PYTHON_BIN = process.env.TRANSCRIPT_PYTHON
  || path.join(SERVER_DIR, '.venv-transcripts', 'bin', 'python');
const TONE_PY = path.join(SERVER_DIR, 'retrieval', 'tone_pipeline.py');
const analysisScript = name => path.join(SERVER_DIR, 'scripts', name);

// Spawn a step, forwarding each stdout line to onLine; reject on non-zero exit.
function runAnalysisStep(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, env: process.env });
    let stderrTail = '';
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
      }
    });
    child.stdout.on('end', () => { const line = buffer.trim(); if (line) onLine(line); });
    child.stderr.on('data', data => { stderrTail = (stderrTail + data.toString()).slice(-2000); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve();
      const detail = stderrTail.trim().split('\n').filter(Boolean).pop() || `exit ${code}`;
      reject(new Error(detail));
    });
  });
}

// Run the whole pipeline for one transcript. `onEvent` receives progress events
// ({ stage, status, message, ticker, period }); callers render them as an NDJSON
// stream (endpoint) or console logs (CLI). Throws on failure.
async function runFullPipeline({ ticker: tickerInput, quarter, year }, onEvent = () => {}) {
  onEvent({ stage: 'collect', status: 'start', message: 'Fetching transcript from Alpha Vantage…' });
  const transcript = await collectFromAlphaVantage({ ticker: tickerInput, quarter, year });
  await saveTranscript(transcript);
  await saveEnrichment(semanticChunkDocument(transcript));
  const ticker = transcript.ticker;
  const period = transcript.fiscal_period;
  onEvent({ stage: 'collect', status: 'done', ticker, period, message: `${transcript.stats.totalBlocks} blocks · ${transcript.stats.wordCount.toLocaleString('en-US')} words` });

  const scope = ['--ticker', ticker, '--period', period];
  const steps = [
    { stage: 'finbert', message: 'Scoring tone with FinBERT…', command: PYTHON_BIN, args: [TONE_PY, ...scope] },
    { stage: 'tone-llm', message: 'Interpreting management tone (LLM)…', command: process.execPath, args: [analysisScript('interpretTranscriptTone.js'), ...scope] },
    { stage: 'facts', message: 'Extracting facts & guidance…', command: process.execPath, args: [analysisScript('extractTranscriptFacts.js'), ...scope] },
    { stage: 'figures', message: 'Extracting key figures (LLM)…', command: process.execPath, args: [analysisScript('extractKeyFigures.js'), ...scope] },
  ];
  for (const step of steps) {
    onEvent({ stage: step.stage, status: 'start', message: step.message });
    await runAnalysisStep(step.command, step.args, line => onEvent({ stage: step.stage, status: 'log', message: line }));
    onEvent({ stage: step.stage, status: 'done' });
  }

  // Publish the fully-enriched local copy to Mongo so the UI reads it.
  onEvent({ stage: 'publish', status: 'start', message: 'Publishing to database…' });
  const finalEnrichment = readEnrichmentLocal(ticker, period);
  if (finalEnrichment) await saveEnrichment(finalEnrichment);
  onEvent({ stage: 'publish', status: 'done' });

  onEvent({ stage: 'done', status: 'done', ticker, period });
  return { ticker, period };
}

module.exports = { runFullPipeline };
