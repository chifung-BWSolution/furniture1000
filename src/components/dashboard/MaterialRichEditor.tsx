import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Bold, Italic, UnderlineIcon, Palette } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { materialToEditorHtml } from '@/lib/quotationMaterialHtml';
import { ExcelStyleColorPicker } from '@/components/dashboard/ExcelStyleColorPicker';

interface MaterialRichEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

function normalizeHtmlForCompare(html: string): string {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/[\u00A0\u2060\u200B]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function MaterialRichEditor({
  value,
  onChange,
  placeholder = '材質及明細...',
  className,
}: MaterialRichEditorProps) {
  const initialHtml = useMemo(() => materialToEditorHtml(value), []);
  const initialContentRef = useRef(initialHtml);
  const [colorOpen, setColorOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color,
      Placeholder.configure({ placeholder }),
    ],
    content: initialContentRef.current || '',
    editorProps: {
      attributes: {
        class:
          'material-rich-editor-content min-h-[112px] outline-none font-body text-xs leading-relaxed text-foreground',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      const plain = ed.getText().trim();
      onChange(plain ? html : '');
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = materialToEditorHtml(value);
    if (normalizeHtmlForCompare(next) !== normalizeHtmlForCompare(editor.getHTML())) {
      editor.commands.setContent(next || '', { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!editor) return null;

  const btnBase =
    'flex h-7 w-7 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-accent hover:text-foreground';
  const btnActive = 'bg-primary/10 text-primary';
  const activeColor =
    (editor.getAttributes('textStyle').color as string | undefined) || '';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border bg-background focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-1.5 py-1">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={cn(btnBase, editor.isActive('bold') && btnActive)}
          title="粗體"
          aria-label="粗體"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn(btnBase, editor.isActive('italic') && btnActive)}
          title="斜體"
          aria-label="斜體"
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={cn(btnBase, editor.isActive('underline') && btnActive)}
          title="文字加底線"
          aria-label="文字加底線"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </button>

        <div
          className="relative ml-0.5"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setColorOpen(false);
            }
          }}
        >
          <button
            type="button"
            onClick={() => setColorOpen((v) => !v)}
            className={cn(btnBase, (colorOpen || activeColor) && btnActive)}
            title="文字顏色"
            aria-label="文字顏色"
          >
            <span className="relative inline-flex flex-col items-center">
              <Palette className="h-3.5 w-3.5" />
              <span
                className="mt-0.5 h-0.5 w-3.5 rounded-full"
                style={{ backgroundColor: activeColor || '#1a1a1a' }}
              />
            </span>
          </button>
          {colorOpen ? (
            <div className="absolute left-0 top-full z-30 mt-1">
              <ExcelStyleColorPicker
                activeColor={activeColor}
                onClear={() => {
                  editor.chain().focus().unsetColor().run();
                }}
                onPick={(color) => {
                  editor.chain().focus().setColor(color).run();
                }}
                onClose={() => setColorOpen(false)}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="material-rich-editor px-2 py-1.5">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
