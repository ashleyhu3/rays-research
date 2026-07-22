'use strict';

// Split the legacy combined options-report blob into compressed documents so
// the Alerts page can read report JSON and PDF metadata without transferring
// the embedded base64 PDF.
const zlib = require('zlib');
const { MongoClient } = require('mongodb');

let client;
(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 0,
    compressors: ['zlib'],
    zlibCompressionLevel: 6,
  });
  await client.connect();
  const collection = client.db(process.env.MONGODB_DB || undefined).collection('blobs');
  const writeCompressed = async (id, value) => {
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(value)), { level: 6 });
    await collection.updateOne(
      { _id: id },
      { $set: { compressed, encoding: 'gzip-json', updatedAt: new Date() } },
      { upsert: true },
    );
  };

  const latestDoc = await collection.findOne(
    { _id: 'dailyOptionsReport' },
    { projection: { 'data.latest': 1 } },
  );
  if (!latestDoc?.data?.latest) throw new Error('dailyOptionsReport.latest is missing');
  await writeCompressed('optionsReport:latest', latestDoc.data.latest);

  const index = await collection.aggregate([
    { $match: { _id: 'dailyOptionsReport' } },
    { $project: {
      _id: 0,
      latestDate: '$data.latest.date',
      archiveDates: {
        $map: { input: { $objectToArray: { $ifNull: ['$data.byDate', {}] } }, in: '$$this.k' },
      },
    } },
  ]).next();
  const dates = [index?.latestDate, ...(index?.archiveDates || [])].filter(Boolean).sort().reverse();
  await writeCompressed('optionsReport:availableDates', dates);

  for (const date of index?.archiveDates || []) {
    const doc = await collection.findOne(
      { _id: 'dailyOptionsReport' },
      { projection: { [`data.byDate.${date}`]: 1 } },
    );
    const report = doc?.data?.byDate?.[date];
    if (report) await writeCompressed(`optionsReport:date:${date}`, report);
  }

  const pdfDoc = await collection.findOne(
    { _id: 'dailyOptionsReport' },
    { projection: { 'data.latestPdf': 1 } },
  );
  if (pdfDoc?.data?.latestPdf) {
    const pdf = pdfDoc.data.latestPdf;
    await writeCompressed('optionsReport:latestPdf', pdf);
    const meta = {
      date: pdf.date,
      filename: pdf.filename,
      size: pdf.size,
      generatedAt: pdf.generatedAt,
      updatedAt: pdf.generatedAt,
      tickers: pdf.tickers,
      url: `/api/alerts/daily-options-report/pdf?date=${encodeURIComponent(pdf.date)}`,
    };
    await writeCompressed('optionsReport:latestPdfMeta', meta);
  }

  console.log(`[options-report] migrated latest report and ${index?.archiveDates?.length || 0} archive dates`);
  await client.close();
  client = null;
})().catch(error => {
  console.error('[options-report]', error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (client) await client.close().catch(() => {});
});
