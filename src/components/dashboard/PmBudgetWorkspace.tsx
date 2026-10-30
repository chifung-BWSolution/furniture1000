import { useSearchParams } from 'react-router-dom';
import { PmBudgetView } from './PmBudgetView';
import { PackagePricingView } from './PackagePricingView';

/**
 * PM 報價兩個頁面共用這個外殼，但各自只有一種內容，不再顯示「快速報價試算／參考報價」切換 tab：
 * - /fds/pm/package（側欄「快速報價」）＝套餐參考報價。
 * - /fds/pm/budget（側欄「報價預算」）＝PM 快速報價單的預算試算。
 * ?mode=reference／?quote= 仍直接開參考報價，舊連結與 PMS deep link 不會斷。
 */
export function PmBudgetWorkspace({ legacyPackage = false }: { legacyPackage?: boolean }) {
  const [params] = useSearchParams();
  const showReference = legacyPackage || params.get('mode') === 'reference' || params.has('quote');

  return showReference ? <PackagePricingView /> : <PmBudgetView />;
}
