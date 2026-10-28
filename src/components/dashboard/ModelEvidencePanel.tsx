import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  SOURCE_LABEL,
  STATUS_LABEL,
  acceptEstimate,
  acceptRemainingEstimates,
  clearSelection,
  conflictOf,
  confirmAgreed,
  enterManual,
  isEstimate,
  isMeasured,
  modelingState,
  selectCandidate,
  usableCandidates,
  valueOf,
  type DimensionCandidate,
  type DimensionRecord,
  type EvidenceStatus,
  type ModelEvidence,
} from '@/lib/modelEvidence';

const STATUS_TONE: Record<EvidenceStatus, string> = {
  confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pending: 'bg-sky-50 text-sky-700 ring-sky-200',
  estimated: 'bg-amber-50 text-amber-800 ring-amber-200',
  missing: 'bg-red-50 text-red-700 ring-red-200',
  conflict: 'bg-red-50 text-red-700 ring-red-200',
};

const STATE_TONE = { 待補資料: 'text-red-700', 待確認: 'text-sky-700', 可建模: 'text-emerald-700' } as const;

function candidateText(c: DimensionCandidate): string {
  const where = [c.image_index ? `圖 ${c.image_index}` : '', c.location ?? ''].filter(Boolean).join(' · ');
  return [
    `${SOURCE_LABEL[c.source]} ${Math.round(c.value_mm * 10) / 10} mm`,
    c.raw_text ? `「${c.raw_text}」` : '',
    where ? `（${where}）` : '',
  ].join('');
}

function Row({ record, evidence, by, onChange }: {
  record: DimensionRecord;
  evidence: ModelEvidence;
  by: string;
  onChange: (next: ModelEvidence, key: string) => void;
}) {
  const scope = evidence.product_scope;
  const usable = usableCandidates(record, scope);
  const excluded = record.candidates.filter((c) => !usable.includes(c));
  const conflict = conflictOf(record, scope);
  const [choice, setChoice] = useState(record.selected_id ?? usable[0]?.id ?? '');
  const [reason, setReason] = useState(record.reason ?? '');
  const [manual, setManual] = useState<string | null>(null);
  const value = valueOf(record, scope);
  const measured = usable.find(isMeasured);
  const estimate = usable.find(isEstimate);
  const commitManual = () => {
    const n = Number(manual);
    if (!(n > 0 && n <= 10000)) return;
    onChange(enterManual(evidence, record.key, n, by, reason), record.key);
    setManual(null);
  };

  return (
    <li className="rounded-lg bg-white px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-28 shrink-0 text-[13px] font-medium text-slate-800">{record.label}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', STATUS_TONE[record.status])}>{STATUS_LABEL[record.status]}</span>
        <span className="text-[13px] tabular-nums text-slate-700">{value != null ? `${Math.round(value * 10) / 10} mm` : '—'}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {record.status === 'pending' && measured && (
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-md px-2 text-xs" onClick={() => onChange(selectCandidate(evidence, record.key, measured.id, by), record.key)}>確認</Button>
          )}
          {record.status === 'missing' && estimate && (
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-md px-2 text-xs" onClick={() => onChange(acceptEstimate(evidence, record.key, by), record.key)}>接受估算</Button>
          )}
          {(record.status === 'confirmed' || record.status === 'estimated') && (
            <Button type="button" size="sm" variant="ghost" className="h-7 rounded-md px-2 text-xs text-slate-500" onClick={() => onChange(clearSelection(evidence, record.key), record.key)}>重設</Button>
          )}
          {manual == null && (
            <Button type="button" size="sm" variant="ghost" className="h-7 rounded-md px-2 text-xs text-slate-500" onClick={() => setManual(value != null ? String(Math.round(value)) : '')}>輸入</Button>
          )}
        </span>
      </div>
      {usable.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-0.5 text-xs leading-5 text-slate-500">
          {usable.map((c) => (
            <li key={c.id} className={cn(c.id === record.selected_id && 'font-medium text-slate-800')}>
              {c.id === record.selected_id ? '✓ ' : '・'}{candidateText(c)}
            </li>
          ))}
        </ul>
      )}
      {excluded.length > 0 && (
        <p className="mt-0.5 text-xs leading-5 text-slate-400">
          {excluded.map(candidateText).join('；')}：{scope === 'single' ? '整組尺寸，不用於單件' : '單件尺寸，不用於整組'}
        </p>
      )}
      {conflict && record.status === 'conflict' && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="h-7 w-52 rounded-md text-xs" aria-label={`${record.label}採用值`}>
              <SelectValue placeholder="選擇採用值" />
            </SelectTrigger>
            <SelectContent>
              {usable.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{`${SOURCE_LABEL[c.source]} ${Math.round(c.value_mm * 10) / 10} mm`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={reason} placeholder="採用理由（必填）" aria-label={`${record.label}採用理由`} className="h-7 w-44 rounded-md px-2 text-xs" onChange={(event) => setReason(event.target.value)} />
          <Button
            type="button"
            size="sm"
            className="h-7 rounded-md bg-[#5b4dff] px-2.5 text-xs text-white hover:bg-[#4a3cf0]"
            disabled={!choice || !reason.trim()}
            onClick={() => onChange(selectCandidate(evidence, record.key, choice, by, reason), record.key)}
          >
            採用
          </Button>
        </div>
      )}
      {manual != null && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Input autoFocus value={manual} inputMode="decimal" aria-label={`${record.label}人工輸入`} className="h-7 w-20 rounded-md px-2 text-center text-xs tabular-nums" onChange={(event) => setManual(event.target.value.replace(/[^\d.]/g, ''))} onKeyDown={(event) => { if (event.key === 'Enter') commitManual(); }} />
          <span className="text-xs text-slate-500">mm</span>
          {measured && <Input value={reason} placeholder="與資料不同時寫理由" aria-label={`${record.label}輸入理由`} className="h-7 w-40 rounded-md px-2 text-xs" onChange={(event) => setReason(event.target.value)} />}
          <Button type="button" size="sm" variant="outline" className="h-7 rounded-md px-2 text-xs" onClick={commitManual}>儲存</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 rounded-md px-2 text-xs text-slate-500" onClick={() => setManual(null)}>取消</Button>
        </div>
      )}
      {record.confirmed_by && (record.status === 'confirmed' || record.status === 'estimated') && (
        <p className="mt-0.5 text-[11px] text-slate-400">
          {record.status === 'estimated' ? '接受估算' : '確認'}：{record.confirmed_by}
          {record.reason ? ` · 理由：${record.reason}` : ''}
        </p>
      )}
    </li>
  );
}

/** FR-03：每個關鍵尺寸的來源、狀態與確認；AI 估算只能被「接受」，不會變成已量測。 */
export function ModelEvidencePanel({ evidence, by, onChange }: {
  evidence: ModelEvidence;
  by: string;
  onChange: (next: ModelEvidence, key?: string) => void;
}) {
  const state = modelingState(evidence);
  const hasPending = evidence.dimensions.some((d) => d.status === 'pending');
  const hasMissingEstimate = evidence.dimensions.some((d) => d.status === 'missing' && usableCandidates(d, evidence.product_scope).some(isEstimate));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs leading-5 text-slate-500">
          建模資料：<span className={cn('font-semibold', STATE_TONE[state])}>{state}</span>
          {evidence.product_scope === 'arrangement' ? ' · 建整組模型' : ' · 建單件模型'}
        </p>
        <span className="ml-auto flex gap-1.5">
          {hasPending && (
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-md px-2 text-xs" onClick={() => onChange(confirmAgreed(evidence, by))}>確認全部一致資料</Button>
          )}
          {hasMissingEstimate && (
            <Button type="button" size="sm" variant="outline" className="h-7 rounded-md px-2 text-xs" onClick={() => onChange(acceptRemainingEstimates(evidence, by))}>其餘接受估算</Button>
          )}
        </span>
      </div>
      <ul className="space-y-1">
        {evidence.dimensions.map((record) => (
          <Row key={`${record.key}:${record.selected_id ?? ''}:${record.candidates.length}`} record={record} evidence={evidence} by={by} onChange={onChange} />
        ))}
      </ul>
      <p className="text-[11px] leading-5 text-slate-400">接受估算只能生成「估算草稿」，不能通過正式驗收；有衝突時要選定採用值並寫理由。</p>
    </div>
  );
}
