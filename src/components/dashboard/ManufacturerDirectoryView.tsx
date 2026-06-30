import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search,
  BookOpen,
  Factory,
  RefreshCw,
  X,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/hooks/use-app-store';
import { motion, AnimatePresence } from 'framer-motion';

interface FactoryRecord {
  id: string;
  display_name: string;
  factory_code: string | null;
  contact_person: string | null;
  phone: string | null;
  location: string | null;
  project_number: number | null;
  working_folder: string | null;
  join_date: string | null;
}

function formatJoinDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-HK');
}

export function ManufacturerDirectoryView() {
  const store = useAppStore();
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

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

      if (data?.error) {
        console.error('[ManufacturerDirectory] Server error:', data.error);
        toast.error(`Server error: ${data.error}`);
        return;
      }

      if (data) {
        setFactories(data.factories || []);
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

  const filteredFactories = useMemo(() => {
    if (!searchQuery.trim()) return factories;
    const q = searchQuery.toLowerCase();
    return factories.filter(
      (f) =>
        f.display_name?.toLowerCase().includes(q) ||
        f.factory_code?.toLowerCase().includes(q) ||
        f.contact_person?.toLowerCase().includes(q) ||
        f.phone?.toLowerCase().includes(q) ||
        f.location?.toLowerCase().includes(q)
    );
  }, [factories, searchQuery]);

  const handleViewDetail = (factory: FactoryRecord) => {
    const slug = factory.factory_code || factory.id;
    store.setFactoryDetailCode(slug);
    store.setCurrentView('factory-detail');
  };

  return (
    <div className="flex h-full flex-col p-6">
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
                <TableHead className="font-display text-xs font-semibold min-w-[180px]">
                  廠家名稱
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[90px]">
                  廠家代號
                </TableHead>
                <TableHead className="font-display text-xs font-semibold min-w-[100px]">
                  聯絡人
                </TableHead>
                <TableHead className="font-display text-xs font-semibold min-w-[110px]">
                  電話
                </TableHead>
                <TableHead className="font-display text-xs font-semibold min-w-[100px]">
                  地點
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[80px]">
                  訂單數
                </TableHead>
                <TableHead className="font-display text-xs font-semibold min-w-[140px]">
                  工作檔案
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[110px]">
                  加入日期
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[90px] text-right">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {filteredFactories.map((factory, index) => (
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
                        <Factory className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {factory.display_name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono-data text-[10px]">
                        {factory.factory_code || '—'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-body text-xs text-muted-foreground">
                        {factory.contact_person || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono-data text-xs text-muted-foreground">
                        {factory.phone || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-body text-xs text-muted-foreground">
                        {factory.location || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono-data text-xs text-muted-foreground">
                        {factory.project_number ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-mono-data text-[11px] text-muted-foreground line-clamp-2"
                        title={factory.working_folder || undefined}
                      >
                        {factory.working_folder || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono-data text-[11px] text-muted-foreground">
                        {formatJoinDate(factory.join_date)}
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
                ))}
              </AnimatePresence>

              {filteredFactories.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center">
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
    </div>
  );
}
