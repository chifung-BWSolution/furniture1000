import assert from 'node:assert/strict';
import {
  aggregateDocumentParseDigest,
  buildDocumentParseDigestEmail,
  getDailyParseDigestRangeHk,
} from '../supabase/functions/_shared/documentParseDigestEmail.ts';

// 1. Range calculation (HKT 09:00 -> next day 09:00)
const explicitRange = getDailyParseDigestRangeHk({ reportDate: '2026-11-24' });
assert.equal(explicitRange.reportDate, '2026-11-24');
assert.equal(explicitRange.windowStartLabel, '2026-11-23 09:00');
assert.equal(explicitRange.windowEndLabel, '2026-11-24 09:00');
assert.equal(explicitRange.rangeStartIso, '2026-11-23T01:00:00.000Z');
assert.equal(explicitRange.rangeEndIso, '2026-11-24T01:00:00.000Z');

// Default reportDate resolves in Asia/Shanghai (+08:00)
const earlyMorningHk = getDailyParseDigestRangeHk({ now: new Date('2026-11-24T01:15:00Z') }); // 09:15 HKT
assert.equal(earlyMorningHk.reportDate, '2026-11-24');

// 2. Empty activity check
const emptySummary = aggregateDocumentParseDigest([], [], explicitRange);
assert.equal(emptySummary.hasActivity, false);
assert.equal(emptySummary.totalDocs, 0);

// 3. Mixed documents & Asana rows
const summary = aggregateDocumentParseDigest(
  [
    {
      id: 'd1',
      factory_name: '舒樂活 shulehou',
      doc_type: 'catalog',
      title: '舒乐活目录0609',
      source: 'asana',
      status: 'review',
      file_size: 73981846,
      page_count: 22,
      error_message: null,
      created_at: '2026-11-23T09:10:59Z',
      modified_date: '2026-11-23T16:14:12Z',
      itemCount: 43,
    },
    {
      id: 'd2',
      factory_name: '國鍵鋼具',
      doc_type: 'catalog',
      title: '国键博物馆介绍 <script>2021</script>',
      source: 'upload',
      status: 'failed',
      file_size: 11973032,
      page_count: 41,
      error_message: 'worker_timeout',
      created_at: '2026-11-23T09:11:49Z',
      modified_date: '2026-11-23T16:18:01Z',
      itemCount: 0,
    },
    {
      id: 'd3',
      factory_name: '舊廠家',
      doc_type: 'quote',
      title: '舊的已完成報價',
      source: 'upload',
      status: 'ready',
      file_size: 100000,
      page_count: 2,
      error_message: null,
      created_at: '2026-11-20T09:00:00Z',
      modified_date: '2026-11-20T17:00:00Z',
      itemCount: 5,
    },
  ],
  [
    { status: 'synced', skip_reason: null, doc_type: 'catalog', file_name: 'a.pdf', error_message: null },
    { status: 'skipped', skip_reason: 'superseded_by_newer_version', doc_type: 'quote', file_name: 'b.pdf', error_message: null },
  ],
  explicitRange,
);

assert.equal(summary.hasActivity, true);
assert.equal(summary.totalDocs, 2); // d3 excluded because completed & out of window
assert.equal(summary.completedCount, 1);
assert.equal(summary.failedCount, 1);
assert.equal(summary.catalogCount, 2);
assert.equal(summary.totalExtractedItems, 43);
assert.equal(summary.asanaSynced, 1);
assert.equal(summary.asanaSkipped, 1);
assert.equal(summary.documents[0].id, 'd2'); // failed sorted first

const email = buildDocumentParseDigestEmail(summary);
assert.equal(
  email.subject,
  '【FDS｜圖冊解析】圖冊／報價單夜間解析進度報告（2026-11-24）｜完成 1 · 失敗 1',
);
assert.ok(!email.html.includes('<script>2021</script>'), 'must escape HTML in titles');
assert.ok(email.html.includes('&lt;script&gt;2021&lt;/script&gt;'));
assert.ok(email.text.includes('worker_timeout'));
assert.ok(email.text.includes('舒乐活目录0609'));

console.log('OK: all document parse digest unit tests passed.');
