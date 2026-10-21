type EdgeErrorBody = { error?: string; message?: string };

function readableEdgeError(body: EdgeErrorBody | null | undefined): string | undefined {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (message) return message;
  const code = typeof body?.error === 'string' ? body.error.trim() : '';
  return code || undefined;
}

/** Extract human-readable error from supabase.functions.invoke() failures. */
export async function parseInvokeError(
  error: unknown,
  data?: EdgeErrorBody | null,
): Promise<string> {
  if (!error || typeof error !== 'object') return readableEdgeError(data) || '未知錯誤';
  const err = error as {
    message?: string;
    name?: string;
    context?: { json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  if (err.name === 'FunctionsHttpError' && err.context) {
    try {
      if (typeof err.context.json === 'function') {
        const body = await err.context.json() as EdgeErrorBody;
        const text = readableEdgeError(body);
        if (text) return text;
      } else if (typeof err.context.text === 'function') {
        const raw = await err.context.text();
        try {
          const body = JSON.parse(raw) as EdgeErrorBody;
          const text = readableEdgeError(body);
          if (text) return text;
        } catch {
          return raw.slice(0, 500);
        }
      }
    } catch { /* ignore parse errors */ }
  }
  return readableEdgeError(data) || err.message || '未知錯誤';
}
