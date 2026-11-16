import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Info,
  Link2,
  LogIn,
  Mail,
  Power,
  Send,
  UserCog,
  UserRoundPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirm } from '@/components/ui/confirm-dialog';
import { CompactEmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  inviteSupplier,
  loadDirectoryFactories,
  loadSupplierLogins,
  setSupplierLoginActive,
  type DirectoryFactory,
  type SupplierLogin,
} from '@/lib/supplierLogins';

type LoginLinkDialog = {
  email: string;
  factoryName: string;
  link: string;
  /** invite = newly created / re-issued; existing = generated for an account row. */
  kind: 'invite' | 'existing';
};

async function copyLoginLink(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    toast.success('已複製登入連結');
  } catch {
    toast.error('未能自動複製，請在彈出的視窗手動複製。');
  }
}

export function FactoryLoginView() {
  const [logins, setLogins] = useState<SupplierLogin[]>([]);
  const [factories, setFactories] = useState<DirectoryFactory[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [linkDialog, setLinkDialog] = useState<LoginLinkDialog | null>(null);
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null);

  const reload = async () => {
    const [loginResult, factoryResult] = await Promise.all([
      loadSupplierLogins(),
      loadDirectoryFactories(),
    ]);
    setLogins(loginResult.rows);
    setFactories(factoryResult.factories);
    setMissingTable(loginResult.missingTable);
    setError(loginResult.error || factoryResult.error);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  const invite = async () => {
    const factory = factories.find((row) => row.id === factoryId);
    if (!email.trim() || !factory) return;
    setSaving(true);
    try {
      const result = await inviteSupplier({
        email,
        factoryId: factory.id,
        factoryName: factory.name,
        factoryCode: factory.code ?? null,
      });
      if (!result.ok) {
        toast.error(result.error || '未能建立邀請');
        return;
      }
      if (!result.actionLink) {
        toast.error('已建立帳號，但未能取得登入連結，請在帳號列表再試。');
        return;
      }
      toast.success('已建立登入連結，請複製並傳給廠家。');
      setLinkDialog({
        email: email.trim().toLowerCase(),
        factoryName: factory.name,
        link: result.actionLink,
        kind: 'invite',
      });
      setEmail('');
      setFactoryId('');
      await reload();
    } finally {
      setSaving(false);
    }
  };

  /** Generate a fresh one-time magic link for an existing, active account. */
  const reissueLink = async (row: SupplierLogin) => {
    if (!row.active) {
      toast.error('此帳號已停用，請先啟用。');
      return;
    }
    setLinkBusyId(row.id);
    try {
      const result = await inviteSupplier({
        email: row.email,
        factoryId: row.factoryId,
        factoryName: row.factoryName,
        factoryCode: factories.find((factory) => factory.id === row.factoryId)?.code ?? null,
      });
      if (!result.ok) {
        toast.error(result.error || '未能產生登入連結');
        return;
      }
      if (!result.actionLink) {
        toast.error('未能取得登入連結，請再試一次。');
        return;
      }
      // One click should copy; the dialog stays as a fallback if the clipboard is blocked.
      await copyLoginLink(result.actionLink);
      setLinkDialog({
        email: row.email,
        factoryName: row.factoryName || row.factoryId,
        link: result.actionLink,
        kind: 'existing',
      });
    } finally {
      setLinkBusyId(null);
    }
  };

  const toggleLogin = async (row: SupplierLogin) => {
    if (row.active) {
      const ok = await confirm({
        title: `停用「${row.factoryName || row.email}」的登入？`,
        description: '停用後該廠家不能再登入或上載文件。',
        confirmLabel: '停用',
        destructive: true,
      });
      if (!ok) return;
    }
    const result = await setSupplierLoginActive(row.id, !row.active);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(row.active ? '已停用廠家帳號' : '已啟用廠家帳號');
    await reload();
  };

  const factoryLabel = (row: SupplierLogin) => {
    const name = (row.factoryName || row.factoryId).trim();
    const code = factories.find((factory) => factory.id === row.factoryId)?.code?.trim();
    // The PMS factory name can already include the code ("向氏 QXS"); do not repeat it.
    if (!code || name.toUpperCase().includes(code.toUpperCase())) return name;
    return `${name} ${code}`;
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <h1 className="fds-page-title">
            <LogIn className="h-5 w-5 text-primary" aria-hidden="true" />
            邀請廠家
          </h1>
          <p className="fds-page-description">
            用廠家電郵建立登入連結，指定所屬廠家後把連結傳給對方。廠家上載的資料會先經傢俬組審核。
          </p>
        </section>

        {missingTable && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            邀請廠家功能還沒準備好，暫時不能發邀請。請聯絡管理員。
          </section>
        )}
        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}
        {loading && <p className="px-2 text-sm text-muted-foreground">讀取廠家帳號…</p>}

        {!missingTable && (
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <div className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="text-base font-semibold">邀請廠家</p>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
              <label htmlFor="factory-invite-email" className="block text-sm font-medium">
                廠家電郵 <span className="text-destructive">*</span>
                <div className="relative mt-2">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="factory-invite-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="輸入廠家電郵"
                    className="h-10 pl-9"
                  />
                </div>
              </label>
              <div className="block text-sm font-medium">
                選擇廠家 <span className="text-destructive">*</span>
                <Select value={factoryId} onValueChange={setFactoryId}>
                  <SelectTrigger className="mt-2 h-10" aria-label="選擇廠家">
                    <SelectValue placeholder="選擇廠家" />
                  </SelectTrigger>
                  <SelectContent>
                    {factories.map((factory) => (
                      <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                disabled={saving || !email.trim() || !factoryId}
                onClick={() => void invite()}
                className="h-10 gap-2 px-4"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {saving ? '建立中…' : '建立邀請'}
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              建立後會顯示登入連結，請複製並自行傳給廠家。
            </p>
          </section>
        )}

        {!missingTable && (
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <div className="flex items-start gap-2">
              <UserRoundPlus className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
              <div>
                <p className="text-base font-semibold">廠家帳號</p>
                <p className="mt-0.5 text-xs text-muted-foreground">已建立的廠家帳號</p>
              </div>
            </div>
            {!loading && logins.length === 0 && (
              <CompactEmptyState
                icon={UserCog}
                title="還沒有廠家帳號"
                description="用上方表單邀請第一位廠家。"
                className="py-6"
              />
            )}
            <ul className="mt-3 divide-y divide-border/70">
              {logins.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <UserRoundPlus className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{factoryLabel(row)}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge
                      variant="outline"
                      className={
                        row.active
                          ? 'gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'gap-1 text-muted-foreground'
                      }
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {row.active ? '啟用中' : '已停用'}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!row.active || linkBusyId === row.id}
                      onClick={() => void reissueLink(row)}
                      title={row.active ? '生成一次性登入連結' : '請先啟用帳號'}
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {linkBusyId === row.id ? '生成中…' : '生成連結'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void toggleLogin(row)}
                    >
                      <Power className="h-3.5 w-3.5" aria-hidden="true" />
                      {row.active ? '停用' : '啟用'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <Modal
        open={linkDialog !== null}
        onOpenChange={(open) => {
          if (!open) setLinkDialog(null);
        }}
        title={linkDialog?.kind === 'existing' ? '登入連結已複製' : '廠家登入連結'}
        description={
          linkDialog
            ? `${linkDialog.factoryName} · ${linkDialog.email}。把連結傳給廠家，對方點擊即可登入。`
            : undefined
        }
        icon={<Link2 className="h-5 w-5" aria-hidden="true" />}
        size="lg"
        footer={
          <>
            <ModalButton variant="secondary" onClick={() => setLinkDialog(null)}>
              關閉
            </ModalButton>
            <ModalButton
              onClick={() => {
                if (linkDialog) void copyLoginLink(linkDialog.link);
              }}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              複製連結
            </ModalButton>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            readOnly
            value={linkDialog?.link ?? ''}
            aria-label="廠家登入連結"
            className="font-mono-data text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            連結有期限。關閉後可在「廠家帳號」再按「生成連結」重新取得。
          </p>
        </div>
      </Modal>
    </div>
  );
}
