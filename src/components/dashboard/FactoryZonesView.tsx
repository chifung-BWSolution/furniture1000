import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  addFactoryToZone,
  createFactoryZone,
  deleteFactoryZone,
  loadDirectoryFactories,
  loadFactoryZones,
  removeFactoryFromZone,
  type DirectoryFactory,
  type FactoryZone,
  type FactoryZoneMember,
} from '@/lib/factoryZones';

export function FactoryZonesView() {
  const [zones, setZones] = useState<FactoryZone[]>([]);
  const [members, setMembers] = useState<FactoryZoneMember[]>([]);
  const [factories, setFactories] = useState<DirectoryFactory[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [pick, setPick] = useState<Record<string, string>>({});

  const reload = async () => {
    const [zoneResult, factoryResult] = await Promise.all([loadFactoryZones(), loadDirectoryFactories()]);
    setZones(zoneResult.zones);
    setMembers(zoneResult.members);
    setMissingTable(zoneResult.missingTable);
    setFactories(factoryResult.factories);
    setError(zoneResult.error || factoryResult.error);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  const factoryById = useMemo(() => new Map(factories.map((row) => [row.id, row])), [factories]);
  const placed = useMemo(() => new Set(members.map((row) => row.factoryId)), [members]);

  const addZone = async () => {
    if (!name.trim()) return;
    const result = await createFactoryZone(name, note);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setName('');
    setNote('');
    toast.success('已新增分區');
    await reload();
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <h1 className="fds-page-title">
            <MapIcon className="h-5 w-5 text-primary" />
            廠家分區
          </h1>
          <p className="fds-page-description">
            把廠家放進自訂分區。這裡只記錄分組，不會改廠家本身的資料。這和報價單上的房間分區不是同一件事。
          </p>
          <p className="mt-3 text-sm">
            廠家 {factories.length} 間 · 已分區 {placed.size} 間 · 未分區 {Math.max(factories.length - placed.size, 0)} 間
          </p>
        </section>

        {missingTable && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            分區功能還沒準備好，暫時不能儲存。廠家名單已經讀到。請聯絡管理員。
          </section>
        )}
        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}
        {loading && <p className="px-2 text-sm text-muted-foreground">讀取廠家與分區…</p>}

        {!missingTable && (
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <p className="text-sm font-medium">新增分區</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="分區名稱"
                aria-label="分區名稱"
                className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
              />
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="備註（可空）"
                aria-label="分區備註"
                className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
              />
              <button
                type="button"
                onClick={() => void addZone()}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                新增
              </button>
            </div>
          </section>
        )}

        {!loading && zones.length === 0 && !missingTable && (
          <EmptyState
            title="還沒有廠家分區"
            description="用上方的「新增」建立分區，把廠家分組管理。"
          />
        )}

        <ul className="space-y-3">
          {zones.map((zone) => {
            const zoneMembers = members.filter((row) => row.zoneId === zone.id);
            const taken = new Set(zoneMembers.map((row) => row.factoryId));
            const choices = factories.filter((row) => !taken.has(row.id));
            return (
              <li key={zone.id} className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{zone.name}</p>
                    {zone.note && <p className="text-sm text-muted-foreground">{zone.note}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{zoneMembers.length} 間廠家</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`刪除分區 ${zone.name}`}
                    onClick={() => {
                      void deleteFactoryZone(zone.id).then(async (result) => {
                        if (result.error) {
                          toast.error(result.error);
                          return;
                        }
                        toast.success('已刪除分區');
                        await reload();
                      });
                    }}
                    className="rounded-lg border border-border p-2 text-muted-foreground"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <ul className="mt-3 space-y-1">
                  {zoneMembers.map((member) => {
                    const live = factoryById.get(member.factoryId);
                    return (
                      <li key={member.factoryId} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          {live?.name || member.factoryName || member.factoryId}
                          {live?.location ? ` · ${live.location}` : ''}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground"
                          onClick={() => {
                            void removeFactoryFromZone(zone.id, member.factoryId).then(async (result) => {
                              if (result.error) {
                                toast.error(result.error);
                                return;
                              }
                              await reload();
                            });
                          }}
                        >
                          移出
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 flex gap-2">
                  <Select
                    value={pick[zone.id] ?? ''}
                    onValueChange={(value) => setPick((prev) => ({ ...prev, [zone.id]: value }))}
                  >
                    <SelectTrigger className="h-10 min-w-0 flex-1" aria-label={`${zone.name} 加入廠家`}>
                      <SelectValue placeholder="選擇廠家" />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((factory) => (
                        <SelectItem key={factory.id} value={factory.id}>
                          {factory.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    className="h-10 rounded-lg border border-border px-3 text-sm"
                    onClick={() => {
                      const factoryId = pick[zone.id];
                      const factory = factories.find((row) => row.id === factoryId);
                      if (!factory) return;
                      void addFactoryToZone(zone.id, factory.id, factory.name).then(async (result) => {
                        if (result.error) {
                          toast.error(result.error);
                          return;
                        }
                        setPick((prev) => ({ ...prev, [zone.id]: '' }));
                        await reload();
                      });
                    }}
                  >
                    加入
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
