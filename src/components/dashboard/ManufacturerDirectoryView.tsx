import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Search,
  BookOpen,
  Factory,
  MessageSquare,
  FileText,
  Package,
  User,
  ExternalLink,
  RefreshCw,
  X,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

// --- Types ---

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

// --- Linked Project (from bridge join) ---
interface LinkedProjectRecord {
  id: string;
  project_name: string;
  project_content: string;
  signed_date: string | null;
  estimated_profit: number;
}

// --- Component ---

export function ManufacturerDirectoryView() {
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [comments, setComments] = useState<StaffComment[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [factoryLinkedProjects, setFactoryLinkedProjects] = useState<Record<string, LinkedProjectRecord[]>>({});
  const [factoryStats, setFactoryStats] = useState<Record<string, { order_count: number; comment_count: number }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFactory, setSelectedFactory] = useState<FactoryRecord | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-fetch-manufacturer-directory'
      );

      if (error) {
        console.error('[ManufacturerDirectory] Edge function error:', error);
        const errMsg = typeof error === 'object' && error.message
          ? error.message
          : 'Edge function invocation failed';
        toast.error(`Failed to fetch manufacturer data: ${errMsg}`);
        return;
      }

      // Check if response contains an error field (function returned 500)
      if (data?.error) {
        console.error('[ManufacturerDirectory] Server error:', data.error);
        toast.error(`Server error: ${data.error}`);
        return;
      }

      if (data) {
        console.log('[ManufacturerDirectory] Data received:', {
          factories: data.factories?.length,
          comments: data.comments?.length,
          products: data.products?.length,
          factory_linked_projects: data.factory_linked_projects ? Object.keys(data.factory_linked_projects).length : 0,
          factory_stats: data.factory_stats,
        });
        setFactories(data.factories || []);
        setComments(data.comments || []);
        setProducts(data.products || []);
        setFactoryLinkedProjects(data.factory_linked_projects || {});
        setFactoryStats(data.factory_stats || {});
      }
    } catch (err) {
      console.error('[ManufacturerDirectory] Network error:', err);
      toast.error('Network error fetching manufacturer data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter factories by search query
  const filteredFactories = useMemo(() => {
    if (!searchQuery.trim()) return factories;
    const q = searchQuery.toLowerCase();
    return factories.filter(
      (f) =>
        f.display_name?.toLowerCase().includes(q) ||
        f.factory_code?.toLowerCase().includes(q)
    );
  }, [factories, searchQuery]);

  // Get comments for a specific factory
  const getCommentsForFactory = useCallback(
    (factory: FactoryRecord) => {
      const result = comments.filter(
        (c) =>
          c.factory_id === factory.id ||
          c.factory_id === factory.factory_code ||
          c.factory === factory.display_name ||
          c.factory === factory.factory_code
      );
      return result;
    },
    [comments]
  );

  // Get linked projects for a factory (via bwf_projects.factories_id)
  const getLinkedProjectsForFactory = useCallback(
    (factory: FactoryRecord): LinkedProjectRecord[] => {
      return factoryLinkedProjects[factory.id] || [];
    },
    [factoryLinkedProjects]
  );

  // Get products for a specific factory
  const getProductsForFactory = useCallback(
    (factory: FactoryRecord) => {
      const result = products.filter(
        (p) =>
          p.factory_id === factory.id ||
          p.factory_id === factory.factory_code ||
          p.factory_name === factory.display_name ||
          p.factory_name === factory.factory_code
      );
      return result;
    },
    [products]
  );

  const handleViewDetail = (factory: FactoryRecord) => {
    setSelectedFactory(factory);
    setIsDetailOpen(true);
  };

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">廠家目錄</h1>
            <p className="font-body text-xs text-muted-foreground">
              Manufacturer Directory · {factories.length} records
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          <span className="font-mono-data text-xs">Refresh</span>
        </Button>
      </div>

      {/* Search & Filter Bar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋廠家名稱或代號..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 font-body text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Badge variant="secondary" className="font-mono-data text-xs">
          {filteredFactories.length} / {factories.length}
        </Badge>
      </div>

      {/* Main Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-display text-xs font-semibold w-[200px]">
                  廠家名稱
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[120px]">
                  廠家代號
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[100px]">
                  訂單數
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[100px]">
                  意見數
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[100px]">
                  產品數
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[120px]">
                  建立日期
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[100px] text-right">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {filteredFactories.map((factory, index) => {
                  const factoryComments = getCommentsForFactory(factory);
                  const factoryProducts = getProductsForFactory(factory);
                  const stats = factoryStats[factory.id];
                  const orderCount = stats?.order_count ?? 0;
                  const commentCount = stats?.comment_count ?? factoryComments.length;

                  return (
                    <motion.tr
                      key={factory.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ delay: index * 0.03 }}
                      className="group cursor-pointer border-b border-border/50 hover:bg-muted/30 transition-colors"
                      onClick={() => handleViewDetail(factory)}
                    >
                      <TableCell className="font-body text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <Factory className="h-4 w-4 text-muted-foreground" />
                          {factory.display_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono-data text-[10px]">
                          {factory.factory_code || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono-data text-xs text-muted-foreground">
                          {orderCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono-data text-xs text-muted-foreground">
                          {commentCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono-data text-xs text-muted-foreground">
                          {factoryProducts.length}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono-data text-[11px] text-muted-foreground">
                          {factory.created_at
                            ? new Date(factory.created_at).toLocaleDateString('zh-HK')
                            : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDetail(factory);
                          }}
                        >
                          <ChevronRight className="h-4 w-4" />
                          <span className="ml-1 text-xs">查看</span>
                        </Button>
                      </TableCell>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>

              {filteredFactories.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Search className="h-8 w-8 opacity-30" />
                      <p className="font-body text-sm">沒有找到匹配的廠家</p>
                      <p className="font-mono-data text-[11px]">
                        No manufacturers found matching your search
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Factory Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold flex items-center gap-2">
              <Factory className="h-5 w-5 text-primary" />
              {selectedFactory?.display_name || '廠家詳情'}
            </DialogTitle>
          </DialogHeader>

          {selectedFactory && (
            <FactoryDetailContent
              factory={selectedFactory}
              comments={getCommentsForFactory(selectedFactory)}
              products={getProductsForFactory(selectedFactory)}
              linkedProjects={getLinkedProjectsForFactory(selectedFactory)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Factory Detail Content ---

interface FactoryDetailContentProps {
  factory: FactoryRecord;
  comments: StaffComment[];
  products: ProductRecord[];
  linkedProjects: LinkedProjectRecord[];
}

function FactoryDetailContent({
  factory,
  comments,
  products,
  linkedProjects,
}: FactoryDetailContentProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'orders' | 'comments' | 'products'>('info');
  const [localComments, setLocalComments] = useState<StaffComment[]>(comments);

  // Use linkedProjects (bwf_projects matched via factories_id → factories.id) as the primary data source for order history
  const orderHistoryRecords = useMemo(() => {
    const records: OrderHistoryRecord[] = linkedProjects.map((p) => ({
      id: p.id,
      orderDate: p.signed_date || '',
      productType: p.project_content || '—',
      orderAmount: Number(p.estimated_profit) || 0,
      clientName: p.project_name || '—',
    }));

    // Sort by date descending
    records.sort((a, b) => {
      const da = a.orderDate ? new Date(a.orderDate).getTime() : 0;
      const db = b.orderDate ? new Date(b.orderDate).getTime() : 0;
      return db - da;
    });
    return records;
  }, [linkedProjects]);

  const handleFeedbackAdded = (newComment: StaffComment) => {
    setLocalComments((prev) => [newComment, ...prev]);
  };

  const tabs = [
    { id: 'info' as const, label: '基本資料', icon: Factory },
    { id: 'orders' as const, label: `訂貨資料 (${orderHistoryRecords.length})`, icon: Package },
    { id: 'comments' as const, label: `用家意見 (${localComments.length})`, icon: MessageSquare },
    { id: 'products' as const, label: `產品PDF (${products.length})`, icon: FileText },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab Nav */}
      <div className="flex border-b border-border mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-xs font-body transition-colors border-b-2 -mb-[1px]',
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
      <ScrollArea className="flex-1">
        {activeTab === 'info' && <FactoryInfoTab factory={factory} />}
        {activeTab === 'orders' && <FactoryOrdersTab records={orderHistoryRecords} />}
        {activeTab === 'comments' && (
          <FactoryCommentsTab
            comments={localComments}
            factory={factory}
            onFeedbackAdded={handleFeedbackAdded}
          />
        )}
        {activeTab === 'products' && <FactoryProductsTab products={products} />}
      </ScrollArea>
    </div>
  );
}

// --- Tab: Basic Info ---

function FactoryInfoTab({ factory }: { factory: FactoryRecord }) {
  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-4">
        <InfoCard label="廠家編號" value={factory.id} mono />
        <InfoCard label="廠家名稱" value={factory.display_name} />
        <InfoCard label="廠家代號" value={factory.factory_code || '—'} mono />
        <InfoCard
          label="建立日期"
          value={
            factory.created_at
              ? new Date(factory.created_at).toLocaleDateString('zh-HK', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : '—'
          }
        />
      </div>
      <Separator />
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
        <p className="font-display text-xs font-semibold text-muted-foreground mb-2">
          名稱及地址 (Address)
        </p>
        <p className="font-body text-sm text-muted-foreground italic">
          地址資料尚未錄入 — Address data not yet available.
        </p>
      </div>
    </div>
  );
}

function InfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <p className="font-display text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={cn('text-sm truncate', mono ? 'font-mono-data text-xs' : 'font-body')}>
        {value}
      </p>
    </div>
  );
}

// --- Tab: PMS Orders ---

interface OrderHistoryRecord {
  id: string;
  orderDate: string;
  productType: string;
  orderAmount: number;
  clientName: string;
}

function FactoryOrdersTab({ records }: { records: OrderHistoryRecord[] }) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="查無訂單資料"
        description="No matching bwf_projects found for this factory (via factories_id bridge)."
      />
    );
  }

  const totalAmount = records.reduce((sum, r) => sum + r.orderAmount, 0);

  return (
    <div className="p-1">
      {/* Summary */}
      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg border border-border/50 bg-muted/10">
        <Badge variant="secondary" className="font-mono-data text-xs">
          共 {records.length} 筆訂單
        </Badge>
        <Badge variant="outline" className="font-mono-data text-xs">
          總金額: ${totalAmount.toLocaleString()}
        </Badge>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-display text-[10px] font-semibold">訂單日期</TableHead>
            <TableHead className="font-display text-[10px] font-semibold">產品種類</TableHead>
            <TableHead className="font-display text-[10px] font-semibold text-right">訂單金額</TableHead>
            <TableHead className="font-display text-[10px] font-semibold">客人名稱</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id} className="border-b border-border/30">
              <TableCell>
                <span className="font-mono-data text-[11px] text-muted-foreground">
                  {record.orderDate
                    ? new Date(record.orderDate).toLocaleDateString('zh-HK')
                    : '—'}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="font-mono-data text-[10px]">
                  {record.productType}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-mono-data text-xs font-medium">
                  {record.orderAmount > 0
                    ? `$${record.orderAmount.toLocaleString()}`
                    : '—'}
                </span>
              </TableCell>
              <TableCell className="font-body text-xs">
                <div className="flex items-center gap-1.5">
                  <User className="h-3 w-3 text-muted-foreground" />
                  {record.clientName}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Tab: Staff Comments / User Feedback ---

function FactoryCommentsTab({
  comments,
  factory,
  onFeedbackAdded,
}: {
  comments: StaffComment[];
  factory: FactoryRecord;
  onFeedbackAdded: (comment: StaffComment) => void;
}) {
  const [newComment, setNewComment] = useState('');
  const [staffName, setStaffName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmitFeedback = async () => {
    if (!newComment.trim()) {
      toast.error('請輸入意見內容');
      return;
    }

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

      if (error || data?.error) {
        toast.error(`儲存失敗: ${error?.message || data?.error}`);
        return;
      }

      const savedComment: StaffComment = data.comment || {
        id: crypto.randomUUID(),
        factory_id: factory.factory_code || factory.id,
        factory: factory.display_name,
        comment: newComment.trim(),
        staff_name: staffName.trim() || '匿名用戶',
        created_at: new Date().toISOString(),
      };

      onFeedbackAdded(savedComment);
      setNewComment('');
      toast.success('意見已成功儲存');
    } catch (err) {
      toast.error('網絡錯誤，請重試');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 p-1">
      {/* Feedback Input Form */}
      <div className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
        <p className="font-display text-xs font-semibold text-foreground">
          新增意見 (Add Feedback)
        </p>
        <div className="grid grid-cols-1 gap-3">
          <Input
            placeholder="你的名字 (Your name, optional)"
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
            <Button
              size="sm"
              onClick={handleSubmitFeedback}
              disabled={isSubmitting || !newComment.trim()}
              className="gap-2"
            >
              {isSubmitting ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5" />
              )}
              <span className="font-mono-data text-xs">
                {isSubmitting ? '儲存中...' : '提交意見'}
              </span>
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      {/* Existing Comments */}
      {comments.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="暫無用家意見"
          description="No user feedback found for this manufacturer. Be the first to add one!"
        />
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <motion.div
              key={comment.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-border/50 bg-muted/10 p-4"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-3 w-3 text-primary" />
                  </div>
                  <span className="font-body text-xs font-medium">
                    {comment.staff_name || '匿名用戶'}
                  </span>
                </div>
                <span className="font-mono-data text-[10px] text-muted-foreground">
                  {comment.created_at
                    ? new Date(comment.created_at).toLocaleDateString('zh-HK')
                    : ''}
                </span>
              </div>
              <p className="font-body text-sm text-foreground/80 leading-relaxed pl-8">
                {comment.comment}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Tab: Product PDFs ---

function FactoryProductsTab({ products }: { products: ProductRecord[] }) {
  if (products.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="暫無產品PDF"
        description="No product catalogs or PDF links found for this manufacturer."
      />
    );
  }

  return (
    <div className="space-y-2 p-1">
      {products.map((product) => {
        const imageList = Array.isArray(product.images) ? product.images : [];
        const pdfLinks = imageList.filter(
          (img: any) =>
            typeof img === 'string' && img.toLowerCase().endsWith('.pdf')
        );

        return (
          <div
            key={product.id}
            className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/10 p-3 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-body text-sm font-medium truncate max-w-[300px]">
                  {product.title}
                </p>
                <p className="font-mono-data text-[10px] text-muted-foreground">
                  {product.category || 'Uncategorized'} · {imageList.length} media file(s)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pdfLinks.length > 0 ? (
                pdfLinks.map((link: string, idx: number) => (
                  <TooltipProvider key={idx}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-mono-data text-primary hover:bg-primary/10 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          PDF {idx + 1}
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Open PDF in new tab</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))
              ) : (
                <span className="font-mono-data text-[10px] text-muted-foreground">
                  No PDF available
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Empty State ---

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 mb-3">
        <Icon className="h-6 w-6 text-muted-foreground/50" />
      </div>
      <p className="font-body text-sm text-muted-foreground">{title}</p>
      <p className="font-mono-data text-[11px] text-muted-foreground/60 mt-1">{description}</p>
    </div>
  );
}
