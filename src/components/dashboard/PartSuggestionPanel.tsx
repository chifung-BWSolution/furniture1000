import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { PartChange } from '@/lib/partSuggestions';

/** AC-06：AI 重新辨認只提出差異，逐項採用；不採用的保持現有（人工確認的）部件。 */
export function PartSuggestionPanel({ changes, onApply, onDismiss }: {
  changes: PartChange[];
  onApply: (adopted: Set<string>, all: boolean) => void;
  onDismiss: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  if (changes.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        AI 重新辨認的部件與目前一致，沒有需要採用的差異。
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={onDismiss}>關閉</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-[#5b4dff]/30 bg-[#f4f2ff] px-3 py-2.5">
      <p className="text-xs font-medium text-slate-800">AI 重新辨認提出 {changes.length} 項差異；未採用的保持目前設定。</p>
      <ul className="space-y-1">
        {changes.map((change) => (
          <li key={change.id}>
            <label className="flex items-start gap-2 text-xs leading-5 text-slate-700">
              <Checkbox
                checked={picked.has(change.id)}
                className="mt-0.5 h-3.5 w-3.5 border-slate-300 bg-white shadow-none data-[state=checked]:border-[#5b4dff] data-[state=checked]:bg-[#5b4dff]"
                onCheckedChange={(value) => setPicked((current) => {
                  const next = new Set(current);
                  if (value === true) next.add(change.id);
                  else next.delete(change.id);
                  return next;
                })}
              />
              {change.summary}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" className="h-7 rounded-md bg-[#5b4dff] px-2.5 text-xs text-white hover:bg-[#4a3cf0]" disabled={picked.size === 0} onClick={() => onApply(picked, picked.size === changes.length)}>
          採用所選（{picked.size}）
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 rounded-md bg-white px-2.5 text-xs" onClick={() => onApply(new Set(changes.map((c) => c.id)), true)}>全部採用</Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 rounded-md px-2.5 text-xs text-slate-500" onClick={onDismiss}>全部不採用</Button>
      </div>
    </div>
  );
}
