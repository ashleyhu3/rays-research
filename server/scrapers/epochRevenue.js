'use strict';
const axios = require('axios');

/**
 * AI company revenue data from Epoch AI (epoch.ai/data/ai-companies).
 *
 * Source: epoch.ai publishes CSV files at /data/ai_companies_revenue_reports.csv
 * (publicly accessible, no auth needed). The data contains timestamped annualized
 * revenue run rates for frontier AI companies, sourced from company disclosures
 * and media reports.
 *
 * Returns structured per-company time-series data for the revenue chart.
 * No history file needed — the CSV already is the historical record.
 */

const CSV_URL = 'https://epoch.ai/data/ai_companies_revenue_reports.csv';

// Companies to display, in order (matching epoch.ai's colour scheme).
const TRACKED = ['OpenAI', 'Anthropic', 'Google', 'xAI', 'Mistral AI', 'DeepSeek', 'Meta'];

// Simple RFC-4180 CSV parser that handles quoted fields.
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim(); });
    return row;
  });
}

function splitLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

async function getEpochRevenueData() {
  let text;
  try {
    ({ data: text } = await axios.get(CSV_URL, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      responseType: 'text',
    }));
  } catch (e) {
    console.warn('[epochRevenue] CSV fetch failed:', e.message);
    return null;
  }

  const rows = parseCSV(text);

  // Build per-company series: { company → [{ date, value }] } sorted by date.
  // Only keep "Full company" scope rows with a valid annualized revenue figure.
  const raw = {};
  for (const row of rows) {
    const company = row['Company']?.trim();
    if (!TRACKED.includes(company)) continue;
    const scope = row['Scope']?.trim();
    if (scope && scope !== 'Full company') continue;
    const date = row['Date']?.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const v = parseFloat(row['Annualized revenue (USD)']);
    if (!Number.isFinite(v) || v <= 0) continue;
    (raw[company] ??= []).push({ date, value: v });
  }

  // Sort each company's data points by date ascending.
  const series = {};
  for (const company of TRACKED) {
    if (!raw[company]) continue;
    series[company] = raw[company]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(p => ({ date: p.date, value: +(p.value / 1e9).toFixed(2) })); // convert to $B
  }

  if (Object.keys(series).length === 0) return null;

  return {
    series,
    companies: TRACKED.filter(c => series[c]),
    unit: 'USD billions (annualized run rate)',
    asOf: new Date().toISOString().slice(0, 10),
    source: 'Epoch AI — epoch.ai/data/ai-companies',
  };
}

module.exports = { getEpochRevenueData };
