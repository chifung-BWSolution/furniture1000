import { useState } from 'react';
import { cn } from '@/lib/utils';
import { MessageSquare, Send, AtSign, ChevronDown, ChevronUp } from 'lucide-react';
import type { ProductDiscussion } from '@/types/solutions';

function fmt(d: string) {
  const x = new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

interface DiscussionPanelProps {
  discussions: ProductDiscussion[];
  onSend: (body: string, mentions: string[]) => Promise<void>;
  defaultOpen?: boolean;
  title?: string;
}

export function DiscussionPanel({
  discussions,
  onSend,
  defaultOpen = false,
  title = '討論區',
}: DiscussionPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    const mentions = Array.from(body.matchAll(/@(\S+)/g)).map((m) => m[1]);
    setSending(true);
    try {
      await onSend(body, mentions);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const insertMention = (name: string) => {
    setDraft((prev) => (prev ? `${prev} @${name} ` : `@${name} `));
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-t border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40"
      >
        <span className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          {title} {discussions.length > 0 && `(${discussions.length})`}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="border-t border-border/60 p-3">
          <div className="space-y-3">
            {discussions.map((d) => (
              <div key={d.id} className="flex gap-2">
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    d.authorRole === 'client' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {d.author.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs">
                    <span className="font-semibold text-foreground">{d.author}</span>
                    {' '}
                    <span className="font-mono-data text-xs text-muted-foreground/60">{fmt(d.createdAt)}</span>
                  </p>
                  <p className="font-body text-[12.5px] text-muted-foreground">{d.body}</p>
                </div>
              </div>
            ))}
            {discussions.length === 0 && (
              <p className="text-center text-xs text-muted-foreground/60">
                尚無討論，留言即時通知 PM / 設計師
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => insertMention('PM')}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-primary"
                title="提及 PM"
              >
                <AtSign className="inline h-3 w-3" /> PM
              </button>
              <button
                type="button"
                onClick={() => insertMention('設計師')}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-primary"
                title="提及設計師"
              >
                <AtSign className="inline h-3 w-3" /> 設計師
              </button>
            </div>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSend(); }}
              placeholder="輸入留言，使用 @ 提及 PM / 設計師..."
              className="flex-1 bg-transparent font-body text-[12.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !draft.trim()}
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-3 w-3" /> 送出
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
