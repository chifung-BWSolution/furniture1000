/** Extract human-readable error from supabase.functions.invoke() failures. */
export async function parseInvokeError(
  error: unknown,
  data?: { error?: string } | null,
): Promise<string> {
  if (data?.error) return data.error;
  if (!error || typeof error !== 'object') return '未知錯誤';
  const err = error as {
    message?: string;
    name?: string;
    context?: { json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  if (err.name === 'FunctionsHttpError' && err.context) {
    try {
      if (typeof err.context.json === 'function') {
        const body = await err.context.json() as { error?: string };
        if (body?.error) return body.error;
      } else if (typeof err.context.text === 'function') {
        const raw = await err.context.text();
        try {
          const body = JSON.parse(raw) as { error?: string };
          if (body?.error) return body.error;
        } catch {
          return raw.slice(0, 200);
        }
      }
    } catch { /* ignore parse errors */ }
  }
  return err.message || '未知錯誤';
}
