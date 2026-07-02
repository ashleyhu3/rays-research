import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { listLocalEnrichments } from "../transcripts/enrichmentStore.js";
import { runTranscriptManager } from "../transcripts/manager.mjs";
import { renderFinalReportMarkdown } from "../transcripts/report.mjs";

const DEFAULT_OUTPUT_DIRECTORY = path.resolve(
  "server",
  "data",
  "transcript-analysis",
);

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}

export async function main(argv = process.argv.slice(2)) {
  const ticker = optionValue(argv, "--ticker")?.toUpperCase();
  const outputDirectory = path.resolve(
    optionValue(argv, "--output-directory") || DEFAULT_OUTPUT_DIRECTORY,
  );
  const enrichments = await listLocalEnrichments();
  const documents = ticker
    ? enrichments.filter(
      (document) => String(document.ticker || document.symbol || "").toUpperCase() === ticker,
    )
    : enrichments;
  if (!documents.length) {
    throw new Error(ticker ? `No enriched transcripts found for ${ticker}.` : "No transcripts found.");
  }

  const result = await runTranscriptManager({ documents });
  const payload = {
    generatedAt: result.analysis.generatedAt,
    execution: result.events,
    analysis: result.analysis,
    reports: result.reports,
  };
  await atomicWrite(
    path.join(outputDirectory, "pipeline.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  await Promise.all(result.reports.map((report) => atomicWrite(
    path.join(
      outputDirectory,
      `${report.company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
    ),
    renderFinalReportMarkdown(report),
  )));

  console.log(JSON.stringify({
    outputDirectory,
    ticker: ticker || "all",
    reports: result.reports.length,
    ...result.analysis.summary,
    stages: result.events.map(({ stage, status }) => ({ stage, status })),
  }, null, 2));
  return result;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
