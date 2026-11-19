import assert from 'node:assert/strict';
import test from 'node:test';
import {
  industryKey,
  matchQuoteReferences,
  valueInBand,
  QUOTE_AMOUNT_BANDS,
  type QuoteReferenceCandidate,
  type QuoteReferenceQuery,
} from './quoteReferenceMatch.ts';

function candidate(patch: Partial<QuoteReferenceCandidate> = {}): QuoteReferenceCandidate {
  return {
    id: 'q1',
    quoteId: 'BWF-1',
    version: 'v1',
    totalAmount: 30_000,
    createdAt: '2026-01-01T00:00:00.000Z',
    pitchingId: 'p1',
    industries: ['金融服務業 - Financial Services'],
    scopes: ['辦公枱', '儲物櫃'],
    grades: ['基本傢俬'],
    workPeriod: '7-14天內',
    itemCount: 4,
    sizedItemCount: 4,
    sizeLt1200: 0,
    size1200: 4,
    size1600: 0,
    sizeGe2000: 0,
    customerType: '企業客戶',
    ...patch,
  };
}

function query(patch: Partial<QuoteReferenceQuery> = {}): QuoteReferenceQuery {
  return {
    furnitureGroups: [furnitureGroup('辦公枱')],
    amountBandId: '20to50',
    sizeBandId: '1200',
    industries: ['金融服務業 - Financial Services'],
    industryHard: false,
    customerType: '企業客戶',
    grade: '基本傢俬',
    workPeriod: '7-14天內',
    ...patch,
  };
}

function furnitureGroup(scope: string, classification = '', colors: string[] = [], materials: string[] = []) {
  return { scope, classification, colors, materials };
}

test('amount bands are min-inclusive and max-exclusive', () => {
  const low = QUOTE_AMOUNT_BANDS[0];
  const mid = QUOTE_AMOUNT_BANDS[1];
  assert.equal(valueInBand(19_999, low), true);
  assert.equal(valueInBand(20_000, low), false);
  assert.equal(valueInBand(20_000, mid), true);
  assert.equal(valueInBand(49_999, mid), true);
  assert.equal(valueInBand(50_000, mid), false);
  assert.equal(valueInBand(null, mid), false);
});

test('industry key drops the English suffix after a spaced hyphen', () => {
  assert.equal(industryKey('金融服務業 - Financial Services'), '金融服務業');
  assert.equal(industryKey('  辦公  '), '辦公');
});

test('hard gates drop a different category, an amount outside the band, and the quote being edited', () => {
  const rows = [
    candidate(),
    candidate({ id: 'other-category', scopes: ['學校家具'] }),
    candidate({ id: 'too-small', totalAmount: 8_000 }),
    candidate({ id: 'editing' }),
  ];
  const matches = matchQuoteReferences(rows, query({ excludeQuoteId: 'editing' }));
  assert.deepEqual(matches.map((row) => row.candidate.id), ['q1']);
});

test('an empty amount band keeps quotes of every total', () => {
  const rows = [
    candidate({ id: 'small', totalAmount: 8_000 }),
    candidate({ id: 'mid', totalAmount: 30_000 }),
  ];
  const matches = matchQuoteReferences(rows, query({ amountBandId: '' }));
  assert.deepEqual(matches.map((row) => row.candidate.id).sort(), ['mid', 'small']);
  assert.equal(matches.every((row) => row.tags.some((item) => item.key === 'amount')), false);
});

test('a selected size earns no points when missing or unmatched', () => {
  const recordedMiss = candidate({
    id: 'miss',
    size1200: 0,
    sizeLt1200: 4,
    industries: [],
    grades: [],
    workPeriod: null,
    customerType: null,
  });
  const unknownSize = candidate({
    id: 'unknown',
    createdAt: '2026-01-01T00:00:00.000Z',
    sizedItemCount: 0,
    size1200: 0,
    industries: [],
    grades: [],
    workPeriod: null,
    customerType: null,
  });
  const matches = matchQuoteReferences(
    [recordedMiss, unknownSize],
    query({
      sizeBandId: '1200',
      industries: [],
      customerType: null,
      grade: null,
      workPeriod: null,
    }),
  );
  const miss = matches.find((row) => row.candidate.id === 'miss');
  const unknown = matches.find((row) => row.candidate.id === 'unknown');
  assert.ok(miss && unknown);
  assert.equal(miss.score, 80);
  assert.equal(unknown.score, 80);
  assert.equal(unknown.tags.find((item) => item.key === 'size')?.label, '尺寸 未記錄');
});

test('same industry can be required, and a blank industry is not treated as a match', () => {
  const rows = [
    candidate({ id: 'same', industries: ['金融服務業 - Financial Services'] }),
    candidate({ id: 'other', industries: ['批發及零售業 - Retail'] }),
    candidate({ id: 'blank', industries: [] }),
  ];
  const hard = matchQuoteReferences(rows, query({ industryHard: true }));
  assert.deepEqual(hard.map((row) => row.candidate.id), ['same']);

  const [filtered] = matchQuoteReferences(rows, query({
    industryHard: true,
    industries: ['金融服務業', '教育'],
  }));
  assert.equal(filtered.score, 100);

  const soft = matchQuoteReferences(rows, query({ industryHard: false, customerType: null, grade: null, workPeriod: null, sizeBandId: null }));
  const other = soft.find((row) => row.candidate.id === 'other');
  const blank = soft.find((row) => row.candidate.id === 'blank');
  assert.ok(other && blank);
  assert.equal(other.tags.find((item) => item.key === 'industry')?.label, '產業 不符');
  assert.equal(blank.tags.find((item) => item.key === 'industry')?.label, '產業 未記錄');
  assert.equal(blank.score, other.score);
});

test('selected grade and lead time earn no points when missing or unmatched', () => {
  const mismatch = candidate({ id: 'mismatch', grades: ['傢俬採購'], workPeriod: '1-3個月內' });
  const blank = candidate({ id: 'blank', grades: [], workPeriod: null, createdAt: '2025-01-01T00:00:00.000Z' });
  const matches = matchQuoteReferences(
    [mismatch, blank],
    query({ industries: [], customerType: null, sizeBandId: null, grade: '基本傢俬', workPeriod: '7-14天內' }),
  );
  const missed = matches.find((row) => row.candidate.id === 'mismatch');
  const open = matches.find((row) => row.candidate.id === 'blank');
  assert.ok(missed && open);
  assert.equal(missed.tags.find((item) => item.key === 'grade')?.label, '級別 不符');
  assert.equal(open.tags.find((item) => item.key === 'grade')?.label, '級別 未記錄');
  assert.equal(open.tags.find((item) => item.key === 'leadTime')?.label, '工期 未記錄');
  assert.equal(open.score, missed.score);
});

test('category coverage is partial when only some selected categories appear', () => {
  const [row] = matchQuoteReferences(
    [candidate({ scopes: ['辦公枱'] })],
    query({
      furnitureGroups: [furnitureGroup('辦公枱'), furnitureGroup('辦公椅')],
      industries: [],
      customerType: null,
      grade: null,
      workPeriod: null,
      sizeBandId: null,
    }),
  );
  assert.deepEqual(row.tags.map(({ label }) => label), ['辦公枱 相符', '辦公椅 不符', '金額 相符']);
  assert.equal(row.score, 50);
  assert.equal(row.completeGroups, 1);
  assert.equal(row.totalGroups, 2);
});

test('only color on the same item contributes to a classification match', () => {
  const rows = [
    candidate({
      id: 'white-desk',
      itemTraits: [{ category: '會議枱', colors: ['白'], materials: ['木皮'] }],
    }),
    candidate({
      id: 'mixed',
      itemTraits: [
        { category: '會議枱', colors: ['黑'], materials: ['木皮'] },
        { category: '辦公椅', colors: ['白'], materials: ['布藝'] },
      ],
    }),
  ];
  const matches = matchQuoteReferences(rows, query({
    sizeBandId: null,
    furnitureGroups: [furnitureGroup('辦公枱', '會議枱', ['白'])],
  }));
  assert.deepEqual(matches.map(({ candidate: row, score, completeGroups }) => [row.id, score, completeGroups]), [
    ['white-desk', 100, 1],
    ['mixed', 82, 0],
  ]);
});

test('a quote missing the executive desk only earns credit for the workstation group', () => {
  const workstation = { category: '工作枱', colors: ['灰'], materials: ['玻璃'] };
  const desk = { category: '老闆枱', colors: ['灰'], materials: ['MFC'] };
  const filters = query({
    amountBandId: '',
    sizeBandId: null,
    industries: [],
    customerType: null,
    grade: null,
    workPeriod: null,
    furnitureGroups: [
      furnitureGroup('辦公枱', '工作枱'),
      furnitureGroup('辦公枱', '老闆枱', ['灰'], ['MFC']),
    ],
  });
  const matches = matchQuoteReferences([
    candidate({ id: 'workstation-only', itemTraits: [workstation, workstation] }),
    candidate({ id: 'both', itemTraits: [workstation, desk] }),
    candidate({
      id: 'wrong-material',
      itemTraits: [{ ...workstation, materials: ['MFC'] }, { ...desk, materials: ['玻璃'] }],
    }),
    candidate({
      id: 'missing-color',
      itemTraits: [workstation, { ...desk, colors: [] }],
    }),
    candidate({ id: 'neither', itemTraits: [] }),
  ], filters);

  assert.deepEqual(matches.map(({ candidate: row, score, completeGroups }) => [row.id, score, completeGroups]), [
    ['both', 100, 2],
    ['missing-color', 93, 1],
    ['wrong-material', 93, 1],
    ['workstation-only', 50, 1],
  ]);
  assert.ok(matches[1].tags.some(({ label }) => label === '老闆枱 相符 · 顏色 未記錄 · 材質 相符'));
  assert.ok(matches[2].tags.some(({ label }) => label === '老闆枱 相符 · 顏色 相符 · 材質 不符'));
  assert.ok(matches[3].tags.some(({ label }) => label === '老闆枱 不符'));

  const withCustomerFilter = matchQuoteReferences([
    candidate({ id: 'BWF-NGO26-098', customerType: null, itemTraits: [workstation, workstation] }),
    candidate({ id: 'workstation-ngo', customerType: 'NGO', itemTraits: [workstation] }),
    candidate({ id: 'both-customer-unknown', customerType: null, itemTraits: [workstation, desk] }),
    candidate({ id: 'all-confirmed', customerType: 'NGO', itemTraits: [workstation, desk] }),
  ], { ...filters, customerType: 'NGO' });
  assert.deepEqual(withCustomerFilter.map(({ candidate: row, score }) => [row.id, score]), [
    ['all-confirmed', 100],
    ['both-customer-unknown', 80],
    ['workstation-ngo', 50],
    ['BWF-NGO26-098', 40],
  ]);
  assert.ok(withCustomerFilter[3].tags.some(({ label }) => label === '客戶類型 未記錄'));
});

test('color and material cannot combine across items of the same classification', () => {
  const [row] = matchQuoteReferences([
    candidate({
      itemTraits: [
        { category: '老闆枱', colors: ['灰'], materials: ['玻璃'] },
        { category: '老闆枱', colors: ['黑'], materials: ['MFC'] },
      ],
    }),
  ], query({ furnitureGroups: [furnitureGroup('辦公枱', '老闆枱', ['灰'], ['MFC'])] }));
  assert.equal(row.score, 85);
  assert.equal(row.completeGroups, 0);
});
