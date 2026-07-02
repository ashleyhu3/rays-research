import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { listLocalEnrichments } from "../transcripts/enrichmentStore.js";
import { analyzeLongitudinalTopics } from "../transcripts/longitudinal.mjs";

const DEFAULT_OUTPUT = path.resolve(
  "server",
  "data",
  "transcript-analysis",
  "longitudinal.json",
);

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

export async function main(argv = process.argv.slice(2)) {
  const requestedTicker = optionValue(argv, "--ticker")?.toUpperCase();
  const outputPath = path.resolve(optionValue(argv, "--output") || DEFAULT_OUTPUT);
  const enrichments = await listLocalEnrichments();
  const documents = requestedTicker
    ? enrichments.filter(
      (document) => String(document.ticker || document.symbol || "").toUpperCase() === requestedTicker,
    )
    : enrichments;

  if (!documents.length) {
    throw new Error(
      requestedTicker
        ? `No enriched transcripts found for ${requestedTicker}.`
        : "No enriched transcripts found.",
    );
  }

  const analysis = analyzeLongitudinalTopics(documents);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, outputPath);

  console.log(JSON.stringify({
    outputPath,
    ticker: requestedTicker || "all",
    ...analysis.summary,
  }, null, 2));
  return analysis;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
