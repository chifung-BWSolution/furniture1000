import { useEffect, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { updateZone } from '@/lib/solutionsApi';
import type { ProjectZone } from '@/types/solutions';

/**
 * FDS-10：平面圖分區可在方案裡改名稱與代號。
 *
 * 規則（見 docs/prd/FDS-V2.2.md §13）：
 * - 分區數不限四個；A／B／C／D 只是預設展示。
 * - 已存分區可修改。
 * - 分區資料寫入現有設計專案（project_zones），不另開一套區域模型。
 *
 * 這裡只改名稱與代號，不碰 bounds，避免誤觸平面圖位置。
 */

/** 代號只接受英數字與短橫線；中文名稱另存，兩者分開。 */
function normalizeCode(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^A-Z0-9-]/g, '');
  return cleaned || null;
}

export function ZoneRenameDialog({
  zone,
  open,
  onOpenChange,
  onSaved,
}: {
  zone: ProjectZone | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the persisted zone fields so the caller can patch local state. */
  onSaved?: (patch: { name: string; code: string | null }) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !zone) return;
    setName(zone.name);
    setCode(zone.code ?? '');
  }, [open, zone]);

  const save = async () => {
    if (!zone) return;
    const nextName = name.trim();
    if (!nextName) {
      toast.error('請輸入分區名稱');
      return;
    }
    const nextCode = normalizeCode(code);
    if (code.trim() && !nextCode) {
      toast.error('代號只可使用英文字母、數字或短橫線');
      return;
    }
    setSaving(true);
    try {
      const result = await updateZone(zone.id, { name: nextName, code: nextCode });
      if (!result.ok) {
        toast.error('更新分區失敗', { description: result.error });
        return;
      }
      onSaved?.({ name: nextName, code: nextCode });
      toast.success('已更新分區名稱與代號');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<Pencil className="h-6 w-6" />}
      title="編輯分區名稱與代號"
      description={zone ? `目前分區：${zone.name}` : undefined}
      footer={
        <>
          <ModalButton variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </ModalButton>
          <ModalButton disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            保存
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm font-medium text-foreground">
          分區名稱
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
            placeholder="例如：老闆室"
            className="mt-1.5"
          />
        </label>
        <label className="block text-sm font-medium text-foreground">
          分區代號
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
            placeholder="例如：B1"
            className="mt-1.5 font-mono-data"
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            代號只用英文字母、數字或短橫線，留空則沿用原有分組前綴。
          </span>
        </label>
      </div>
    </Modal>
  );
}

/** Zone toolbar button that opens {@link ZoneRenameDialog}. */
export function ZoneEditButton({
  zone,
  onOpen,
  className,
}: {
  zone: ProjectZone;
  onOpen: (zone: ProjectZone) => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onOpen(zone)}
      className={className}
      title={`編輯「${zone.name}」的名稱與代號`}
    >
      <Pencil className="mr-1.5 h-3.5 w-3.5" />
      分區名稱
    </Button>
  );
}
