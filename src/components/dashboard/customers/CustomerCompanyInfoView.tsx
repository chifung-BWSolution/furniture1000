import { useMemo } from 'react';
import {
<<<<<<< HEAD
  Building2, User, Mail, Phone, MapPin, ArrowRight,
  FolderClock, Loader2,
=======
  Building2, User, Mail, Phone, MapPin, ShieldAlert, Save,
  CheckCircle2, FolderClock, Loader2,
>>>>>>> 395b226 (refactor: remove empty customer portal design and confirmed pages)
} from 'lucide-react';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import type { DesignProject } from '@/types/solutions';

export function CustomerCompanyInfoView() {
  const { loading, company, projects } = useClientZoneContext();

  const historyProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const rank = (p: DesignProject) => (p.status === 'confirmed' ? 0 : p.status === 'archived' ? 1 : 2);
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [projects]);

  const statusLabel = (p: DesignProject) => {
    if (p.status === 'confirmed') return '已確認';
    if (p.status === 'archived') return '已封存';
    if (p.status === 'draft') return '草稿';
    return '進行中';
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">公司資料</h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            唯讀顯示此登入客戶在 Supabase 的公司及聯絡資料
          </p>
        </div>

        {!company ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 font-display text-sm text-muted-foreground">尚未建立公司資料</p>
            <p className="mt-1 text-[13px] text-muted-foreground/70">請聯絡 PM 為您建立客戶公司檔案</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-bold">公司與聯絡資料</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field icon={<Building2 className="h-3.5 w-3.5" />} label="公司名稱" value={company.name} />
              <Field icon={<User className="h-3.5 w-3.5" />} label="聯絡人" value={company.contactPerson ?? ''} />
              <Field icon={<Mail className="h-3.5 w-3.5" />} label="電郵" value={company.contactEmail ?? ''} />
              <Field icon={<Phone className="h-3.5 w-3.5" />} label="電話" value={company.contactPhone ?? ''} />
              <div className="sm:col-span-2">
                <Field icon={<MapPin className="h-3.5 w-3.5" />} label="地址" value={company.address ?? ''} />
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3">
            <FolderClock className="h-4 w-4 text-primary" />
            <h2 className="font-display text-sm font-bold">歷史專案</h2>
            <span className="font-mono-data text-xs text-muted-foreground">{historyProjects.length} 個受邀專案</span>
          </div>
          <div className="divide-y divide-border/60">
            {historyProjects.map((p) => (
              <div
                key={p.id}
                className="flex w-full items-center justify-between px-5 py-3.5 text-left"
              >
                <div>
                  <p className="font-display text-[15px] font-semibold text-foreground">{p.name}</p>
                  <p className="font-mono-data text-xs text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString('zh-HK')} · {statusLabel(p)} · {p.progress}% 已確認
                  </p>
                </div>
<<<<<<< HEAD
                <span className="flex items-center gap-1 text-[13px] font-medium text-primary">
                  查看方案 <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </button>
=======
              </div>
>>>>>>> 395b226 (refactor: remove empty customer portal design and confirmed pages)
            ))}
            {historyProjects.length === 0 && (
              <p className="px-5 py-8 text-center text-[15px] text-muted-foreground">尚無受邀專案紀錄</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, value }: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 font-body text-xs font-medium text-muted-foreground">
        {icon} {label}
      </label>
      <input
        value={value}
        readOnly
        className="w-full rounded-lg border border-border bg-muted/20 px-3 py-2 font-body text-sm text-foreground"
      />
    </div>
  );
}
