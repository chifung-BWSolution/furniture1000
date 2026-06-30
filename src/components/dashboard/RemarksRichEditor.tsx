import { useCallback, useRef, useState } from "react";
import { GripVertical, ImagePlus, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  MAX_REMARKS_IMAGES,
  countRemarksImages,
  parseRemarksContent,
  serializeRemarksContent,
  type RemarksBlock,
} from "@/lib/remarksContent";

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function BlockDragHandle({
  blockId,
  onDragStart,
  onDragEnd,
}: {
  blockId: string;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", blockId);
        onDragStart(blockId);
      }}
      onDragEnd={onDragEnd}
      className="mt-1 shrink-0 cursor-grab rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
      title="拖曳調整順序"
      aria-label="拖曳調整順序"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
}

function blockDropClass(
  index: number,
  blockId: string,
  draggingBlockId: string | null,
  dropInsertIndex: number | null,
) {
  return cn(
    "flex gap-1 rounded-md border border-transparent px-0.5 py-0.5 transition-colors",
    draggingBlockId === blockId && "opacity-50",
    dropInsertIndex === index && "border-t-2 border-t-primary",
    dropInsertIndex === index + 1 && "border-b-2 border-b-primary",
  );
}

interface RemarksRichEditorProps {
  value: string;
  legacyImage?: string;
  onChange: (serialized: string) => void;
}

export function RemarksRichEditor({
  value,
  legacyImage,
  onChange,
}: RemarksRichEditorProps) {
  const [blocks, setBlocks] = useState<RemarksBlock[]>(() =>
    parseRemarksContent(value, legacyImage),
  );
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const emitChange = useCallback(
    (next: RemarksBlock[]) => {
      setBlocks(next);
      onChange(serializeRemarksContent(next));
    },
    [onChange],
  );

  const imageCount = countRemarksImages(blocks);

  const moveBlock = useCallback(
    (fromId: string, insertIndex: number) => {
      setBlocks((prev) => {
        const fromIndex = prev.findIndex((b) => b.id === fromId);
        if (fromIndex === -1) return prev;
        let toIndex = Math.max(0, Math.min(insertIndex, prev.length));
        if (fromIndex < toIndex) toIndex -= 1;
        if (fromIndex === toIndex) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        onChange(serializeRemarksContent(next));
        return next;
      });
    },
    [onChange],
  );

  const clearDrag = useCallback(() => {
    setDraggingBlockId(null);
    setDropInsertIndex(null);
  }, []);

  const handleBlockDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      setDropInsertIndex(
        e.clientY < rect.top + rect.height / 2 ? index : index + 1,
      );
    },
    [],
  );

  const handleBlockDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData("text/plain") || draggingBlockId;
      if (fromId && dropInsertIndex !== null) {
        moveBlock(fromId, dropInsertIndex);
      }
      clearDrag();
    },
    [clearDrag, draggingBlockId, dropInsertIndex, moveBlock],
  );

  const addTextBlock = () => {
    emitChange([
      ...blocks,
      {
        type: "text",
        content: "",
        id: Math.random().toString(36).slice(2, 12),
      },
    ]);
  };

  const addImageBlock = async (src: string) => {
    if (imageCount >= MAX_REMARKS_IMAGES) {
      toast.error(`備註欄位最多上傳 ${MAX_REMARKS_IMAGES} 張圖片`);
      return;
    }
    emitChange([
      ...blocks,
      {
        type: "image",
        src,
        id: Math.random().toString(36).slice(2, 12),
      },
    ]);
  };

  const updateTextBlock = (id: string, content: string) => {
    emitChange(
      blocks.map((b) => (b.id === id && b.type === "text" ? { ...b, content } : b)),
    );
  };

  const removeBlock = (id: string) => {
    const next = blocks.filter((b) => b.id !== id);
    const hasText = next.some((b) => b.type === "text");
    if (!hasText) {
      next.unshift({
        type: "text",
        content: "",
        id: Math.random().toString(36).slice(2, 12),
      });
    }
    emitChange(next);
  };

  const handlePasteImage = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await addImageBlock(await fileToDataUrl(file));
        return;
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await addImageBlock(await fileToDataUrl(file));
  };

  return (
    <div
      className="flex min-w-[120px] flex-col gap-1"
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          clearDrag();
        }
      }}
    >
      {blocks.map((block, index) => (
        <div
          key={block.id}
          className={blockDropClass(index, block.id, draggingBlockId, dropInsertIndex)}
          onDragOver={(e) => handleBlockDragOver(e, index)}
          onDrop={handleBlockDrop}
        >
          <BlockDragHandle
            blockId={block.id}
            onDragStart={setDraggingBlockId}
            onDragEnd={clearDrag}
          />
          {block.type === "text" ? (
            <div className="min-w-0 flex-1">
              <textarea
                value={block.content}
                placeholder="備註文字..."
                rows={2}
                onChange={(e) => updateTextBlock(block.id, e.target.value)}
                onPaste={handlePasteImage}
                className="w-full resize-y rounded-md border border-border bg-background px-2 py-1 font-body text-[10px] leading-snug text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          ) : (
            <div className="group relative min-w-0 flex-1">
              <img
                src={block.src}
                alt=""
                draggable={false}
                className="max-h-20 w-full rounded border border-border object-contain"
              />
              <button
                type="button"
                onClick={() => removeBlock(block.id)}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white shadow group-hover:flex"
                title="移除圖片"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          {(block.type !== "text" || blocks.filter((b) => b.type === "text").length > 1) && (
            <button
              type="button"
              onClick={() => removeBlock(block.id)}
              className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
              title="刪除"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <button
          type="button"
          onClick={addTextBlock}
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-body text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="新增文字區塊"
        >
          <Plus className="h-2.5 w-2.5" />
          文字
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={imageCount >= MAX_REMARKS_IMAGES}
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-body text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title={`上傳圖片 (${imageCount}/${MAX_REMARKS_IMAGES})`}
        >
          <Upload className="h-2.5 w-2.5" />
          圖片 {imageCount}/{MAX_REMARKS_IMAGES}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={imageCount >= MAX_REMARKS_IMAGES}
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-body text-[9px] text-primary/70 transition-colors hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          title="上傳或貼上圖片"
        >
          <ImagePlus className="h-2.5 w-2.5" />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
