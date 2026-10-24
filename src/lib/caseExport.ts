/**
 * 成功案例 › 導出（Excel 部分）。PRD：docs/prd/成功案例-PRD.md F-CASE-004。
 *
 * 型別、脫敏與發布邏輯在輕量模組 caseShowcasePublish.ts（客戶專區也引用）；
 * 這裡只加重量級 xlsx 依賴的訂單精選 Excel 生成，供內部導出對話框使用。
 */

import * as XLSX from 'xlsx';
import {
  exportItemPmName,
  safeCaseDate,
  type CaseExportItem,
} from '@/lib/caseShowcasePublish';

export type {
  CaseExportItem,
  CaseExportKind,
  CasePublishBrand,
  CasePublishCase,
  CasePublishPayload,
} from '@/lib/caseShowcasePublish';
export {
  buildExportItem,
  buildPublishPayload,
  fetchPublishedCaseShowcase,
  publishCaseShowcase,
} from '@/lib/caseShowcasePublish';

const ORDER_SHEET_HEADER = [
  '項目',
  '對外說明',
  '產品',
  '產品類型',
  '數量',
  '訂單狀態',
  '預計到場',
  '預計完成安裝',
  '實際完成安裝',
  'PM',
] as const;

/** 訂單數據精選 Excel：一行一訂單項目，只含對外欄位（無工廠／團隊／備註／成本）。 */
export function buildCaseOrdersWorkbook(items: CaseExportItem[]): XLSX.WorkBook {
  const rows: (string | number)[][] = [[...ORDER_SHEET_HEADER]];
  for (const item of items) {
    if (item.kind !== 'order' || !item.orders?.length) continue;
    const pm = exportItemPmName(item);
    for (const o of item.orders) {
      rows.push([
        item.title,
        item.note,
        o.product_name || '',
        o.product_type || '',
        o.quantity ?? '',
        o.status || '',
        safeCaseDate(o.est_delivery_date),
        safeCaseDate(o.est_installation_date),
        safeCaseDate(o.actual_installation_date),
        pm,
      ]);
    }
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '訂單數據精選');
  return book;
}

export function downloadCaseOrdersExcel(items: CaseExportItem[]): void {
  const book = buildCaseOrdersWorkbook(items);
  XLSX.writeFile(book, `訂單數據精選-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
