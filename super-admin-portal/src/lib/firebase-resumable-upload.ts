export const DEFAULT_APK_CHUNK_SIZE = 8 * 1024 * 1024;
export const MAX_CHUNK_RETRIES = 3;

type UploadProgressHandler = (uploadedBytes: number, totalBytes: number) => void;

type ResumableUploadOptions = {
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: UploadProgressHandler;
};

type XhrResult = {
  status: number;
  range: string | null;
};

function createAbortError() {
  return new DOMException("Upload cancelled", "AbortError");
}

function waitForRetry(attempt: number, signal?: AbortSignal) {
  const delay = Math.min(500 * 2 ** attempt, 4000);
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const onAbort = () => {
      window.clearTimeout(timeoutId);
      reject(createAbortError());
    };
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseUploadedOffset(range: string | null, fallback: number) {
  const match = range?.match(/bytes=0-(\d+)/i);
  return match ? Number(match[1]) + 1 : fallback;
}

function sendUploadRequest({
  uploadUrl,
  body,
  contentRange,
  contentType,
  signal,
  onChunkProgress
}: {
  uploadUrl: string;
  body: Blob | null;
  contentRange: string;
  contentType?: string;
  signal?: AbortSignal;
  onChunkProgress?: (loaded: number) => void;
}) {
  return new Promise<XhrResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Range", contentRange);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onChunkProgress?.(event.loaded);
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error("Firebase upload network error"));
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", abort);
      reject(createAbortError());
    };
    xhr.onload = () => {
      signal?.removeEventListener("abort", abort);
      resolve({
        status: xhr.status,
        range: xhr.getResponseHeader("Range")
      });
    };
    xhr.send(body);
  });
}

async function queryUploadedOffset(uploadUrl: string, totalBytes: number, signal?: AbortSignal) {
  const result = await sendUploadRequest({
    uploadUrl,
    body: null,
    contentRange: `bytes */${totalBytes}`,
    signal
  });

  if (result.status === 200 || result.status === 201) return totalBytes;
  if (result.status === 308) return parseUploadedOffset(result.range, 0);
  throw new Error(`Unable to resume Firebase upload (HTTP ${result.status})`);
}

function isTransientStatus(status: number) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export async function uploadFileToFirebaseResumable(
  file: File,
  uploadUrl: string,
  {
    chunkSize = DEFAULT_APK_CHUNK_SIZE,
    signal,
    onProgress
  }: ResumableUploadOptions = {}
) {
  let offset = 0;
  onProgress?.(offset, file.size);

  while (offset < file.size) {
    if (signal?.aborted) throw createAbortError();

    const chunkStart = offset;
    const chunkEndExclusive = Math.min(offset + chunkSize, file.size);
    const chunk = file.slice(offset, chunkEndExclusive);
    let attempt = 0;

    while (attempt <= MAX_CHUNK_RETRIES) {
      try {
        const result = await sendUploadRequest({
          uploadUrl,
          body: chunk,
          contentRange: `bytes ${chunkStart}-${chunkEndExclusive - 1}/${file.size}`,
          contentType: file.type || "application/vnd.android.package-archive",
          signal,
          onChunkProgress: (loaded) => onProgress?.(Math.min(chunkStart + loaded, file.size), file.size)
        });

        if (result.status === 200 || result.status === 201) {
          offset = file.size;
          onProgress?.(offset, file.size);
          break;
        }

        if (result.status === 308) {
          offset = parseUploadedOffset(result.range, chunkEndExclusive);
          onProgress?.(offset, file.size);
          break;
        }

        if (!isTransientStatus(result.status)) {
          throw new Error(`Firebase rejected the APK upload (HTTP ${result.status})`);
        }
        throw new Error(`Temporary Firebase upload failure (HTTP ${result.status})`);
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          throw createAbortError();
        }
        if (error instanceof Error && error.message.startsWith("Firebase rejected")) throw error;
        if (attempt >= MAX_CHUNK_RETRIES) throw error;

        await waitForRetry(attempt, signal);
        attempt += 1;
        try {
          offset = await queryUploadedOffset(uploadUrl, file.size, signal);
          if (offset !== chunkStart) {
            onProgress?.(offset, file.size);
            break;
          }
        } catch (statusError) {
          if (attempt >= MAX_CHUNK_RETRIES) throw statusError;
        }
      }
    }
  }
}
