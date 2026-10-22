import { useEffect, useState } from 'react';
import { FileText, LogIn, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { CompactEmptyState } from '@/components/ui/empty-state';
import { usePlatformRole } from '@/hooks/use-platform-role';
import {
  inviteSupplier,
  loadDirectoryFactories,
  loadSupplierLogins,
  loadSupplierReviewDocuments,
  setSupplierLoginActive,
  type DirectoryFactory,
  type SupplierDocumentRow,
  type SupplierLogin,
} from '@/lib/supplierLogins';

const STATUS_LABEL: Record<string, string> = {
  uploaded: '已上載',
  parsing: '解析中',
  review: '待審核',
  ready: '已入庫',
  failed: '失敗',
};

export function FactoryLoginView() {
  const { role, loading: roleLoading } = usePlatformRole();
  const isSupplier = role === 'supplier';
  const [logins, setLogins] = useState<SupplierLogin[]>([]);
  const [documents, setDocuments] = useState<SupplierDocumentRow[]>([]);
  const [factories, setFactories] = useState<DirectoryFactory[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    const [loginResult, factoryResult, documentResult] = await Promise.all([
      loadSupplierLogins(),
      isSupplier
        ? Promise.resolve({ factories: [] as DirectoryFactory[], error: null })
        : loadDirectoryFactories(),
      loadSupplierReviewDocuments(),
    ]);
    setLogins(loginResult.rows);
    setFactories(factoryResult.factories);
    setDocuments(documentResult.rows);
    setMissingTable(loginResult.missingTable || documentResult.missing);
    setError(loginResult.error || factoryResult.error || documentResult.error);
    setLoading(false);
  };

  useEffect(() => {
    if (roleLoading) return;
    void reload();
    // reload closes over the current role
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLoading, isSupplier]);

  const invite = async () => {
    const factory = factories.find((row) => row.id === factoryId);
    if (!email.trim() || !factory) return;
    setSaving(true);
    const result = await inviteSupplier({
      email,
      factoryId: factory.id,
      factoryName: factory.name,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error || '邀請失敗');
      return;
    }
    toast.success(result.alreadyRegistered ? '已綁定現有廠家帳號' : '已寄出廠家登入邀請');
    setEmail('');
    setFactoryId('');
    await reload();
  };

  const mine = logins.find((row) => row.active) ?? logins[0];

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <h1 className="fds-page-title">
            <LogIn className="h-5 w-5 text-primary" />
            廠家登入
          </h1>
          <p className="fds-page-description">
            {isSupplier
              ? '你的上載會先進入傢俬組審核，不會直接寫進產品目錄。'
              : '邀請廠家用自己的電郵登入。帳號角色是 supplier，並綁定一間 PMS 廠家。上載先入審核佇列。'}
          </p>
        </section>

        {missingTable && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            supplier_logins 或 fds_supplier_review_documents 尚未部署。邀請要等 migration 和 invite-supplier 都上線。
          </section>
        )}
        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}
        {(loading || roleLoading) && <p className="px-2 text-sm text-muted-foreground">讀取廠家登入…</p>}

        {!isSupplier && !missingTable && (
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <p className="text-sm font-medium">邀請廠家</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="廠家電郵"
                aria-label="廠家電郵"
                className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
              />
              <select
                value={factoryId}
                onChange={(event) => setFactoryId(event.target.value)}
                aria-label="綁定廠家"
                className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="">選擇廠家</option>
                {factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>{factory.name}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={saving}
                onClick={() => void invite()}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? '寄出中…' : '寄出邀請'}
              </button>
            </div>
          </section>
        )}

        {isSupplier && mine && (
          <section className="rounded-2xl border border-border/80 bg-card p-4 text-sm shadow-sm">
            {mine.factoryName || mine.factoryId} · {mine.email} · {mine.active ? '使用中' : '已停用'}
          </section>
        )}

        {!isSupplier && (
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <p className="text-sm font-medium">廠家帳號</p>
            {!loading && logins.length === 0 && (
              <CompactEmptyState
                icon={UserCog}
                title="還沒有廠家登入"
                className="py-6"
              />
            )}
            <ul className="mt-3 space-y-2">
              {logins.map((row) => (
                <li key={row.id} className="flex flex-col gap-2 rounded-xl border border-border/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{row.factoryName || row.factoryId}</p>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                  </div>
                  <button
                    type="button"
                    className="h-8 rounded-lg border border-border px-2 text-xs"
                    onClick={() => {
                      void setSupplierLoginActive(row.id, !row.active).then(async (result) => {
                        if (result.error) {
                          toast.error(result.error);
                          return;
                        }
                        await reload();
                      });
                    }}
                  >
                    {row.active ? '停用' : '啟用'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-border/80 bg-card px-4 py-5 md:px-6 shadow-sm sm:p-6">
          <p className="text-sm font-medium">{isSupplier ? '我的上載' : '審核佇列'}</p>
          <p className="mt-1 text-xs text-muted-foreground">狀態停留在待審核、解析中或已上載時，產品尚未公開。</p>
          {!loading && documents.length === 0 && (
            <CompactEmptyState
              icon={FileText}
              title="還沒有上載文件"
              className="py-6"
            />
          )}
          <ul className="mt-3 space-y-2">
            {documents.map((row) => (
              <li key={row.id} className="rounded-xl border border-border/80 px-3 py-2">
                <p className="text-sm font-medium">{row.title || row.factoryName || '未命名文件'}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABEL[row.status] ?? row.status}
                  {row.factoryName ? ` · ${row.factoryName}` : ''}
                  {row.docType ? ` · ${row.docType}` : ''}
                </p>
                {row.errorMessage && <p className="mt-1 text-xs text-destructive">{row.errorMessage}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
