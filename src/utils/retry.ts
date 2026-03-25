export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delayMs: number,
  onRetry?: (attempt: number, err: unknown) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      onRetry?.(attempt, err);
      if (attempt < maxAttempts) {
        await sleep(delayMs * Math.pow(2, attempt - 1)); // 2s → 4s
      }
    }
  }
  throw lastErr;
}
