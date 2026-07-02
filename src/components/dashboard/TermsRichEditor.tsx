import { useEditor, EditorContent, Extension, Mark } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  Bold,
  Italic,
  UnderlineIcon,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  Undo2,
  Redo2,
  Heading2,
  MinusSquare,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * Custom Underline mark extension that overrides the default TipTap Underline.
 * 
 * KEY FIX: The default `Underline` extension uses `parseHTML` that works fine,
 * but ProseMirror's internal normalization will strip marks from text nodes
 * that it considers "empty" (whitespace-only). 
 * 
 * This custom version:
 * 1. Sets `inclusive: true` so the mark extends when typing at the edge
 * 2. Defines `spanning: true` to allow spanning multiple nodes
 * 3. Uses a more permissive parseHTML that captures the full content
 */
const CustomUnderline = Mark.create({
  name: 'underline',
  
  // Allow the mark to span across multiple nodes  
  spanning: true,
  
  // Keep the mark active when cursor is at the edge
  inclusive: true,

  parseHTML() {
    return [
      { tag: 'u' },
      {
        style: 'text-decoration',
        consuming: false,
        getAttrs: (style) => ((style as string).includes('underline') ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', HTMLAttributes, 0];
  },

  addCommands() {
    return {
      setUnderline: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleUnderline: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetUnderline: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-u': () => this.editor.commands.toggleUnderline(),
      'Mod-U': () => this.editor.commands.toggleUnderline(),
    };
  },
});

// Extend TipTap's Commands interface for TypeScript support
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    underline: {
      setUnderline: () => ReturnType;
      toggleUnderline: () => ReturnType;
      unsetUnderline: () => ReturnType;
    };
  }
}

/**
 * Custom TipTap extension: preserves empty paragraphs by injecting a <br> node
 * into paragraphs that would otherwise be stripped. This is similar to CKEditor's
 * FillEmptyBlocks / IgnoreEmptyParagraph setting — we explicitly keep them.
 */
const PreserveEmptyBlocks = Extension.create({
  name: 'preserveEmptyBlocks',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          preserveEmpty: {
            default: null,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },
});

/**
 * Custom TipTap extension: converts regular spaces to \u00A0 (non-breaking space)
 * when typed inside an underline mark. This ensures ProseMirror never strips
 * the underline from space-only content.
 */
const UnderlineSpacePreserver = Extension.create({
  name: 'underlineSpacePreserver',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('underlineSpacePreserver'),
        props: {
          handleTextInput(view, from, to, text) {
            // Only intercept space characters
            if (text !== ' ') return false;
            
            // Check if underline mark is active at cursor position
            const { state } = view;
            const underlineMark = state.schema.marks.underline;
            if (!underlineMark) return false;
            
            // Check if underline is in the stored marks (active marks at cursor)
            const storedMarks = state.storedMarks || state.selection.$from.marks();
            const hasUnderline = storedMarks.some(
              (mark) => mark.type === underlineMark
            );
            
            if (!hasUnderline) return false;
            
            // Replace regular space with non-breaking space while keeping all marks
            const tr = state.tr.insertText('\u00A0', from, to);
            view.dispatch(tr);
            return true; // We handled it
          },
        },
      }),
    ];
  },
});

interface TermsRichEditorProps {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
}

/**
 * Preserve blank underlines: ensure spaces inside <u> tags use \u00A0 (non-breaking space).
 * 
 * KEY INSIGHT: ProseMirror's HTML parser treats &nbsp; as a character entity and preserves it,
 * but its internal normalization can still strip marks from nodes it deems "empty."
 * The solution is to use actual \u00A0 characters which ProseMirror treats as real text content
 * (not whitespace), so the underline mark is never stripped.
 *
 * Also preserves empty paragraphs by injecting a <br> so TipTap doesn't strip them.
 */
function preserveUnderlineSpaces(html: string): string {
  // Process <u> tags: convert all whitespace-only content to \u00A0 sequences
  let result = html.replace(/<u([^>]*)>([\s\S]*?)<\/u>/gi, (_match, attrs: string, inner: string) => {
    // Handle completely empty <u></u> — convert to blank underline with non-breaking spaces
    if (inner.length === 0) {
      return `<u${attrs}>${'\u00A0'.repeat(20)}</u>`;
    }
    
    // Normalize: count meaningful length (replace &nbsp; entities with single chars for counting)
    const normalized = inner.replace(/&nbsp;/g, '\u00A0');
    
    // Check if content is whitespace-only (blank underline / fill-in-the-blank)
    const stripped = normalized.replace(/[\s\u00A0\u200B\u2060\u2003]/g, '');
    if (stripped.length === 0) {
      // Count the approximate number of spaces intended
      const len = Math.max(normalized.length, 20);
      // Use literal \u00A0 characters — ProseMirror treats these as real content, never strips them
      return `<u${attrs}>${'\u00A0'.repeat(len)}</u>`;
    } else {
      // Content has visible characters — still convert any &nbsp; to \u00A0 for consistency
      return `<u${attrs}>${normalized}</u>`;
    }
  });

  // Preserve empty paragraphs: replace <p></p> with <p><br></p>
  // This is how TipTap/ProseMirror represents empty blocks internally
  result = result.replace(/<p([^>]*)><\/p>/gi, '<p$1><br></p>');

  return result;
}

/**
 * Insert a blank underline directly using non-breaking spaces.
 * ProseMirror preserves \u00A0 (nbsp) characters unlike regular spaces.
 */
function insertBlankUnderline(editor: ReturnType<typeof useEditor>) {
  if (!editor) return;
  // Insert HTML directly — most reliable way to ensure the underline with &nbsp; is preserved
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'text',
      marks: [{ type: 'underline' }],
      text: '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0',
    })
    .run();
}

export function TermsRichEditor({ value, onChange, editable = true }: TermsRichEditorProps) {
  const processedValue = preserveUnderlineSpaces(value);
  const initialContentRef = useRef(processedValue);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
        // Keep empty paragraphs — don't auto-strip them
        paragraph: {},
        hardBreak: {},
      }),
      // Use our CustomUnderline instead of the default TipTap Underline
      // This version has `inclusive: true` and `spanning: true` which prevents
      // ProseMirror from stripping the mark from whitespace-only content
      CustomUnderline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      UnderlineSpacePreserver,
      PreserveEmptyBlocks,
    ],
    content: initialContentRef.current,
    editable,
    // Disable auto-cleanup of empty inline nodes (preserves empty <u>, <span>, etc.)
    enableContentCheck: false,
    onUpdate: ({ editor }) => {
      // 存儲時自動轉換空白下劃線為 &nbsp; 格式
      let html = editor.getHTML();
      
      // TipTap may output \u00A0 as literal characters; normalize them to &nbsp; entities
      // specifically within <u> tags to ensure consistent storage
      html = html.replace(/<u([^>]*)>([\s\S]*?)<\/u>/gi, (_match, attrs: string, inner: string) => {
        // Replace literal \u00A0 with &nbsp; entity for consistency
        const normalized = inner.replace(/\u00A0/g, '&nbsp;');
        return `<u${attrs}>${normalized}</u>`;
      });
      
      // Also handle the case where TipTap outputs regular spaces in underline tags
      // This catches: <u> </u>, <u>   </u>, <u>  text  </u> etc.
      html = html.replace(/<u([^>]*)>([\s\S]*?)<\/u>/gi, (_match, attrs: string, inner: string) => {
        // Check if content is whitespace-only (no visible characters, no &nbsp;)
        const withoutNbsp = inner.replace(/&nbsp;/g, '');
        const strippedVisible = withoutNbsp.replace(/[\s]/g, '');
        if (strippedVisible.length === 0 && inner.length > 0) {
          // Count existing &nbsp; entities
          const nbspCount = (inner.match(/&nbsp;/g) || []).length;
          // Count regular whitespace characters
          const wsCount = withoutNbsp.length;
          const totalLen = Math.max(nbspCount + wsCount, 20);
          return `<u${attrs}>${'&nbsp;'.repeat(totalLen)}</u>`;
        }
        return `<u${attrs}>${inner}</u>`;
      });
      
      onChange(html);
    },
  });

  // Sync content when value changes externally (e.g. loaded from DB)
  useEffect(() => {
    if (!editor) return;
    // Normalize both sides for comparison to avoid infinite loops
    // (value has regular spaces, editor may have \u00A0)
    const normalizeForCompare = (s: string) =>
      s.replace(/&nbsp;/g, ' ').replace(/[\u00A0\u2060\u200B\u2003]/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalizeForCompare(value) !== normalizeForCompare(editor.getHTML())) {
      // Use setContent with emitUpdate=false to avoid triggering onChange loop
      // The preserveUnderlineSpaces function converts &nbsp; to \u00A0 which
      // ProseMirror treats as real text content (never stripped)
      const processed = preserveUnderlineSpaces(value);
      editor.commands.setContent(processed, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Sync editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  if (!editor) return null;

  const btnBase =
    'flex h-7 w-7 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed';
  const btnActive = 'bg-primary/10 text-primary';
  const divider = 'mx-0.5 h-5 w-px bg-border';

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5">
          {/* Undo / Redo */}
          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className={btnBase}
            title="撤銷"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className={btnBase}
            title="重做"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>

          <div className={divider} />

          {/* Heading */}
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`${btnBase} ${editor.isActive('heading', { level: 3 }) ? btnActive : ''}`}
            title="標題"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </button>

          <div className={divider} />

          {/* Bold / Italic / Underline */}
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`${btnBase} ${editor.isActive('bold') ? btnActive : ''}`}
            title="粗體"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`${btnBase} ${editor.isActive('italic') ? btnActive : ''}`}
            title="斜體"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`${btnBase} ${editor.isActive('underline') ? btnActive : ''}`}
            title="下劃線"
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertBlankUnderline(editor)}
            className={`${btnBase}`}
            title="插入空白下劃線（填空線）"
          >
            <MinusSquare className="h-3.5 w-3.5" />
          </button>

          <div className={divider} />

          {/* Lists */}
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`${btnBase} ${editor.isActive('bulletList') ? btnActive : ''}`}
            title="無序列表"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`${btnBase} ${editor.isActive('orderedList') ? btnActive : ''}`}
            title="有序列表"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </button>

          <div className={divider} />

          {/* Align */}
          <button
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={`${btnBase} ${editor.isActive({ textAlign: 'left' }) ? btnActive : ''}`}
            title="靠左"
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={`${btnBase} ${editor.isActive({ textAlign: 'center' }) ? btnActive : ''}`}
            title="置中"
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <EditorContent
        editor={editor}
        className="terms-rich-editor min-h-[280px] max-h-[480px] overflow-y-auto px-3 py-2.5 font-body text-xs leading-relaxed text-foreground focus-within:outline-none"
      />
    </div>
  );
}
