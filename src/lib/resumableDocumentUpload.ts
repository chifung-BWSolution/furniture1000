import { Upload } from 'tus-js-client';

export const DOCUMENT_CHUNK_BYTES = 6 * 1024 * 1024;

export interface DocumentUploadProgress {
  phase: 'preparing' | 'uploading' | 'retrying' | 'splitting' | 'registering' | 'complete';
  uploadedBytes: number;
  totalBytes: number;
}

/** Use the existing Storage TUS API; only the current user's token is forwarded. */
export async function uploadDocumentChunks(options: {
  file: File;
  path: string;
  bucket: string;
  supabaseUrl: string;
  userId: string;
  getToken: () => Promise<string>;
  signal?: AbortSignal;
  onProgress?: (progress: DocumentUploadProgress) => void;
}): Promise<void> {
  options.signal?.throwIfAborted();
  const { file, path, bucket, onProgress } = options;
  const storageUrl = new URL(options.supabaseUrl);
  // Hosted Supabase recommends the direct storage host; keep custom/local hosts intact.
  if (/^[a-z]{20}\.supabase\.co$/.test(storageUrl.hostname)) {
    storageUrl.hostname = storageUrl.hostname.replace('.supabase.co', '.storage.supabase.co');
  }
  storageUrl.pathname = '/storage/v1/upload/resumable';
  let uploadedBytes = 0;
  const report = (phase: DocumentUploadProgress['phase']) => onProgress?.({ phase, uploadedBytes, totalBytes: file.size });
  report('uploading');
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: storageUrl.toString(),
      chunkSize: DOCUMENT_CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      // Do not reuse an upload belonging to another account, project or supplier.
      fingerprint: async () => ['supplier-pdf', options.supabaseUrl, options.userId, bucket, path, file.size].join('|'),
      metadata: { bucketName: bucket, objectName: path, contentType: 'application/pdf', cacheControl: '3600' },
      onBeforeRequest: async request => {
        request.setHeader('authorization', `Bearer ${await options.getToken()}`);
        const transport = request.getUnderlyingObject();
        if (typeof XMLHttpRequest !== 'undefined' && transport instanceof XMLHttpRequest) transport.timeout = 120_000;
      },
      onProgress: bytes => { uploadedBytes = bytes; report('uploading'); },
      onShouldRetry: (error) => {
        const status = error.originalResponse?.getStatus();
        const retry = status == null || status === 0 || status === 409 || status === 423 || status === 429 || status >= 500;
        if (retry) report('retrying');
        return retry;
      },
      onError: error => { cleanup(); reject(error); },
      onSuccess: () => { cleanup(); uploadedBytes = file.size; report('uploading'); resolve(); },
    });
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      void upload.abort().catch(() => {});
      reject(new DOMException('已取消上傳', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    void upload.findPreviousUploads().then(previous => {
      if (options.signal?.aborted) return;
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(error => { cleanup(); reject(error); });
  });
}
