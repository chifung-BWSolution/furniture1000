import { useSearchParams } from 'react-router-dom';
import { PackagePricingEditor } from './PackagePricingEditor';
import { PackagePricingListView } from './PackagePricingListView';

/**
 * 套餐參考報價（側欄「PM報價 > 快速報價」）：
 * - 預設、?mode=reference：參考報價一覽（列表）。
 * - ?mode=new：新增參考報價，進入編輯頁。
 * - ?quote=<id>：開啟已儲存的參考報價。
 * 舊連結（?mode=reference／?quote=）仍然可用。
 */
export function PackagePricingView() {
  const [params] = useSearchParams();
  const quoteId = (params.get('quote') || '').trim();
  const creating = params.get('mode') === 'new';

  return quoteId || creating ? <PackagePricingEditor /> : <PackagePricingListView />;
}
