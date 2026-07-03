'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'data', 'transcripts', 'processed');

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

async function readEnrichment(ticker, fiscalPeriod) {
  if (process.env.MONGODB_URI) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    try {
      await client.connect();
      const database = client.db(process.env.MONGODB_DB || undefined);
      const doc = await database.collection('transcript_enrichments').findOne(
        { ticker: String(ticker).toUpperCase(), fiscal_period: String(fiscalPeriod).toUpperCase() },
        { projection: { _id: 0 } },
      );
      if (doc) {
        const chunks = await database.collection('transcript_chunks')
          .find({ ticker: doc.ticker, fiscal_period: doc.fiscal_period }, { projection: { _id: 0 } })
          .toArray();
        return { ...doc, chunks };
      }
    } catch (error) {
      console.warn('[enrichment-store] MongoDB read failed; falling back to local:', error.message);
    } finally {
      await client.close().catch(() => {});
    }
  }
  return readEnrichmentLocal(ticker, fiscalPeriod);
}

async function listLocalEnrichments() {
  if (process.env.MONGODB_URI) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    try {
      await client.connect();
      const database = client.db(process.env.MONGODB_DB || undefined);
      const docs = await database.collection('transcript_enrichments')
        .find({}, { projection: { _id: 0 } })
        .toArray();
      if (docs.length) {
        // Chunks are stored in a separate collection; re-attach them per
        // enrichment. The analysis manager reparses any document lacking
        // chunks, so returning summary-only docs makes it throw on the
        // deployed site (which reads from Mongo) while working locally.
        const chunks = await database.collection('transcript_chunks')
          .find({}, { projection: { _id: 0 } })
          .toArray();
        const byKey = new Map();
        for (const chunk of chunks) {
          const key = `${chunk.ticker}:${chunk.fiscal_period}`;
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key).push(chunk);
        }
        return docs.map(doc => ({
          ...doc,
          chunks: byKey.get(`${doc.ticker}:${doc.fiscal_period}`) || [],
        }));
      }
    } catch (error) {
      console.warn('[enrichment-store] MongoDB list failed; falling back to local:', error.message);
    } finally {
      await client.close().catch(() => {});
    }
  }
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
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    try {
      await client.connect();
      const database = client.db(process.env.MONGODB_DB || undefined);
      const enrichments = database.collection('transcript_enrichments');
      const chunks = database.collection('transcript_chunks');
      const facts = database.collection('transcript_facts');
      await enrichments.createIndex({ ticker: 1, fiscal_period: 1 }, { unique: true, background: true });
      await chunks.createIndex({ id: 1 }, { unique: true, background: true });
      await chunks.createIndex({ ticker: 1, fiscal_period: 1, topic: 1 }, { background: true });
      await facts.createIndex({ id: 1 }, { unique: true, background: true });
      await facts.createIndex({ ticker: 1, fiscal_period: 1, topic: 1 }, { background: true });

      const { chunks: chunkDocuments, facts: factDocuments = [], ...summary } = enrichment;
      await enrichments.updateOne(
        { ticker: enrichment.ticker, fiscal_period: enrichment.fiscal_period },
        {
          $set: { ...summary, updatedAt: new Date().toISOString() },
          $unset: { facts: '' },
        },
        { upsert: true },
      );
      await chunks.deleteMany({
        ticker: enrichment.ticker,
        fiscal_period: enrichment.fiscal_period,
      });
      if (chunkDocuments.length) {
        await chunks.insertMany(chunkDocuments.map(chunk => ({
          ...chunk,
          storedAt: new Date().toISOString(),
        })));
      }
      await facts.deleteMany({
        ticker: enrichment.ticker,
        fiscal_period: enrichment.fiscal_period,
      });
      if (factDocuments.length) {
        await facts.insertMany(factDocuments.map(fact => ({
          ...fact,
          storedAt: new Date().toISOString(),
        })));
      }
      mongoStored = true;
    } catch (error) {
      console.warn('[enrichment-store] MongoDB write failed; local file was saved:', error.message);
    } finally {
      await client.close().catch(() => {});
    }
  }

  return {
    file: path.relative(path.join(__dirname, '..', '..'), file),
    mongoStored,
  };
}

module.exports = {
  enrichmentPath,
  listLocalEnrichments,
  readEnrichment,
  saveEnrichment,
};
