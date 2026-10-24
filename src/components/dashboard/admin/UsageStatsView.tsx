import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity, AlertCircle, Coins, Cuboid, Gauge, RefreshCw, Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  fetchAiUsageLogs, fetchUsageJobs, startOfMonthISO,
  type AiUsageLogRow, type UsageJobRow,
} from '@/lib/aiUsage';

interface UsageListEntry {
  time: string;
  kind: 'token' | 'tripo';
  item: string;
  model: string;
  prompt: number | null;
  output: number | null;
  amount: number;
}

const SOURCE_LABELS: Record<string, string> = {
  'gemini-proxy': 'Gemini Proxy',
  'gemini-excel-catalog': 'Excel 目錄識別',
  'gemini-pdf-catalog': 'PDF 目錄識別',
  'visual-match-images': '圖片配對',
  'generate-quote-reference-image': '報價參考圖生成',
  'generate-furniture-model': '傢俬模型分析',
  'search-by-image': '圖片搜尋嵌入',
  'embed-products': '產品嵌入索引',
};

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('zh-HK');
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-HK', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function Stat({ label, value, hint, icon }: {
  label: string; value: string; hint: string; icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-bold leading-8 tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  );
}

export function UsageStatsView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AiUsageLogRow[]>([]);
  const [jobs, setJobs] = useState<UsageJobRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageLogs, usageJobs] = await Promise.all([
        fetchAiUsageLogs(),
        fetchUsageJobs(),
      ]);
      setLogs(usageLogs);
      setJobs(usageJobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const entries: UsageListEntry[] = useMemo(() => {
    const fromLogs: UsageListEntry[] = logs.map((l) => ({
      time: l.created_at,
      kind: 'token',
      item: [SOURCE_LABELS[l.source] ?? l.source, l.feature].filter(Boolean).join(' · '),
      model: l.model ?? '—',
      prompt: l.prompt_tokens,
      output: l.output_tokens,
      amount: l.total_tokens,
    }));
    const fromJobs: UsageListEntry[] = jobs.map((j) => {
      const time = j.finished_at ?? j.created_at;
      if (j.job_type === 'generate_tripo') {
        return {
          time,
          kind: 'tripo',
          item: String(j.payload?.product_id ?? j.id).slice(0, 13),
          model: 'Tripo 3D',
          prompt: null,
          output: null,
          amount: Number(j.result?.credits_consumed ?? 0),
        };
      }
      return {
        time,
        kind: 'token',
        item: '文件解析（PDF）',
        model: 'Grok OCR + Gemini',
        prompt: null,
        output: null,
        amount: j.tokens ?? 0,
      };
    });
    return [...fromLogs, ...fromJobs]
      .filter((e) => e.amount > 0 || e.kind === 'token')
      .sort((a, b) => (a.time < b.time ? 1 : -1));
  }, [logs, jobs]);

  const monthStart = useMemo(() => startOfMonthISO(), []);
  const monthJobs = useMemo(
    () => jobs.filter((j) => (j.finished_at ?? j.created_at) >= monthStart),
    [jobs, monthStart],
  );

  const monthTokens = useMemo(
    () => logs.reduce((s, l) => s + (l.total_tokens ?? 0), 0)
      + monthJobs.filter((j) => j.job_type === 'parse_pdf').reduce((s, j) => s + (j.tokens ?? 0), 0),
    [logs, monthJobs],
  );

  const tripoCredits = useMemo(
    () => jobs
      .filter((j) => j.job_type === 'generate_tripo')
      .reduce((s, j) => s + Number(j.result?.credits_consumed ?? 0), 0),
    [jobs],
  );

  const tripoCount = useMemo(
    () => jobs.filter((j) => j.job_type === 'generate_tripo').length,
    [jobs],
  );

  const monthAiCalls = useMemo(
    () => logs.length + monthJobs.filter((j) => j.job_type === 'parse_pdf').length,
    [logs, monthJobs],
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-none flex-col gap-5 fds-page-padding">
        <header className="fds-page-header flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="fds-page-title"><Gauge className="h-5 w-5 text-primary" />AI用量統計</h1>
            <p className="fds-page-description">
              AI token 用量與 Tripo 3D 模型點數消耗。Token 記錄來自 Edge Function 的 AI 呼叫，
              文件解析 token 與 Tripo 點數由 processing_jobs 累計。統計範圍為本月。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load().then(() => toast.success('用量資料已更新'))}
            disabled={loading}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            重新載入
          </Button>
        </header>

        {error ? (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <div>
              <p>無法讀取用量資料：{error}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                用量屬商業資料，只有 admin / uploader 角色可以查看。
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="本月 Token 總量"
                value={loading ? '…' : fmtNum(monthTokens)}
                hint="輸入＋輸出 token 合計"
                icon={<Zap className="h-3.5 w-3.5 text-sky-500" />}
              />
              <Stat
                label="本月 AI 呼叫次數"
                value={loading ? '…' : fmtNum(monthAiCalls)}
                hint="Edge Function 呼叫＋文件解析"
                icon={<Activity className="h-3.5 w-3.5 text-emerald-500" />}
              />
              <Stat
                label="Tripo 點數消耗"
                value={loading ? '…' : fmtNum(tripoCredits)}
                hint="3D 模型生成消耗點數"
                icon={<Coins className="h-3.5 w-3.5 text-amber-500" />}
              />
              <Stat
                label="Tripo 成功次數"
                value={loading ? '…' : fmtNum(tripoCount)}
                hint="狀態為成功的生成任務"
                icon={<Cuboid className="h-3.5 w-3.5 text-violet-500" />}
              />
            </div>

            {/* 用量列表（Token＋Tripo 合併，按時間倒序） */}
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">用量列表（本月 {entries.length} 筆）</h2>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="secondary" className="gap-1"><Zap className="h-3 w-3 text-sky-500" />Token</Badge>
                  <Badge variant="secondary" className="gap-1"><Cuboid className="h-3 w-3 text-violet-500" />Tripo</Badge>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>時間</TableHead>
                      <TableHead>類型</TableHead>
                      <TableHead>功能／產品</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead className="text-right">輸入</TableHead>
                      <TableHead className="text-right">輸出</TableHead>
                      <TableHead className="text-right">消耗</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">正在載入…</TableCell>
                      </TableRow>
                    ) : entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">本月尚無用量記錄</TableCell>
                      </TableRow>
                    ) : entries.map((e, i) => (
                      <TableRow key={`${e.time}-${i}`}>
                        <TableCell className="whitespace-nowrap font-mono-data text-xs">{fmtTime(e.time)}</TableCell>
                        <TableCell>
                          {e.kind === 'tripo' ? (
                            <Badge variant="secondary" className="gap-1"><Cuboid className="h-3 w-3 text-violet-500" />Tripo</Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1"><Zap className="h-3 w-3 text-sky-500" />Token</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{e.item}</TableCell>
                        <TableCell className="font-mono-data text-xs">{e.model}</TableCell>
                        <TableCell className="text-right font-mono-data text-xs">{fmtNum(e.prompt)}</TableCell>
                        <TableCell className="text-right font-mono-data text-xs">{fmtNum(e.output)}</TableCell>
                        <TableCell className="text-right font-mono-data text-xs font-bold">
                          {fmtNum(e.amount)}
                          {e.kind === 'tripo' ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">點</span> : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <p className="text-[11px] text-muted-foreground">
              消耗欄：Token 列顯示 token 數（輸入＋輸出）；Tripo 列顯示消耗點數。
              文件解析的 token 由 processing_jobs 累計，Tripo 點數在模型生成成功時記錄。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
