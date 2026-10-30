import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Monitor, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { confirm } from '@/components/ui/confirm-dialog';
import { usePlatformRole } from '@/hooks/use-platform-role';
import { canManageSkpWorkers } from './navConfig';
import {
  CURRENT_SKP_WORKER_VERSION,
  decideSkpPairing,
  listSkpDevices,
  lookupSkpPairing,
  reapproveSkpDevice,
  revokeSkpDevice,
  skpDeviceError,
  skpEnvironmentLabel,
  type SkpDeviceRow,
  type SkpPairing,
} from '@/lib/skpDevices';

function when(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-HK');
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending': return '等待批准';
    case 'approved': return '已批准，等待安裝程式領取';
    case 'claimed': return '已完成配對';
    case 'rejected': return '已拒絕';
    case 'expired': return '已過期';
    case 'cancelled': return '已取消';
    case 'active': return '已授權';
    case 'suspended': return '已暫停';
    case 'revoked': return '已撤銷';
    default: return '狀態待確認';
  }
}

export function SkpWorkersView() {
  const [params] = useSearchParams();
  const code = params.get('code')?.trim() ?? '';
  const { profileRole, loading: roleLoading } = usePlatformRole();
  const canAuthorize = canManageSkpWorkers(profileRole);
  const [pairing, setPairing] = useState<SkpPairing | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [devices, setDevices] = useState<SkpDeviceRow[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const loadPairing = useCallback(async () => {
    if (!code) {
      setPairing(null);
      setPairingError(null);
      return;
    }
    setPairingLoading(true);
    try {
      setPairing(await lookupSkpPairing(code));
      setPairingError(null);
    } catch (err) {
      setPairing(null);
      setPairingError(skpDeviceError(err instanceof Error ? err.message : 'lookup_failed'));
    } finally {
      setPairingLoading(false);
    }
  }, [code]);

  const loadDevices = useCallback(async () => {
    if (!canAuthorize) return;
    setDevicesLoading(true);
    try {
      setDevices(await listSkpDevices());
      setDevicesError(null);
    } catch (err) {
      setDevicesError(skpDeviceError(err instanceof Error ? err.message : 'list_failed'));
    } finally {
      setDevicesLoading(false);
    }
  }, [canAuthorize]);

  useEffect(() => { void loadPairing(); }, [loadPairing]);
  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const decide = async (approve: boolean) => {
    setDeciding(true);
    try {
      await decideSkpPairing(code, approve);
      toast.success(approve ? '已授權這台電腦' : '已拒絕這次配對');
      await loadPairing();
      await loadDevices();
    } catch (err) {
      toast.error(skpDeviceError(err instanceof Error ? err.message : 'decide_failed'));
    } finally {
      setDeciding(false);
    }
  };

  const revoke = async (row: SkpDeviceRow) => {
    const ok = await confirm({
      title: `撤銷 ${row.computerName}？`,
      description: '這台電腦將無法繼續處理模型生成任務。再次使用前需要重新授權。',
      confirmLabel: '撤銷',
      destructive: true,
    });
    if (!ok) return;
    try {
      await revokeSkpDevice(row.id);
      toast.success('已撤銷');
      await loadDevices();
    } catch (err) {
      toast.error(skpDeviceError(err instanceof Error ? err.message : 'revoke_failed'));
    }
  };

  const reapprove = async (row: SkpDeviceRow) => {
    try {
      await reapproveSkpDevice(row.id);
      toast.success('已由你重新批准');
      await loadDevices();
    } catch (err) {
      toast.error(skpDeviceError(err instanceof Error ? err.message : 'reapprove_failed'));
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <h1 className="fds-page-title">
            <Monitor className="h-5 w-5 text-primary" />
            SKP Worker
          </h1>
          <p className="fds-page-description">
            管理協助生成 SKP 模型的電腦。請先核對電腦名稱及配對碼，再授權你信任的公司電腦存取相關產品資料及模型。
          </p>
        </section>

        {code && (
          <section className="space-y-4 rounded-xl border border-slate-200/70 bg-slate-50/80 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              授權這台電腦
            </div>
            {pairingLoading ? (
              <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />正在讀取配對請求…</p>
            ) : pairingError ? (
              <p className="text-sm text-destructive">{pairingError}</p>
            ) : pairing && (
              <>
                <p className="text-sm">
                  請核對安裝程式畫面上的配對碼。環境：<strong>{skpEnvironmentLabel(pairing.environment)}</strong>
                </p>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">配對碼</dt><dd className="font-mono text-lg font-semibold">{pairing.code}</dd></div>
                  <div><dt className="text-muted-foreground">電腦名稱</dt><dd>{pairing.computerName}</dd></div>
                  <div><dt className="text-muted-foreground">申請時間</dt><dd>{when(pairing.createdAt)}</dd></div>
                  <div><dt className="text-muted-foreground">有效期至</dt><dd>{when(pairing.expiresAt)}</dd></div>
                  <div><dt className="text-muted-foreground">狀態</dt><dd>{statusLabel(pairing.status)}</dd></div>
                  <div><dt className="text-muted-foreground">可執行任務</dt><dd>生成 SKP、SKP 預覽</dd></div>
                </dl>
                {roleLoading ? (
                  <p className="text-sm text-muted-foreground">正在確認權限…</p>
                ) : !canAuthorize || !pairing.canAuthorize ? (
                  <p className="text-sm font-medium">請由管理員、PM 或設計師授權</p>
                ) : pairing.status === 'pending' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={deciding} onClick={() => void decide(true)}>授權這台電腦</Button>
                    <Button variant="outline" disabled={deciding} onClick={() => void decide(false)}>拒絕</Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{statusLabel(pairing.status)}。若安裝程式仍在等待，請在安裝程式重新開始配對。</p>
                )}
              </>
            )}
          </section>
        )}

        {canAuthorize && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">已加入的電腦</h2>
              <Button variant="outline" size="sm" disabled={devicesLoading} onClick={() => void loadDevices()}>重新整理</Button>
            </div>
            {devicesLoading && devices.length === 0 ? (
              <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />正在讀取…</p>
            ) : devicesError ? (
              <p className="text-sm text-destructive">{devicesError}</p>
            ) : devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚未有授權的 SKP Worker。</p>
            ) : (
              <div className="space-y-3">
                {devices.map((row) => (
                  <article key={row.id} className="space-y-3 rounded-xl border border-slate-200/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{row.computerName}</h3>

                      </div>
                      <div className="flex flex-wrap gap-2">
                        {row.status === 'suspended' && (
                          <Button size="sm" variant="outline" onClick={() => void reapprove(row)}>重新批准</Button>
                        )}
                        {row.status !== 'revoked' && (
                          <Button size="sm" variant="outline" onClick={() => void revoke(row)}>撤銷</Button>
                        )}
                      </div>
                    </div>
                    <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      <div><dt className="text-muted-foreground">環境</dt><dd>{skpEnvironmentLabel(row.environment)}</dd></div>
                      <div><dt className="text-muted-foreground">狀態</dt><dd>{statusLabel(row.status)}</dd></div>
                      <div><dt className="text-muted-foreground">版本</dt><dd>{row.workerVersion || '—'}{row.workerVersion && row.workerVersion !== CURRENT_SKP_WORKER_VERSION && <span className="ml-1.5 text-amber-600">需更新（重新執行最新安裝程式）</span>}</dd></div>
                      <div><dt className="text-muted-foreground">授權者</dt><dd>{row.approverEmail || '—'}</dd></div>
                      <div><dt className="text-muted-foreground">批准時間</dt><dd>{when(row.approvedAt)}</dd></div>
                      <div><dt className="text-muted-foreground">授權有效期至</dt><dd>{when(row.expiresAt)}</dd></div>
                      <div><dt className="text-muted-foreground">最後連線時間</dt><dd>{when(row.lastHeartbeatAt)}</dd></div>
                      <div><dt className="text-muted-foreground">模型生成</dt><dd>{row.ready ? '就緒' : '未就緒或離線'}</dd></div>
                      <div><dt className="text-muted-foreground">目前任務</dt><dd>{row.currentJobType === 'generate_skp' ? '生成模型' : row.currentJobType === 'preview_skp' ? '製作預覽' : row.currentJobType ? '處理中' : '暫無任務'}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {!code && !canAuthorize && !roleLoading && (
          <p className="text-sm font-medium">請由管理員、PM 或設計師授權</p>
        )}
      </div>
    </div>
  );
}
