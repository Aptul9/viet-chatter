// Small shared utilities. Keep this file minimal — single-purpose helpers only.

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
