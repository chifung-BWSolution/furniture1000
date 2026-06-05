import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// ─── Standalone route wrapper ─────────────────────────────────────────────────
// This is kept so the /manufacturers/:factoryCode route still works as a
// fallback (e.g. direct URL navigation). The AppShell uses FactoryDetailView.
export function FactoryDetailPage() {
  const { factoryCode } = useParams<{ factoryCode: string }>();
  const navigate = useNavigate();
  if (!factoryCode) return null;
  return (
    <FactoryDetailView
      factoryCode={factoryCode}
      onBack={() => navigate(-1)}
    />
  );
}
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  Copy,
  Check,
  Factory,
  Package,
  MessageSquare,
  FileText,
  User,
  ExternalLink,
  Save,
  Loader2,
  Calendar,
  BarChart3,
  Edit2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FactoryRecord {
  id: string;
  display_name: string;
  factory_code: string | null;
  created_at: string;
}

interface StaffComment {
  id: string;
  factory_id?: string;
  factory?: string;
  comment: string;
  staff_name?: string;
  created_at: string;
}

interface ProductRecord {
  id: string;
  title: string;
  factory_id?: string;
  factory_name?: string;
  images?: any;
  category?: string;
}

interface LinkedProjectRecord {
  id: string;
  project_name: string;
  project_content: string;
  signed_date: string | null;
  estimated_profit: number;
}

interface OrderHistoryRecord {
  id: string;
  orderDate: string;
  productType: string;
  orderAmount: number;
  clientName: string;
}

// ─── Shared View (used both by the standalone route and the AppShell view) ────

export function FactoryDetailView({
  factoryCode,
  onBack,
}: {
  factoryCode: string;
  onBack: () => void;
}) {

  const [factory, setFactory] = useState<FactoryRecord | null>(null);
  const [comments, setComments] = useState<StaffComment[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [linkedProjects, setLinkedProjects] = useState<LinkedProjectRecord[]>([]);
  const [stats, setStats] = useState<{ order_count: number; comment_count: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'orders' | 'comments' | 'products'>('info');
  const [urlCopied, setUrlCopied] = useState(false);

  // Fetch all data via the existing edge function
  const fetchData = useCallback(async () => {
    if (!factoryCode) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-fetch-manufacturer-directory'
      );
      if (error || data?.error) {
        toast.error(`資料載入失敗: ${error?.message || data?.error}`);
        return;
      }
      if (data) {
        const allFactories: FactoryRecord[] = data.factories || [];
        const found = allFactories.find(
          (f) =>
            f.factory_code?.toLowerCase() === factoryCode.toLowerCase() ||
            f.id === factoryCode
        );
        if (!found) {
          toast.error('找不到此廠家');
          onBack();
          return;
        }
        setFactory(found);

        const allComments: StaffComment[] = data.comments || [];
        setComments(
          allComments.filter(
            (c) =>
              c.factory_id === found.id ||
              c.factory_id === found.factory_code ||
              c.factory === found.display_name ||
              c.factory === found.factory_code
          )
        );

        const allProducts: ProductRecord[] = data.products || [];
        setProducts(
          allProducts.filter(
            (p) =>
              p.factory_id === found.id ||
              p.factory_id === found.factory_code ||
              p.factory_name === found.display_name ||
              p.factory_name === found.factory_code
          )
        );

        const projectMap: Record<string, LinkedProjectRecord[]> = data.factory_linked_projects || {};
        setLinkedProjects(projectMap[found.id] || []);

        const statsMap: Record<string, { order_count: number; comment_count: number }> =
          data.factory_stats || {};
        setStats(statsMap[found.id] || null);
      }
    } catch (err) {
      toast.error('網絡錯誤，請重試');
    } finally {
      setIsLoading(false);
    }
  }, [factoryCode, navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const orderHistoryRecords: OrderHistoryRecord[] = useMemo(() => {
    return linkedProjects
      .map((p) => ({
        id: p.id,
        orderDate: p.signed_date || '',
        productType: p.project_content || '—',
        orderAmount: Number(p.estimated_profit) || 0,
        clientName: p.project_name || '—',
      }))
      .sort((a, b) => {
        const da = a.orderDate ? new Date(a.orderDate).getTime() : 0;
        const db = b.orderDate ? new Date(b.orderDate).getTime() : 0;
        return db - da;
      });
  }, [linkedProjects]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
    toast.success('連結已複製到剪貼板');
  };

  const handleCommentAdded = (c: StaffComment) => {
    setComments((prev) => [c, ...prev]);
  };

  const tabs = factory
    ? [
        { id: 'info' as const, label: '基本資料', icon: Factory },
        {
          id: 'orders' as const,
          label: `訂貨記錄 (${orderHistoryRecords.length})`,
          icon: Package,
        },
        {
          id: 'comments' as const,
          label: `客戶意見 (${(stats?.comment_count ?? comments.length)})`,
          icon: MessageSquare,
        },
        { id: 'products' as const, label: `產品PDF (${products.length})`, icon: FileText },
      ]
    : [];

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="font-body text-sm">正在載入廠家資料...</p>
        </div>
      </div>
    );
  }

  if (!factory) return null;

  return (
    <div className="h-full overflow-y-auto bg-background">
      {/* Sub-header — back + actions, sits inside the AppShell content area */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="flex h-12 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="gap-1.5 font-display text-xs"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回廠家目錄
            </Button>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Factory className="h-4 w-4 text-primary" />
              <span className="font-display text-sm font-bold">{factory.display_name}</span>
              {factory.factory_code && (
                <Badge variant="outline" className="font-mono-data text-[10px]">
                  {factory.factory_code}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              disabled={isLoading}
              className="gap-1.5 font-display text-xs"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              重新整理
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyUrl}
              className="gap-1.5 font-display text-xs"
            >
              {urlCopied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {urlCopied ? '已複製' : '複製連結'}
            </Button>
          </div>
        </div>
      </div>

      {/* Page Body */}
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Hero Row */}
        <div className="mb-8 flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Factory className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {factory.display_name}
              </h1>
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span className="font-mono-data text-xs">
                  建立於{' '}
                  {factory.created_at
                    ? new Date(factory.created_at).toLocaleDateString('zh-HK', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : '—'}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <span className="font-mono-data text-[11px] text-muted-foreground/60">
                  /manufacturers/{factory.factory_code || factory.id}
                </span>
              </div>
            </div>
          </div>

          {/* Stats pills */}
          <div className="flex gap-3">
            <div className="rounded-xl border border-border bg-card p-4 text-center min-w-[90px]">
              <BarChart3 className="mx-auto h-4 w-4 text-indigo-500 mb-1" />
              <p className="font-mono-data text-xl font-bold">{stats?.order_count ?? orderHistoryRecords.length}</p>
              <p className="font-body text-[10px] text-muted-foreground">成功登單</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 text-center min-w-[90px]">
              <MessageSquare className="mx-auto h-4 w-4 text-emerald-500 mb-1" />
              <p className="font-mono-data text-xl font-bold">{stats?.comment_count ?? comments.length}</p>
              <p className="font-body text-[10px] text-muted-foreground">客戶意見</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 text-center min-w-[90px]">
              <FileText className="mx-auto h-4 w-4 text-amber-500 mb-1" />
              <p className="font-mono-data text-xl font-bold">{products.length}</p>
              <p className="font-body text-[10px] text-muted-foreground">產品PDF</p>
            </div>
          </div>
        </div>

        {/* Tab Nav */}
        <div className="flex border-b border-border mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-5 py-2.5 text-sm font-body transition-colors border-b-2 -mb-[1px]',
                activeTab === tab.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'info' && (
              <FactoryInfoTab factory={factory} onUpdated={(updated) => setFactory(updated)} />
            )}
            {activeTab === 'orders' && <FactoryOrdersTab records={orderHistoryRecords} />}
            {activeTab === 'comments' && (
              <FactoryCommentsTab
                comments={comments}
                factory={factory}
                onFeedbackAdded={handleCommentAdded}
              />
            )}
            {activeTab === 'products' && <FactoryProductsTab products={products} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Tab: Basic Info (editable) ───────────────────────────────────────────────

function FactoryInfoTab({
  factory,
  onUpdated,
}: {
  factory: FactoryRecord;
  onUpdated: (f: FactoryRecord) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(factory.display_name);
  const [factoryCode, setFactoryCode] = useState(factory.factory_code || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const trimmedCode = factoryCode.trim().toUpperCase();
    if (trimmedCode && !/^[A-Z]{1,3}$/.test(trimmedCode)) {
      toast.error('廠家代號只能包含 1–3 個英文字母');
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('factories')
        .update({
          display_name: displayName.trim(),
          factory_code: trimmedCode || null,
        })
        .eq('id', factory.id);

      if (error) {
        toast.error(`儲存失敗: ${error.message}`);
        return;
      }
      onUpdated({ ...factory, display_name: displayName.trim(), factory_code: trimmedCode || null });
      toast.success('廠家資料已更新');
      setIsEditing(false);
    } catch (err) {
      toast.error('網絡錯誤，請重試');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-widest">
          基本資料
        </h2>
        {!isEditing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="gap-1.5 font-display text-xs"
          >
            <Edit2 className="h-3.5 w-3.5" />
            編輯
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsEditing(false);
                setDisplayName(factory.display_name);
                setFactoryCode(factory.factory_code || '');
              }}
              className="font-display text-xs"
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-1.5 font-display text-xs"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              儲存
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="font-mono-data text-[10px] uppercase tracking-widest text-muted-foreground">
            廠家名稱
          </Label>
          {isEditing ? (
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="font-body text-sm"
            />
          ) : (
            <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
              <span className="font-body text-sm">{factory.display_name}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="font-mono-data text-[10px] uppercase tracking-widest text-muted-foreground">
            廠家代號 <span className="normal-case text-muted-foreground/60">(1–3 位英文字)</span>
          </Label>
          {isEditing ? (
            <Input
              value={factoryCode}
              onChange={(e) => setFactoryCode(e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              placeholder="例如 PMJ"
              className="font-mono-data text-sm uppercase"
            />
          ) : (
            <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
              <Badge variant="outline" className="font-mono-data text-xs">
                {factory.factory_code || '—'}
              </Badge>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="font-mono-data text-[10px] uppercase tracking-widest text-muted-foreground">
            建立日期
          </Label>
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
            <span className="font-mono-data text-xs">
              {factory.created_at
                ? new Date(factory.created_at).toLocaleDateString('zh-HK', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : '—'}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="font-mono-data text-[10px] uppercase tracking-widest text-muted-foreground">
            廠家 ID
          </Label>
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
            <span className="font-mono-data text-[11px] text-muted-foreground truncate block">
              {factory.id}
            </span>
          </div>
        </div>
      </div>

      <Separator />

      <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
        <p className="font-display text-xs font-semibold text-muted-foreground mb-2">
          廠家地址 (Address)
        </p>
        <p className="font-body text-sm text-muted-foreground italic">
          地址資料尚未錄入 — 可在未來版本新增地址欄位。
        </p>
      </div>
    </div>
  );
}

// ─── Tab: Order History ───────────────────────────────────────────────────────

function FactoryOrdersTab({ records }: { records: OrderHistoryRecord[] }) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="查無訂貨記錄"
        description="此廠家暫無相關訂單（bwf_projects 未有關聯記錄）"
      />
    );
  }

  const totalAmount = records.reduce((s, r) => s + r.orderAmount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
        <Badge variant="secondary" className="font-mono-data text-xs">
          共 {records.length} 筆訂單
        </Badge>
        <Badge variant="outline" className="font-mono-data text-xs">
          總金額: ${totalAmount.toLocaleString()}
        </Badge>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="font-display text-[10px] font-semibold">訂單日期</TableHead>
              <TableHead className="font-display text-[10px] font-semibold">產品種類</TableHead>
              <TableHead className="font-display text-[10px] font-semibold text-right">訂單金額</TableHead>
              <TableHead className="font-display text-[10px] font-semibold">客戶名稱</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.id} className="border-b border-border/30">
                <TableCell>
                  <span className="font-mono-data text-[11px] text-muted-foreground">
                    {r.orderDate ? new Date(r.orderDate).toLocaleDateString('zh-HK') : '—'}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono-data text-[10px]">
                    {r.productType}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono-data text-xs font-medium">
                    {r.orderAmount > 0 ? `$${r.orderAmount.toLocaleString()}` : '—'}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 font-body text-xs">
                    <User className="h-3 w-3 text-muted-foreground" />
                    {r.clientName}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab: Comments ────────────────────────────────────────────────────────────

function FactoryCommentsTab({
  comments,
  factory,
  onFeedbackAdded,
}: {
  comments: StaffComment[];
  factory: FactoryRecord;
  onFeedbackAdded: (c: StaffComment) => void;
}) {
  const [newComment, setNewComment] = useState('');
  const [staffName, setStaffName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!newComment.trim()) { toast.error('請輸入意見內容'); return; }
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-fetch-manufacturer-directory',
        {
          body: {
            action: 'save_feedback',
            feedback: {
              factory_id: factory.factory_code || factory.id,
              factory_name: factory.display_name,
              comment: newComment.trim(),
              staff_name: staffName.trim() || '匿名用戶',
            },
          },
        }
      );
      if (error || data?.error) { toast.error(`儲存失敗: ${error?.message || data?.error}`); return; }
      const saved: StaffComment = data.comment || {
        id: crypto.randomUUID(),
        factory_id: factory.factory_code || factory.id,
        factory: factory.display_name,
        comment: newComment.trim(),
        staff_name: staffName.trim() || '匿名用戶',
        created_at: new Date().toISOString(),
      };
      onFeedbackAdded(saved);
      setNewComment('');
      toast.success('意見已成功儲存');
    } catch { toast.error('網絡錯誤，請重試'); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Form */}
      <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
        <p className="font-display text-xs font-semibold">新增意見</p>
        <Input
          placeholder="你的名字（選填）"
          value={staffName}
          onChange={(e) => setStaffName(e.target.value)}
          className="font-body text-sm"
        />
        <textarea
          placeholder="輸入你對此廠家的意見或評價..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-body text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSubmit} disabled={isSubmitting || !newComment.trim()} className="gap-2">
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
            <span className="font-display text-xs">{isSubmitting ? '儲存中...' : '提交意見'}</span>
          </Button>
        </div>
      </div>

      <Separator />

      {comments.length === 0 ? (
        <EmptyState icon={MessageSquare} title="暫無客戶意見" description="Be the first to add feedback for this manufacturer." />
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-border/50 bg-muted/10 p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-3 w-3 text-primary" />
                  </div>
                  <span className="font-body text-xs font-medium">{c.staff_name || '匿名用戶'}</span>
                </div>
                <span className="font-mono-data text-[10px] text-muted-foreground">
                  {c.created_at ? new Date(c.created_at).toLocaleDateString('zh-HK') : ''}
                </span>
              </div>
              <p className="font-body text-sm text-foreground/80 leading-relaxed pl-8">{c.comment}</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Products ────────────────────────────────────────────────────────────

function FactoryProductsTab({ products }: { products: ProductRecord[] }) {
  if (products.length === 0) {
    return <EmptyState icon={FileText} title="暫無產品PDF" description="No product catalogs found for this manufacturer." />;
  }
  return (
    <div className="space-y-2">
      {products.map((product) => {
        const imageList = Array.isArray(product.images) ? product.images : [];
        const pdfLinks = imageList.filter((img: any) => typeof img === 'string' && img.toLowerCase().endsWith('.pdf'));
        return (
          <div key={product.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 p-3 hover:bg-muted/20 transition-colors">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-body text-sm font-medium truncate max-w-[400px]">{product.title}</p>
                <p className="font-mono-data text-[10px] text-muted-foreground">
                  {product.category || 'Uncategorized'} · {imageList.length} media file(s)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pdfLinks.length > 0 ? pdfLinks.map((link: string, idx: number) => (
                <a key={idx} href={link} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-mono-data text-primary hover:bg-primary/10 transition-colors">
                  <ExternalLink className="h-3 w-3" />PDF {idx + 1}
                </a>
              )) : (
                <span className="font-mono-data text-[10px] text-muted-foreground">No PDF</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 mb-3">
        <Icon className="h-6 w-6 text-muted-foreground/50" />
      </div>
      <p className="font-body text-sm text-muted-foreground">{title}</p>
      <p className="font-mono-data text-[11px] text-muted-foreground/60 mt-1">{description}</p>
    </div>
  );
}
