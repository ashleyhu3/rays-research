'use strict';

const PREPARED_HEADING = /^(prepared remarks?|presentation|opening remarks?|management discussion)$/i;
const QA_HEADING = /^(questions?(?:\s*(?:and|&)\s*answers?)?|q\s*&\s*a|question-and-answer session)$/i;
const OPERATOR_RX = /\boperator\b/i;
const ANALYST_RX = /\banalyst\b|research|capital|securities|equity|markets|bank|partners|asset management|investments?|advisors?/i;
const MANAGEMENT_RX = /\b(ceo|cfo|coo|cto|cio|cmo|chief|president|vice president|\bvp\b|director|founder|chair|officer|treasurer|investor relations|management)\b/i;

function cleanText(value) {
  return String(value ?? '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizePeriod(quarterInput, yearInput) {
  const raw = `${quarterInput ?? ''} ${yearInput ?? ''}`.toUpperCase();
  const compact = raw.replace(/\s+/g, '');
  const yearMatch = compact.match(/(20\d{2})/);
  const quarterMatch = compact.match(/Q([1-4])/);
  const numericQuarter = /^[1-4]$/.test(String(quarterInput ?? '').trim())
    ? Number(quarterInput)
    : null;
  const year = Number(yearInput) || Number(yearMatch?.[1]);
  const quarterNumber = Number(quarterMatch?.[1]) || numericQuarter;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('year must be a four-digit year between 2000 and 2100');
  }
  if (!Number.isInteger(quarterNumber) || quarterNumber < 1 || quarterNumber > 4) {
    throw new Error('quarter must be Q1, Q2, Q3, or Q4');
  }

  return {
    year,
    quarter: `Q${quarterNumber}`,
    fiscalPeriod: `${year}Q${quarterNumber}`,
  };
}

function inferRole(name, title = '') {
  const value = `${name ?? ''} ${title ?? ''}`.trim();
  if (OPERATOR_RX.test(value)) return 'Operator';
  if (MANAGEMENT_RX.test(value)) return 'Management';
  if (ANALYST_RX.test(value)) return 'Analyst';
  return 'Unknown';
}

function parseSpeakerLabel(value, knownSpeakers = []) {
  let label = cleanText(value).replace(/^\[|\]$/g, '').trim();
  if (!label || label.length > 140) return null;

  const known = knownSpeakers.find(s => {
    const name = typeof s === 'string' ? s : s?.name;
    return name && name.toLowerCase() === label.toLowerCase();
  });
  if (known) {
    const name = typeof known === 'string' ? known : known.name;
    const title = typeof known === 'string' ? '' : (known.title || '');
    return { name, title, role: inferRole(name, title) };
  }

  if (OPERATOR_RX.test(label) && label.split(/\s+/).length <= 4) {
    return { name: 'Operator', title: '', role: 'Operator' };
  }

  const separated = label.match(/^(.{2,80}?)\s+(?:--|—|–|-)\s+(.{2,100})$/);
  if (separated) {
    const name = separated[1].trim();
    const title = separated[2].trim();
    if (looksLikeName(name)) return { name, title, role: inferRole(name, title) };
  }

  const parenthetical = label.match(/^(.{2,80}?)\s*\(([^)]{2,100})\)$/);
  if (parenthetical && looksLikeName(parenthetical[1])) {
    const name = parenthetical[1].trim();
    const title = parenthetical[2].trim();
    return { name, title, role: inferRole(name, title) };
  }

  if (looksLikeName(label)) {
    return { name: label, title: '', role: inferRole(label) };
  }
  return null;
}

function looksLikeName(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 80 || /[.!?]$/.test(text) || /\d{3,}/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length > 8) return false;
  if (OPERATOR_RX.test(text)) return true;
  const nameWords = words.filter(word => /^[A-Z][A-Za-z'.-]*$/.test(word));
  return nameWords.length >= Math.min(2, words.length);
}

function extractTimestamp(text) {
  const match = String(text ?? '').match(/^\s*[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?[\s—–-]*/);
  return match
    ? { timestamp: match[1], text: String(text).slice(match[0].length).trim() }
    : { timestamp: null, text: String(text ?? '').trim() };
}

function parseTextBlocks(text, {
  ticker,
  fiscalPeriod,
  knownSpeakers = [],
  initialSection = 'prepared',
} = {}) {
  const lines = cleanText(text).split(/\n/);
  const blocks = [];
  let section = initialSection;
  let speaker = { name: 'Unknown speaker', title: '', role: 'Unknown' };
  let paragraph = [];
  let timestamp = null;

  const flush = () => {
    const value = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    paragraph = [];
    if (!value) return;
    const role = speaker.role || inferRole(speaker.name, speaker.title);
    const effectiveSection = section === 'prepared' && role === 'Analyst' ? 'qa' : section;
    if (effectiveSection === 'qa') section = 'qa';
    blocks.push({
      id: blocks.length + 1,
      speaker: speaker.name || 'Unknown speaker',
      title: speaker.title || '',
      role,
      timestamp,
      section: effectiveSection,
      kind: effectiveSection === 'qa'
        ? (role === 'Analyst' ? 'question' : role === 'Management' ? 'answer' : 'transition')
        : 'remark',
      company: ticker,
      quarter: fiscalPeriod,
      paragraph: blocks.filter(block => block.speaker === speaker.name).length + 1,
      text: value,
    });
    timestamp = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flush();
      continue;
    }

    const heading = line.replace(/[:\s]+$/, '');
    if (PREPARED_HEADING.test(heading)) {
      flush();
      section = 'prepared';
      continue;
    }
    if (QA_HEADING.test(heading)) {
      flush();
      section = 'qa';
      continue;
    }

    const inline = line.match(/^(.{2,140}?)\s*:\s+(.+)$/);
    if (inline) {
      const parsed = parseSpeakerLabel(inline[1], knownSpeakers);
      if (parsed) {
        flush();
        speaker = parsed;
        if (section === 'prepared' && speaker.role === 'Analyst') section = 'qa';
        const timed = extractTimestamp(inline[2]);
        timestamp = timed.timestamp;
        if (timed.text) paragraph.push(timed.text);
        continue;
      }
    }

    const possibleSpeaker = parseSpeakerLabel(line, knownSpeakers);
    const nextLine = lines[index + 1]?.trim() ?? '';
    if (possibleSpeaker && nextLine && !PREPARED_HEADING.test(nextLine) && !QA_HEADING.test(nextLine)) {
      flush();
      speaker = possibleSpeaker;
      if (section === 'prepared' && speaker.role === 'Analyst') section = 'qa';
      continue;
    }

    const timed = extractTimestamp(line);
    if (!paragraph.length && timed.timestamp) timestamp = timed.timestamp;
    if (timed.text) paragraph.push(timed.text);
  }

  flush();
  return blocks;
}

function normalizeStructuredBlock(item, defaults, index) {
  if (typeof item === 'string') {
    const parsed = parseTextBlocks(item, defaults);
    if (parsed.length === 1) return parsed[0];
    return parsed;
  }

  const speakerName = cleanText(item?.speaker || item?.name || item?.participant || 'Unknown speaker');
  const knownSpeaker = defaults.knownSpeakers.find(speaker => {
    const name = typeof speaker === 'string' ? speaker : speaker?.name || speaker?.speaker;
    return name && name.toLowerCase() === speakerName.toLowerCase();
  });
  const knownTitle = typeof knownSpeaker === 'string' ? '' : knownSpeaker?.title || knownSpeaker?.position || '';
  const title = cleanText(item?.title || item?.position || knownTitle);
  const knownRole = typeof knownSpeaker === 'string' ? '' : knownSpeaker?.role || '';
  const explicitRole = cleanText(item?.role || knownRole);
  const role = /^(Management|Analyst|Operator|Unknown)$/i.test(explicitRole)
    ? `${explicitRole[0].toUpperCase()}${explicitRole.slice(1).toLowerCase()}`
    : inferRole(speakerName, title);
  const timed = extractTimestamp(item?.text || item?.content || item?.paragraph || '');
  const section = defaults.initialSection === 'qa' || String(item?.section || '').toLowerCase().includes('question')
    ? 'qa'
    : 'prepared';

  if (!timed.text) return null;
  return {
    id: index + 1,
    speaker: speakerName,
    title,
    role,
    timestamp: cleanText(item?.timestamp || timed.timestamp) || null,
    section,
    kind: section === 'qa'
      ? (role === 'Analyst' ? 'question' : role === 'Management' ? 'answer' : 'transition')
      : 'remark',
    company: defaults.ticker,
    quarter: defaults.fiscalPeriod,
    paragraph: Number(item?.paragraph) || 1,
    text: timed.text,
  };
}

function blocksFromSection(sectionValue, defaults) {
  if (!sectionValue) return [];
  if (typeof sectionValue === 'string') return parseTextBlocks(sectionValue, defaults);
  if (!Array.isArray(sectionValue)) return [];

  return sectionValue.flatMap((item, index) => {
    const normalized = normalizeStructuredBlock(item, defaults, index);
    return Array.isArray(normalized) ? normalized : normalized ? [normalized] : [];
  });
}

function normalizeSpeakers(inputSpeakers, blocks) {
  const byName = new Map();
  for (const item of Array.isArray(inputSpeakers) ? inputSpeakers : []) {
    const name = cleanText(typeof item === 'string' ? item : item?.name || item?.speaker);
    if (!name) continue;
    const title = cleanText(typeof item === 'string' ? '' : item?.title || item?.position);
    byName.set(name.toLowerCase(), {
      name,
      title,
      role: cleanText(typeof item === 'string' ? '' : item?.role) || inferRole(name, title),
    });
  }
  for (const block of blocks) {
    if (block.speaker === 'Unknown speaker') continue;
    const key = block.speaker.toLowerCase();
    const current = byName.get(key);
    byName.set(key, {
      name: block.speaker,
      title: current?.title || block.title || '',
      role: current?.role || block.role,
    });
  }
  return [...byName.values()];
}

function parseTranscriptDocument(input = {}) {
  const source = input?.data && typeof input.data === 'object' ? input.data : input;
  const ticker = cleanText(source.ticker || source.symbol).toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!ticker) throw new Error('ticker is required');

  const period = normalizePeriod(source.quarter || source.fiscal_period, source.year);
  const knownSpeakers = Array.isArray(source.speakers) ? source.speakers : [];
  const defaults = {
    ticker,
    fiscalPeriod: period.fiscalPeriod,
    knownSpeakers,
  };

  let prepared = blocksFromSection(source.prepared || source.prepared_remarks, {
    ...defaults,
    initialSection: 'prepared',
  });
  let qa = blocksFromSection(source.qa || source.q_and_a || source.questions_and_answers, {
    ...defaults,
    initialSection: 'qa',
  });

  if (!prepared.length && !qa.length) {
    const rawBlocks = Array.isArray(source.transcript)
      ? blocksFromSection(source.transcript, { ...defaults, initialSection: 'prepared' })
      : parseTextBlocks(source.transcript || source.raw_text || source.text || '', {
          ...defaults,
          initialSection: 'prepared',
        });
    prepared = rawBlocks.filter(block => block.section === 'prepared');
    qa = rawBlocks.filter(block => block.section === 'qa');
  }

  const speakerBlocks = [...prepared, ...qa].map((block, index) => ({
    ...block,
    id: index + 1,
    paragraph: [...prepared, ...qa]
      .slice(0, index + 1)
      .filter(candidate => candidate.speaker === block.speaker).length,
  }));
  prepared = speakerBlocks.filter(block => block.section === 'prepared');
  qa = speakerBlocks.filter(block => block.section === 'qa');

  if (!speakerBlocks.length) {
    throw new Error('The transcript did not contain recognizable speaker blocks.');
  }

  const transcript = cleanText(
    typeof source.transcript === 'string'
      ? source.transcript
      : speakerBlocks.map(block => `${block.speaker}${block.title ? ` — ${block.title}` : ''}\n${block.text}`).join('\n\n'),
  );
  const metadata = {
    ...(source.metadata && typeof source.metadata === 'object' ? source.metadata : {}),
    provider: cleanText(source.metadata?.provider || source.provider || 'octagon'),
    sourceUrl: cleanText(source.metadata?.source_url || source.metadata?.sourceUrl || source.source_url) || null,
    collectedAt: source.metadata?.collected_at || source.metadata?.collectedAt || new Date().toISOString(),
    parserVersion: 1,
  };

  return {
    ticker,
    quarter: period.quarter,
    year: period.year,
    fiscal_period: period.fiscalPeriod,
    earnings_date: cleanText(source.earnings_date || source.call_date || source.date) || null,
    speakers: normalizeSpeakers(knownSpeakers, speakerBlocks),
    transcript,
    prepared,
    qa,
    speaker_blocks: speakerBlocks,
    metadata,
    stats: {
      speakers: normalizeSpeakers(knownSpeakers, speakerBlocks).length,
      preparedBlocks: prepared.length,
      qaBlocks: qa.length,
      totalBlocks: speakerBlocks.length,
      wordCount: speakerBlocks.reduce((sum, block) => sum + block.text.split(/\s+/).filter(Boolean).length, 0),
    },
  };
}

module.exports = {
  cleanText,
  inferRole,
  normalizePeriod,
  parseTextBlocks,
  parseTranscriptDocument,
};
