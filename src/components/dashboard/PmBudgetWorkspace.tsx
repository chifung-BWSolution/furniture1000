import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PmBudgetView } from './PmBudgetView';
import { PackagePricingView } from './PackagePricingView';

export function PmBudgetWorkspace({ legacyPackage = false }: { legacyPackage?: boolean }) {
  const [params, setParams] = useSearchParams();
  const mode = legacyPackage || params.get('mode') === 'reference' || params.has('quote') ? 'reference' : 'quick';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={mode} onValueChange={(value) => {
        const next = new URLSearchParams(params);
        if (value === 'reference') next.set('mode', 'reference');
        else { next.delete('mode'); next.delete('quote'); }
        if (legacyPackage) {
          window.location.assign(`/fds/pm/budget${next.size ? `?${next}` : ''}`);
        } else setParams(next);
      }} className="px-4 pt-4 sm:px-6">
        <TabsList>
          <TabsTrigger value="quick">快速報價試算</TabsTrigger>
          <TabsTrigger value="reference">參考報價</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1">
        {mode === 'reference' ? <PackagePricingView /> : <PmBudgetView />}
      </div>
    </div>
  );
}
