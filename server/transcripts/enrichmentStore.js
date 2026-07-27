'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'data', 'transcripts', 'processed');
const MONGO_IDLE_MS = 10000;

let sharedClient = null;
let sharedClientPromise = null;
let activeMongoUsers = 0;
let mongoIdleTimer = null;

async function acquireMongoDatabase() {
  if (mongoIdleTimer) {
    clearTimeout(mongoIdleTimer);
    mongoIdleTimer = null;
  }
  if (!sharedClientPromise) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    sharedClientPromise = client.connect()
      .then(() => {
        sharedClient = client;
        return client;
      })
      .catch(error => {
        sharedClient = null;
        sharedClientPromise = null;
        throw error;
      });
  }
  const client = await sharedClientPromise;
  activeMongoUsers += 1;
  return client.db(process.env.MONGODB_DB || undefined);
}

function releaseMongoDatabase() {
  activeMongoUsers = Math.max(0, activeMongoUsers - 1);
  if (activeMongoUsers || mongoIdleTimer || !sharedClient) return;
  mongoIdleTimer = setTimeout(async () => {
    mongoIdleTimer = null;
    if (activeMongoUsers || !sharedClient) return;
    const client = sharedClient;
    sharedClient = null;
    sharedClientPromise = null;
    await client.close().catch(() => {});
  }, MONGO_IDLE_MS);
  mongoIdleTimer.unref?.();
}

async function withMongoDatabase(handler) {
  const database = await acquireMongoDatabase();
  try {
    return await handler(database);
  } finally {
    releaseMongoDatabase();
  }
}

async function closeMongoConnection() {
  if (mongoIdleTimer) clearTimeout(mongoIdleTimer);
  mongoIdleTimer = null;
  const client = sharedClient || await sharedClientPromise?.catch(() => null);
  sharedClient = null;
  sharedClientPromise = null;
  activeMongoUsers = 0;
  if (client) await client.close().catch(() => {});
}

function enrichmentPath(ticker, fiscalPeriod) {
  const safeTicker = String(ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const safePeriod = String(fiscalPeriod || '').toUpperCase().replace(/[^0-9Q]/g, '');
  return path.join(ROOT, safeTicker, `${safePeriod}.json`);
}

function readEnrichmentLocal(ticker, fiscalPeriod) {
  const file = enrichmentPath(ticker, fiscalPeriod);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildCallToneSeries(chunks) {
  const sectionRank = { prepared: 0, qa: 1 };
  return (chunks || [])
    .filter(chunk => (chunk.role === 'Management' || chunk.role === 'Analyst') && chunk.tone?.composite)
    .map((chunk, index) => ({ chunk, index }))
    .sort((a, b) => (sectionRank[a.chunk.section] ?? 2) - (sectionRank[b.chunk.section] ?? 2)
      || a.index - b.index)
    .map(({ chunk }) => ({
      role: chunk.role,
      investorConfidence: chunk.tone.composite.investorConfidence,
    }));
}

async function readEnrichment(ticker, fiscalPeriod) {
  if (process.env.MONGODB_URI) {
    try {
      const mongoResult = await withMongoDatabase(async database => {
        // Cross-quarter data has its own lightweight endpoint. Excluding its
        // duplicated snapshot keeps a period-detail response small.
        const doc = await database.collection('transcript_enrichments').findOne(
          { ticker: String(ticker).toUpperCase(), fiscal_period: String(fiscalPeriod).toUpperCase() },
          { projection: { _id: 0, crossQuarterAnalysis: 0 } },
        );
        if (!doc) return null;
        const chunks = await database.collection('transcript_chunks')
          .find({ ticker: doc.ticker, fiscal_period: doc.fiscal_period }, { projection: { _id: 0 } })
          .toArray();
        return { ...doc, chunks };
      });
      if (mongoResult) return mongoResult;
    } catch (error) {
      console.warn('[enrichment-store] MongoDB read failed; falling back to local:', error.message);
    }
  }
  return readEnrichmentLocal(ticker, fiscalPeriod);
}

async function listLocalEnrichments() {
  if (process.env.MONGODB_URI) {
    try {
      const mongoResults = await listMongoEnrichments(database => database.collection('transcript_enrichments').find(
        {},
        { projection: { _id: 0, crossQuarterAnalysis: 0 } },
      ).toArray());
      if (mongoResults.length) return mongoResults;
    } catch (error) {
      console.warn('[enrichment-store] MongoDB list failed; falling back to local:', error.message);
    }
  }
  return listLocalEnrichmentFiles();
}

function listLocalEnrichmentFiles() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const directory = path.join(ROOT, entry.name);
      return fs.readdirSync(directory)
        .filter(file => file.endsWith('.json'))
        .map(file => {
          try {
            return JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    });
}

async function listMongoEnrichments(loadDocuments) {
  return withMongoDatabase(async database => {
    const docs = await loadDocuments(database);
    if (!docs.length) return [];
    const tickers = [...new Set(docs.map(doc => doc.ticker).filter(Boolean))];
    const scope = tickers.length === 1 ? { ticker: tickers[0] } : {};
    const [chunks, facts] = await Promise.all([
      database.collection('transcript_chunks').find(scope, { projection: { _id: 0 } }).toArray(),
      database.collection('transcript_facts').find(scope, { projection: { _id: 0 } }).toArray(),
    ]);
    const groupByKey = items => {
      const map = new Map();
      for (const item of items) {
        const key = `${item.ticker}:${item.fiscal_period}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
      }
      return map;
    };
    const chunksByKey = groupByKey(chunks);
    const factsByKey = groupByKey(facts);
    return docs.map(doc => {
      const key = `${doc.ticker}:${doc.fiscal_period}`;
      const docFacts = factsByKey.get(key);
      return {
        ...doc,
        chunks: chunksByKey.get(key) || [],
        ...(docFacts?.length ? { facts: docFacts } : {}),
      };
    });
  });
}

async function listEnrichmentsForTicker(ticker, { completedOnly = false } = {}) {
  const normalizedTicker = String(ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (process.env.MONGODB_URI) {
    try {
      const query = {
        ticker: normalizedTicker,
        ...(completedOnly ? { analysisCompletedAt: { $exists: true } } : {}),
      };
      const mongoResults = await listMongoEnrichments(database => database.collection('transcript_enrichments')
        .find(query, { projection: { _id: 0, crossQuarterAnalysis: 0 } })
        .toArray());
      if (mongoResults.length) return mongoResults;
    } catch (error) {
      console.warn('[enrichment-store] MongoDB ticker read failed; falling back to local:', error.message);
    }
  }
  return listLocalEnrichmentFiles()
    .filter(doc => doc.ticker === normalizedTicker)
    .filter(doc => !completedOnly || doc.analysisCompletedAt);
}

async function readAnalysisCacheForTicker(ticker) {
  const normalizedTicker = String(ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (process.env.MONGODB_URI) {
    try {
      const mongoResult = await withMongoDatabase(async database => {
        const [result] = await database.collection('transcript_enrichments').aggregate([
          { $match: { ticker: normalizedTicker, analysisCompletedAt: { $exists: true } } },
          {
            $facet: {
              metadata: [{ $count: 'transcriptCount' }],
              latest: [
                { $sort: { year: -1, quarter: -1 } },
                { $limit: 1 },
                {
                  $project: {
                    _id: 0,
                    ticker: 1,
                    fiscal_period: 1,
                    transcriptAnalysis: 1,
                    crossQuarterAnalysis: 1,
                  },
                },
              ],
              transcripts: [
                { $sort: { year: 1, quarter: 1 } },
                {
                  $project: {
                    _id: 0,
                    ticker: 1,
                    quarter: 1,
                    year: 1,
                    fiscal_period: 1,
                    analysisCompletedAt: 1,
                    factSummary: 1,
                    stats: 1,
                    toneSummary: 1,
                    keyFigures: 1,
                    transcriptAnalysis: 1,
                    callToneSeries: 1,
                  },
                },
              ],
            },
          },
        ]).toArray();
        const transcriptCount = result?.metadata?.[0]?.transcriptCount || 0;
        return transcriptCount
          ? { transcriptCount, latest: result.latest[0], transcripts: result.transcripts }
          : null;
      });
      if (mongoResult) return mongoResult;
    } catch (error) {
      console.warn('[enrichment-store] MongoDB analysis-cache read failed; falling back to local:', error.message);
    }
  }
  const completed = listLocalEnrichmentFiles()
    .filter(doc => doc.ticker === normalizedTicker && doc.analysisCompletedAt)
    .sort((a, b) => `${a.year}${a.quarter}`.localeCompare(`${b.year}${b.quarter}`));
  return completed.length
    ? { transcriptCount: completed.length, latest: completed.at(-1), transcripts: completed }
    : null;
}

async function listAnalyzedTickers() {
  if (process.env.MONGODB_URI) {
    try {
      const mongoTickers = await withMongoDatabase(database => database.collection('transcript_enrichments')
        .distinct('ticker', { analysisCompletedAt: { $exists: true } }));
      if (mongoTickers.length) return mongoTickers;
    } catch (error) {
      console.warn('[enrichment-store] MongoDB ticker list failed; falling back to local:', error.message);
    }
  }
  return [...new Set(listLocalEnrichmentFiles()
    .filter(doc => doc.analysisCompletedAt)
    .map(doc => doc.ticker)
    .filter(Boolean))];
}

// Which enrichments a batch script should process. A run scoped to a single
// transcript (the UI's one-click analyze) must read the LOCAL file directly:
// the FinBERT step writes tone into the local file, so mid-run the Mongo copy
// is stale — reading Mongo-first would drop that tone and the composite/facts
// built on top of it. Unscoped runs keep the original Mongo-first behavior.
async function loadEnrichmentsForRun({ ticker, period } = {}) {
  if (ticker && period) {
    const local = readEnrichmentLocal(ticker, period);
    return local ? [local] : [];
  }
  return listLocalEnrichments();
}

async function saveEnrichment(enrichment) {
  const file = enrichmentPath(enrichment.ticker, enrichment.fiscal_period);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(enrichment, null, 2));
  } catch (fsError) {
    console.warn('[enrichment-store] Local file write skipped (read-only fs):', fsError.message);
  }

  let mongoStored = false;
  if (process.env.MONGODB_URI) {
    try {
      mongoStored = await withMongoDatabase(async database => {
        const enrichments = database.collection('transcript_enrichments');
        const chunks = database.collection('transcript_chunks');
        const facts = database.collection('transcript_facts');
        await enrichments.createIndex({ ticker: 1, fiscal_period: 1 }, { unique: true, background: true });
        await chunks.createIndex({ id: 1 }, { unique: true, background: true });
        await chunks.createIndex({ ticker: 1, fiscal_period: 1, topic: 1 }, { background: true });
        await facts.createIndex({ id: 1 }, { unique: true, background: true });
        await facts.createIndex({ ticker: 1, fiscal_period: 1, topic: 1 }, { background: true });

        const { chunks: chunkDocuments, facts: factDocuments = [], ...summary } = enrichment;
        if (chunkDocuments.length) summary.callToneSeries = buildCallToneSeries(chunkDocuments);
        await enrichments.updateOne(
          { ticker: enrichment.ticker, fiscal_period: enrichment.fiscal_period },
          {
            $set: { ...summary, updatedAt: new Date().toISOString() },
            $unset: { facts: '' },
          },
          { upsert: true },
        );
        await chunks.deleteMany({ ticker: enrichment.ticker, fiscal_period: enrichment.fiscal_period });
        if (chunkDocuments.length) {
          await chunks.insertMany(chunkDocuments.map(chunk => ({
            ...chunk,
            storedAt: new Date().toISOString(),
          })));
        }
        await facts.deleteMany({ ticker: enrichment.ticker, fiscal_period: enrichment.fiscal_period });
        if (factDocuments.length) {
          await facts.insertMany(factDocuments.map(fact => ({
            ...fact,
            storedAt: new Date().toISOString(),
          })));
        }
        return true;
      });
    } catch (error) {
      console.warn('[enrichment-store] MongoDB write failed; local file was saved:', error.message);
    }
  }

  return {
    file: path.relative(path.join(__dirname, '..', '..'), file),
    mongoStored,
  };
}

module.exports = {
  closeMongoConnection,
  enrichmentPath,
  listAnalyzedTickers,
  listEnrichmentsForTicker,
  listLocalEnrichments,
  loadEnrichmentsForRun,
  readAnalysisCacheForTicker,
  readEnrichment,
  readEnrichmentLocal,
  saveEnrichment,
};
