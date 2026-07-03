'use strict';

const { listTranscripts } = require('../../server/transcripts/store');

module.exports = async function handler(_req, res) {
  try {
    res.json(await listTranscripts());
  } catch (e) {
    console.error('[transcripts:library]', e.message);
    res.status(500).json({ error: e.message });
  }
};
