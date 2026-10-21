function readableInvokeMessage(body: { error?: string; message?: string } | null | undefined): string | null {
  const message = body?.message?.trim();
  if (message) return message;
  const code = body?.error?.trim();
  return code || null;
}

/** Extract human-readable error from supabase.functions.invoke() failures. */
export async function parseInvokeError(
  error: unknown,
  data?: { error?: string; message?: string } | null,
): Promise<string> {
  const fromData = readableInvokeMessage(data);
  if (fromData) return fromData;
  if (!error || typeof error !== 'object') return '未知錯誤';
  const err = error as {
    message?: string;
    name?: string;
    context?: { json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  if (err.name === 'FunctionsHttpError' && err.context) {
    try {
      if (typeof err.context.json === 'function') {
        const body = await err.context.json() as { error?: string; message?: string };
        const parsed = readableInvokeMessage(body);
        if (parsed) return parsed;
      } else if (typeof err.context.text === 'function') {
        const raw = await err.context.text();
        try {
          const body = JSON.parse(raw) as { error?: string; message?: string };
          const parsed = readableInvokeMessage(body);
          if (parsed) return parsed;
        } catch {
          return raw.slice(0, 200);
        }
      }
    } catch { /* ignore parse errors */ }
  }
  return err.message || '未知錯誤';
}
