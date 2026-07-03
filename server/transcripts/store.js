'use strict';

const fs = require('fs');
const path = require('path');

const TRANSCRIPT_ROOT = path.join(__dirname, '..', 'data', 'transcripts');

function providerRoot(provider) {
  const safeProvider = String(provider || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return path.join(TRANSCRIPT_ROOT, safeProvider);
}

function documentKey(document) {
  return `${document.ticker}-${document.fiscal_period}`.replace(/[^A-Z0-9.-]/gi, '_');
}

function transcriptMarkdown(document) {
  const renderSection = (title, blocks) => {
    const body = blocks.map(block => [
      `### ${block.speaker}${block.title ? ` — ${block.title}` : ''}`,
      '',
      block.timestamp ? `_${block.timestamp}_` : '',
      block.text,
    ].filter(Boolean).join('\n\n')).join('\n\n');
    return `## ${title}\n\n${body || '_No blocks found._'}`;
  };

  return [
    `# ${document.ticker} ${document.fiscal_period} Earnings Call`,
    '',
    `- Earnings date: ${document.earnings_date || 'Unknown'}`,
    `- Provider: ${document.metadata?.provider || 'octagon'}`,
    `- Speakers: ${document.stats.speakers}`,
    `- Words: ${document.stats.wordCount.toLocaleString('en-US')}`,
    '',
    renderSection('Prepared Remarks', document.prepared),
    '',
    renderSection('Q&A', document.qa),
    '',
  ].join('\n');
}

async function saveTranscript(document) {
  const key = documentKey(document);
  const directory = path.join(providerRoot(document.metadata?.provider), document.ticker);
  const jsonPath = path.join(directory, `${document.fiscal_period}.json`);
  const markdownPath = path.join(directory, `${document.fiscal_period}.md`);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2));
    fs.writeFileSync(markdownPath, transcriptMarkdown(document));
  } catch (fsError) {
    console.warn('[transcript-store] Local file write skipped (read-only fs):', fsError.message);
  }

  let mongoStored = false;
  if (process.env.MONGODB_URI) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    try {
      await client.connect();
      const collection = client.db(process.env.MONGODB_DB || undefined).collection('normalized_transcripts');
      await collection.createIndex({ ticker: 1, fiscal_period: 1 }, { unique: true, background: true });
      await collection.updateOne(
        { ticker: document.ticker, fiscal_period: document.fiscal_period },
        { $set: { ...document, updatedAt: new Date().toISOString() } },
        { upsert: true },
      );
      mongoStored = true;
    } catch (error) {
      console.warn('[transcript-store] MongoDB write failed; local files were saved:', error.message);
    } finally {
      await client.close().catch(() => {});
    }
  }

  return {
    key,
    json: path.relative(path.join(__dirname, '..', '..'), jsonPath),
    markdown: path.relative(path.join(__dirname, '..', '..'), markdownPath),
    mongoStored,
  };
}

function readLocalLibrary() {
  if (!fs.existsSync(TRANSCRIPT_ROOT)) return [];
  const providerDirectories = fs.readdirSync(TRANSCRIPT_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(TRANSCRIPT_ROOT, entry.name));

  return providerDirectories
    .flatMap(providerDirectory => fs.readdirSync(providerDirectory, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => {
        const directory = path.join(providerDirectory, entry.name);
        return fs.readdirSync(directory)
          .filter(file => file.endsWith('.json'))
          .map(file => {
            try {
              const document = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
              return {
                ticker: document.ticker,
                quarter: document.quarter,
                year: document.year,
                fiscal_period: document.fiscal_period,
                earnings_date: document.earnings_date,
                stats: document.stats,
                metadata: document.metadata,
                transcript: document,
              };
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }))
    .sort((a, b) => String(b.metadata?.collectedAt || '').localeCompare(String(a.metadata?.collectedAt || '')));
}

async function listTranscripts() {
  const local = readLocalLibrary();
  if (!process.env.MONGODB_URI) return local;

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const documents = await client.db(process.env.MONGODB_DB || undefined)
      .collection('normalized_transcripts')
      .find({})
      .sort({ 'metadata.collectedAt': -1 })
      .limit(30)
      .toArray();
    const merged = new Map(local.map(item => [`${item.ticker}:${item.fiscal_period}`, item]));
    for (const { _id, updatedAt, ...document } of documents) {
      const key = `${document.ticker}:${document.fiscal_period}`;
      if (!merged.has(key)) {
        merged.set(key, {
          ticker: document.ticker,
          quarter: document.quarter,
          year: document.year,
          fiscal_period: document.fiscal_period,
          earnings_date: document.earnings_date,
          stats: document.stats,
          metadata: document.metadata,
          transcript: document,
        });
      }
    }
    return [...merged.values()]
      .sort((a, b) => String(b.metadata?.collectedAt || '').localeCompare(String(a.metadata?.collectedAt || '')))
      .slice(0, 30);
  } catch (error) {
    console.warn('[transcript-store] MongoDB library read failed; using local files:', error.message);
    return local;
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { listTranscripts, readLocalLibrary, saveTranscript, transcriptMarkdown };
