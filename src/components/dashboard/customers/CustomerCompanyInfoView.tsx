import { useState, useEffect, useMemo } from 'react';
import {
  Building2, User, Mail, Phone, MapPin, ShieldAlert, Save, ArrowRight,
  CheckCircle2, FolderClock, Loader2,
} from 'lucide-react';
import { submitCompanyChanges } from '@/lib/solutionsApi';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import { toast } from 'sonner';
import type { DesignProject } from '@/types/solutions';

interface CustomerCompanyInfoViewProps {
  onOpenProject?: (projectId: string) => void;
}

export function CustomerCompanyInfoView({ onOpenProject }: CustomerCompanyInfoViewProps) {
  const { loading, company, projects } = useClientZoneContext();
  const [form, setForm] = useState({
    name: '',
    contactPerson: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!company) return;
    setForm({
      name: company.name,
      contactPerson: company.contactPerson ?? '',
      contactEmail: company.contactEmail ?? '',
      contactPhone: company.contactPhone ?? '',
      address: company.address ?? '',
    });
  }, [company]);

  const historyProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const rank = (p: DesignProject) => (p.status === 'confirmed' ? 0 : p.status === 'archived' ? 1 : 2);
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [projects]);

  const pendingFields = company?.pendingChanges ?? {};
  const hasPending = Object.keys(pendingFields).length > 0;

  const handleSubmit = async () => {
    if (!company?.id) {
      toast.error('找不到公司資料');
      return;
    }
    setIsSubmitting(true);
    const res = await submitCompanyChanges(company.id, {
      name: form.name,
      contact_person: form.contactPerson,
      contact_email: form.contactEmail,
      contact_phone: form.contactPhone,
      address: form.address,
    });
    setIsSubmitting(false);
    if (res.ok) {
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2500);
      toast.success('已提交修改，待 PM 審核');
    } else {
      toast.error('提交失敗', { description: res.error });
    }
  };

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
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">公司資料</h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">管理您的公司聯絡資訊與查看歷史專案</p>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="font-body text-[12.5px] text-amber-700 dark:text-amber-400">
            修改聯絡資訊後需經 PM 審核才會生效，審核期間仍顯示原有資料。
            {hasPending && ' 您有修改正在等待審核。'}
          </p>
        </div>

        {!company ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 font-display text-sm text-muted-foreground">尚未建立公司資料</p>
            <p className="mt-1 text-[12px] text-muted-foreground/70">請聯絡 PM 為您建立客戶公司檔案</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-bold">公司與聯絡資料</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field icon={<Building2 className="h-3.5 w-3.5" />} label="公司名稱" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field icon={<User className="h-3.5 w-3.5" />} label="聯絡人" value={form.contactPerson} onChange={(v) => setForm({ ...form, contactPerson: v })} />
              <Field icon={<Mail className="h-3.5 w-3.5" />} label="電郵" value={form.contactEmail} onChange={(v) => setForm({ ...form, contactEmail: v })} />
              <Field icon={<Phone className="h-3.5 w-3.5" />} label="電話" value={form.contactPhone} onChange={(v) => setForm({ ...form, contactPhone: v })} />
              <div className="sm:col-span-2">
                <Field icon={<MapPin className="h-3.5 w-3.5" />} label="地址" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              {submitted && (
                <span className="flex items-center gap-1 text-[12px] font-medium text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 已提交，待 PM 審核
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" /> 提交修改（需審核）
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3">
            <FolderClock className="h-4 w-4 text-primary" />
            <h2 className="font-display text-sm font-bold">歷史專案</h2>
            <span className="font-mono-data text-[11px] text-muted-foreground">{historyProjects.length} 個受邀專案</span>
          </div>
          <div className="divide-y divide-border/60">
            {historyProjects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProject?.(p.id)}
                className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-muted/30"
              >
                <div>
                  <p className="font-display text-[13.5px] font-semibold text-foreground">{p.name}</p>
                  <p className="font-mono-data text-[11px] text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString('zh-HK')} · {statusLabel(p)} · {p.progress}% 已確認
                  </p>
                </div>
                <span className="flex items-center gap-1 text-[12px] font-medium text-primary">
                  查看方案 <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
            {historyProjects.length === 0 && (
              <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">尚無受邀專案紀錄</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  icon, label, value, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 font-body text-[11.5px] font-medium text-muted-foreground">
        {icon} {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
