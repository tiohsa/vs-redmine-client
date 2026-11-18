export function scheduleTask(task: () => void, delayMs: number): () => void {
  const handle = setTimeout(task, delayMs);
  return () => clearTimeout(handle);
}
