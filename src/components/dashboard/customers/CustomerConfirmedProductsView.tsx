import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, MessageSquare, Send, AtSign, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import {
  fetchProjects, fetchZoneProducts, fetchDiscussions,
  updateZoneProductStatus, addDiscussion,
} from '@/lib/solutionsApi';
import { toast } from 'sonner';
import {
  ZONE_PRODUCT_STATUS_META,
  type ZoneProductStatus, type DesignProject, type ZoneProduct, type ProductDiscussion,
} from '@/types/solutions';

function fmt(d: string) {
  const x = new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

export function CustomerConfirmedProductsView() {
  const [project, setProject] = useState<DesignProject | null>(null);
  const [products, setProducts] = useState<ZoneProduct[]>([]);
  const [discussions, setDiscussions] = useState<ProductDiscussion[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ZoneProductStatus>>({});
  const [openDiscussion, setOpenDiscussion] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchProjects().then((rows) => {
      const p = rows[0];
      if (!p) { setLoaded(true); return; }
      setProject(p);
      Promise.all([fetchZoneProducts(p.id), fetchDiscussions(p.id)]).then(([zp, disc]) => {
        const inZone = zp.filter((x) => x.zoneId);
        setProducts(inZone);
        setStatuses(Object.fromEntries(inZone.map((x) => [x.id, x.status])));
        setDiscussions(disc);
        // default-open the first product that has a discussion
        const firstWithDisc = inZone.find((x) => disc.some((d) => d.zoneProductId === x.id));
        if (firstWithDisc) setOpenDiscussion(firstWithDisc.id);
      }).finally(() => setLoaded(true));
    });
  }, []);

  const confirmedCount = Object.values(statuses).filter((s) => s === 'confirmed').length;
  const progress = products.length > 0 ? Math.round((confirmedCount / products.length) * 100) : 0;

  if (!project) {
    if (!loaded) {
      return (
        <div className="flex h-full items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <CheckCircle2 className="h-8 w-8 text-primary" />
        </div>
        <h2 className="font-display text-lg font-bold">尚無待確認產品</h2>
        <p className="font-body text-sm text-muted-foreground">當您受邀的專案有產品方案時，會在此顯示供您確認</p>
      </div>
    );
  }

  const setStatus = async (id: string, s: ZoneProductStatus) => {
    setStatuses((prev) => ({ ...prev, [id]: s }));
    const res = await updateZoneProductStatus(id, s);
    if (!res.ok) toast.error('更新失敗', { description: res.error });
  };

  const handleSend = async (zoneProductId: string) => {
    const body = draft.trim();
    if (!body) return;
    const mentions = Array.from(body.matchAll(/@(\S+)/g)).map((m) => m[1]);
    setDraft('');
    const res = await addDiscussion({
      projectId: project!.id,
      zoneProductId,
      author: '陳大文（客戶）',
      authorRole: 'client',
      body,
      mentions,
    });
    if (res.ok && res.data) {
      setDiscussions((prev) => [...prev, res.data!]);
      toast.success('已送出留言，已通知 PM / 設計師');
    } else {
      toast.error('送出失敗', { description: res.error });
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10">
      <div className="mx-auto max-w-3xl">
        {/* Header + progress */}
        <h1 className="font-display text-2xl font-bold tracking-tight">確定產品</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">{project.name}</p>
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-body text-[13px] font-medium text-foreground">整體確認進度</span>
            <span className="font-mono-data text-sm font-bold text-primary">{progress}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{confirmedCount} / {products.length} 件已確定</p>
        </div>

        {/* Product list */}
        <div className="mt-5 space-y-3">
          {products.map((p) => {
            const status = statuses[p.id];
            const itemDiscussions = discussions.filter((d) => d.zoneProductId === p.id);
            const isOpen = openDiscussion === p.id;
            return (
              <div key={p.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center gap-3 p-3">
                  <img src={p.productImageUrl} alt={p.productTitle} loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover bg-muted" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-[13.5px] font-semibold text-foreground">{p.productTitle}</h3>
                    <p className="font-mono-data text-[12px] text-primary">${p.salePrice.toLocaleString()} · 數量 × {p.quantity}</p>
                  </div>
                  {/* status toggle */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setStatus(p.id, 'confirmed')}
                      className={cn('flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all', status === 'confirmed' ? ZONE_PRODUCT_STATUS_META.confirmed.className : 'border-border text-muted-foreground hover:text-foreground')}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> 已確定
                    </button>
                    <button
                      onClick={() => setStatus(p.id, 'discussing')}
                      className={cn('flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all', status === 'discussing' ? ZONE_PRODUCT_STATUS_META.discussing.className : 'border-border text-muted-foreground hover:text-foreground')}
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> 待討論
                    </button>
                  </div>
                </div>

                {/* Discussion toggle */}
                <button
                  onClick={() => setOpenDiscussion(isOpen ? null : p.id)}
                  className="flex w-full items-center justify-between border-t border-border/60 bg-muted/20 px-3 py-2 text-[11.5px] text-muted-foreground hover:bg-muted/40"
                >
                  <span className="flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> 討論區 {itemDiscussions.length > 0 && `(${itemDiscussions.length})`}</span>
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>

                {isOpen && (
                  <div className="border-t border-border/60 p-3">
                    <div className="space-y-3">
                      {itemDiscussions.map((d) => (
                        <div key={d.id} className="flex gap-2">
                          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', d.authorRole === 'client' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
                            {d.author.slice(0, 1)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11.5px]"><span className="font-semibold text-foreground">{d.author}</span> <span className="font-mono-data text-[10px] text-muted-foreground/60">{fmt(d.createdAt)}</span></p>
                            <p className="font-body text-[12.5px] text-muted-foreground">{d.body}</p>
                          </div>
                        </div>
                      ))}
                      {itemDiscussions.length === 0 && <p className="text-center text-[11px] text-muted-foreground/60">尚無討論，留言即時通知 PM / 設計師</p>}
                    </div>
                    {/* composer */}
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
                      <button className="rounded p-1 text-muted-foreground hover:text-primary" title="提及"><AtSign className="h-3.5 w-3.5" /></button>
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSend(p.id); }}
                        placeholder="輸入留言，使用 @ 提及 PM / 設計師..."
                        className="flex-1 bg-transparent font-body text-[12.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                      />
                      <button onClick={() => handleSend(p.id)} className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"><Send className="h-3 w-3" /> 送出</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
