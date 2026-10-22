/** Validate the splitter contract without exposing URLs, credentials, or response bodies. */
export async function wakePdfSplitter(url, secret, fetcher = fetch) {
  let res;
  try {
    res = await fetcher(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'x-pdf-split-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'process-jobs' }),
    });
  } catch {
    throw new Error('pdf_split_network_error');
  }
  try {
    if (!res.ok) throw new Error(`pdf_split_http_${res.status}`);
    if (!res.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new Error('pdf_split_expected_json');
    }
    let result;
    try { result = await res.json(); } catch { throw new Error('pdf_split_invalid_json'); }
    if (!result || ![0, 1].includes(result.processed) || result.failed === true) {
      throw new Error('pdf_split_failed_response');
    }
    return result;
  } finally {
    if (!res.bodyUsed) await res.body?.cancel();
  }
}
