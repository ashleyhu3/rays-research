/**
 * Fig. 70 — Server supply chain (Source: Company data, Nomura research)
 *
 * Scraped verbatim from the Nomura server supply-chain matrix. Rendered by
 * src/pages/supply-chain/SupplyChainMatrix.jsx as a rich-text hierarchical
 * heatmap: every supplier string is preserved (zero data loss), while cell
 * background encodes supplier-count resilience and a left gutter bar encodes
 * the tier category.
 *
 * Cell encoding (DSL parsed in SupplyChainMatrix.jsx):
 *   - Suppliers are separated by ' · '. Commas inside a supplier's
 *     parenthetical detail are therefore safe (e.g. "Hon Hai (GB200/300, VR200)").
 *   - A trailing '?' on a name marks it conditional/uncertain (rendered muted).
 *   - A leading '!' marks a supplier tied to a unique/exclusive strategy
 *     (rendered with a 🔒 lock, e.g. Tesla's in-house Dojo, Samsung Foundry).
 *   - 'N.A.' means not applicable (critical / no in-house capability).
 *   - '' (empty) means no data disclosed for that customer.
 */

export const MATRIX_COLUMNS = [
  { key: 'amazon',    label: 'Amazon',    sub: 'AI ASIC' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'google',    label: 'Google',    sub: 'AI ASIC' },
  { key: 'meta',      label: 'Meta' },
  { key: 'nvidia',    label: 'NVIDIA',    sub: 'AI GPU' },
  { key: 'amd',       label: 'AMD',       sub: 'AI GPU' },
  { key: 'tesla',     label: 'Tesla / xAI' },
  { key: 'dell',      label: 'Dell' },
  { key: 'hpe',       label: 'HPE' },
];

// Tier metadata for the coloured left gutter bar.
export const MATRIX_GROUPS = {
  odm:      { label: 'ODM / EMS',            color: '#3b82f6' }, // blue  — hardware assembly
  mech:     { label: 'Mechanical & Power',   color: '#f97316' }, // orange — physical infra
  silicon:  { label: 'Silicon & IC',         color: '#ef4444' }, // red   — semiconductors
  pcb:      { label: 'PCB / CCL',            color: '#22c55e' }, // green — substrates / boards
};

/**
 * Rows in display order. Each row belongs to a group and holds either:
 *   - cells:    { [colKey]: 'dsl string' }  → one cell per customer column, or
 *   - segments: [{ span, cell }]            → wide industry-shared rows (colSpan)
 */
export const MATRIX_ROWS = [
  // ── ODM / EMS ──────────────────────────────────────────────────────────
  {
    group: 'odm', label: 'ODM / EMS', sub: 'CPU / general server',
    cells: {
      amazon:    'Quanta · Hon Hai · Inventec · Wiwynn',
      microsoft: 'Hon Hai · Wiwynn · Inventec · Quanta · Lenovo',
      google:    'Quanta · Inventec · Hon Hai · Celestica',
      meta:      'Wiwynn · Quanta',
      nvidia:    'N.A.',
      amd:       'N.A.',
      tesla:     '',
      dell:      'Hon Hai · Wistron · Inventec · Compal',
      hpe:       'Inventec · Hon Hai · Wistron',
    },
  },
  {
    group: 'odm', label: 'ODM / EMS', sub: 'AI ASIC',
    cells: {
      amazon:    'Wiwynn (cards, L6, L10 racks) · Accton (cards, L6) · Fabrinet (L6) · Jabil · Flex (L10 racks)',
      microsoft: 'Quanta?',
      google:    'Quanta (Iris) · Celestica · Flex (old gen)',
      meta:      'Celestica · Flex',
      nvidia:    'N.A.',
      amd:       'N.A.',
      tesla:     '!Wistron (Dojo, baseboard)',
      dell:      '',
      hpe:       '',
    },
  },
  {
    group: 'odm', label: 'ODM / EMS', sub: 'GPU (NV, AMD, etc.)',
    cells: {
      amazon:    'Quanta',
      microsoft: 'Hon Hai (GB200/300, VR200) · Quanta (potential 2nd source?)',
      google:    'Quanta',
      meta:      'Quanta (GB200, GB300) · Hon Hai (GB300) · Wiwynn (potentially?)',
      nvidia:    'Hon Hai (module/cards/switches) · Wistron (module/baseboard)',
      amd:       'Wistron (baseboard) · Sanmina · Wiwynn · others',
      tesla:     'Dell · Lenovo · Supermicro',
      dell:      '',
      hpe:       'Wistron (L10, Rack in house)',
    },
  },

  // ── Mechanical & Power ─────────────────────────────────────────────────
  {
    group: 'mech', label: 'Mechanical', sub: 'Chassis',
    cells: {
      amazon: 'Chenbro · AVC · Hon Hai',
      meta:   'Uneec · ?',
      nvidia: 'N.A.',
      amd:    'N.A.',
    },
  },
  {
    group: 'mech', label: 'Mechanical', sub: 'Server Slide Rail',
    cells: {
      amazon:    'King Slide · Repon · Fositek',
      microsoft: 'King Slide · Repon',
      google:    'King Slide · ?',
      meta:      'King Slide',
    },
  },
  {
    group: 'mech', label: 'Power', sub: 'Power supply',
    segments: [{ span: 9, cell: 'Delta · Lite-On Tech · Flex power · AEIS · Megmeet · and etc' }],
  },
  {
    group: 'mech', label: 'Power', sub: 'BBU',
    cells: {
      amazon: 'Lite-On (AES battery) · Delta (Dynapack) · Panasonic',
      google: 'Panasonic',
      meta:   'Delta (Dynapack) · Panasonic',
      nvidia: 'Many in RVL',
    },
  },
  {
    group: 'mech', label: 'Mechanical', sub: 'CPU sockets',
    segments: [{ span: 9, cell: 'Lotes · FIT · TE · Amphenol' }],
  },
  {
    group: 'mech', label: 'Networking', sub: 'Switch',
    cells: {
      amazon:    'Accton · Celestica',
      microsoft: 'Cisco (Wistron?) · Arista?',
      google:    'Celestica?',
      meta:      'Accton · Celestica?',
      nvidia:    'Hon Hai',
    },
  },
  {
    group: 'mech', label: 'Thermal', sub: 'Thermal',
    segments: [
      { span: 7, cell:
        'Thermal Module – air cooling: AVC, Auras, Nidec-CCI, CoolerMaster, Hon Hai · ' +
        'Cold plates: AVC, CoolerMaster, Auras, Delta, Furukawa, Boyd, etc. · ' +
        'CDU: Vertiv, Motivair, CoolIT, Delta, Quanta, Nidec, Auras etc. · ' +
        'CDM: Kaori, Auras, CoolerMaster · ' +
        'Heat spreader: Jentech · ' +
        'Fan: Sunon, Delta, Nidec, AVC' },
      { span: 2, cell: 'CoolIT · Motivair · Lite-On' },
    ],
  },

  // ── Silicon & IC ───────────────────────────────────────────────────────
  {
    group: 'silicon', label: 'Silicon', sub: 'IC partner',
    cells: {
      amazon:    'Marvell · Alchip',
      microsoft: 'GUC · Marvell',
      google:    'Broadcom · MediaTek · Marvell · GUC',
      meta:      'Broadcom',
      tesla:     'Broadcom · Alchip · GUC',
    },
  },
  {
    group: 'silicon', label: 'Silicon', sub: 'Foundry',
    cells: {
      amazon:    'TSMC',
      microsoft: 'TSMC',
      google:    'TSMC',
      meta:      'TSMC',
      nvidia:    'TSMC',
      amd:       'TSMC',
      tesla:     'TSMC · !Samsung Foundry',
    },
  },
  {
    group: 'silicon', label: 'Silicon', sub: 'IC substrate',
    cells: {
      amazon:    'Unimicron · SEMCO',
      microsoft: 'Unimicron?',
      google:    'Unimicron · Toppan · NYPCB · ZDT? · EMIB-T (Ibiden, Unimicron, Shinko)',
      meta:      'Unimicron · others?',
      nvidia:    'Ibiden · Unimicron · Kinsus · SEMCO · ZDT?',
      amd:       'AT&S (Mixxx) · Ibiden',
      tesla:     'SEMCO · Kinsus?',
    },
  },
  {
    group: 'silicon', label: 'Silicon', sub: 'Packaging',
    cells: {
      amazon:    'TSMC · ASE (EMIB)',
      microsoft: 'TSMC · Amkor',
      google:    'TSMC · Intel (EMIB-T?)',
      meta:      'TSMC · Intel (EMIB?)',
      nvidia:    'TSMC · UMC (2.5D interposer) · SPIL · Amkor',
      amd:       'TSMC · SPIL',
      tesla:     'TSMC',
    },
  },
  {
    group: 'silicon', label: 'Silicon', sub: 'Testing',
    cells: {
      amazon:    'TeraPower · Amkor · SPIL',
      microsoft: 'KYEC? · ASE?',
      google:    'KYEC · TeraPower · ASE',
      meta:      'KYEC?',
      nvidia:    'KYEC',
      amd:       'SPIL · Tongfu?',
      tesla:     'KYEC',
    },
  },
  {
    group: 'silicon', label: 'Silicon', sub: 'Test interface',
    cells: {
      amazon:    'MPI (probe card) · TPI (probe card)',
      microsoft: 'MPI (probe card)',
      google:    'MPI (probe card) · CHPT+TPI (probe card) · KSMT? (probe card) · WinWay (socket)',
      meta:      'MPI (probe card)',
      nvidia:    'RDA/CHPT (probe card) · WinWay (FT socket) · IDI (SLT socket)',
      amd:       'WinWay (FT/SLT socket) · IDI (FT/SLT socket)',
      tesla:     'CHPT (probe card)',
    },
  },

  // ── PCB / CCL ──────────────────────────────────────────────────────────
  {
    group: 'pcb', label: 'AI GPU OAM', sub: 'CCL',
    cells: {
      amazon: 'Panasonic · EMC',
      nvidia: 'Doosan',
    },
  },
  {
    group: 'pcb', label: 'AI GPU OAM', sub: 'HDI or PCB',
    cells: {
      amazon: 'Shengyi · ZDT · UMTC · others?',
      nvidia: 'Unimicron · VGT',
    },
  },
  {
    group: 'pcb', label: 'AI GPU UBB / switch', sub: 'CCL',
    cells: {
      amazon:    'EMC · TUC',
      microsoft: 'EMC · TUC?',
      google:    'Panasonic · EMC',
      meta:      'EMC',
      nvidia:    'EMC · Shengyi',
      dell:      'EMC · Doosan',
    },
  },
  {
    group: 'pcb', label: 'AI GPU UBB / switch', sub: 'PCB',
    cells: {
      amazon:    'Shengyi · GCE · First Hi-tec · others?',
      microsoft: 'GCE',
      google:    'ISU (major) · WUS · VGT · TTM · GCE · ZDT',
      nvidia:    'WUS · TTM · ISU',
      amd:       'VGT · WUS · TTM',
      tesla:     'SCC',
    },
  },
  {
    group: 'pcb', label: 'General / CPU server', sub: 'CCL',
    segments: [{ span: 9, cell:
      'Purley: ITEQ, TUC · Whitley: ITEQ, EMC, others · Eagle Stream: EMC, ITEQ, others' }],
  },
  {
    group: 'pcb', label: 'General / CPU server', sub: 'PCB',
    segments: [{ span: 9, cell: 'GCE · Tripod · Hannstar · ZDT · others' }],
  },
];
