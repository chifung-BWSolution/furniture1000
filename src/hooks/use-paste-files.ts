import { useEffect, useRef } from 'react';

export type UsePasteFilesOptions = {
  /** 只有這個上載區在畫面上時才攔截貼上。 */
  enabled?: boolean;
  /** 一次可以貼上多張圖；預設只取第一張。 */
  multiple?: boolean;
  /** 回傳 false 的檔案會略過。 */
  accept?: (file: File) => boolean;
  onFiles: (files: File[]) => void;
};

/** 把剪貼簿裡的檔案取出來；Ctrl+V 貼圖與右鍵貼上都會觸發 paste。 */
export function filesFromClipboard(data: DataTransfer | null, multiple = false): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.push(file);
    if (!multiple) break;
  }
  return files;
}

/**
 * 讓上載元件支援 Ctrl+V 貼上檔案。
 * 文字貼上不受影響：剪貼簿沒有檔案時完全不攔截。
 */
export function usePasteFiles({ enabled = true, multiple = false, accept, onFiles }: UsePasteFilesOptions) {
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      // 輸入框貼文字時不要搶走；只有剪貼簿真的帶檔案才處理。
      if (target?.closest('input, textarea, [contenteditable="true"]') && event.clipboardData?.types.includes('text/plain')) return;
      const files = filesFromClipboard(event.clipboardData, multiple)
        .filter((file) => !acceptRef.current || acceptRef.current(file));
      if (!files.length) return;
      event.preventDefault();
      onFilesRef.current(files);
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [enabled, multiple]);
}
