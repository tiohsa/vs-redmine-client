export type ThreeWayMergeResult = { content: string; hasConflicts: boolean };

type Change = { start: number; end: number; lines: string[] };

const CONFLICT_START = "<<<<<<< LOCAL";
const CONFLICT_SEPARATOR = "=======";
const CONFLICT_END = ">>>>>>> REMOTE";

const splitLines = (content: string): string[] => content.split("\n");

const changesFrom = (base: string[], variant: string[]): Change[] => {
  const width = variant.length + 1;
  const cells = (base.length + 1) * width;
  if (cells > 1_000_000) { return [{ start: 0, end: base.length, lines: variant }]; }
  const lcs = new Uint32Array(cells);
  const at = (baseIndex: number, variantIndex: number): number => baseIndex * width + variantIndex;
  for (let baseIndex = base.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let variantIndex = variant.length - 1; variantIndex >= 0; variantIndex -= 1) {
      lcs[at(baseIndex, variantIndex)] = base[baseIndex] === variant[variantIndex]
        ? lcs[at(baseIndex + 1, variantIndex + 1)] + 1
        : Math.max(lcs[at(baseIndex + 1, variantIndex)], lcs[at(baseIndex, variantIndex + 1)]);
    }
  }
  const changes: Change[] = [];
  let baseIndex = 0;
  let variantIndex = 0;
  while (baseIndex < base.length || variantIndex < variant.length) {
    if (base[baseIndex] === variant[variantIndex]) { baseIndex += 1; variantIndex += 1; continue; }
    const start = baseIndex;
    const lines: string[] = [];
    while (baseIndex < base.length || variantIndex < variant.length) {
      if (base[baseIndex] === variant[variantIndex]) { break; }
      if (variantIndex < variant.length && (baseIndex === base.length ||
        lcs[at(baseIndex, variantIndex + 1)] >= lcs[at(baseIndex + 1, variantIndex)])) {
        lines.push(variant[variantIndex++]);
      } else { baseIndex += 1; }
    }
    changes.push({ start, end: baseIndex, lines });
  }
  return changes;
};

const renderChanges = (base: string[], start: number, end: number, changes: Change[]): string[] => {
  const result: string[] = [];
  let cursor = start;
  for (const change of changes) {
    result.push(...base.slice(cursor, change.start), ...change.lines);
    cursor = change.end;
  }
  return [...result, ...base.slice(cursor, end)];
};

export const containsConflictMarkers = (content: string): boolean =>
  content.includes(CONFLICT_START) || content.includes(CONFLICT_SEPARATOR) || content.includes(CONFLICT_END);

export const mergeThreeWay = (baseContent: string, localContent: string, remoteContent: string): ThreeWayMergeResult => {
  if (localContent === remoteContent) { return { content: localContent, hasConflicts: false }; }
  if (localContent === baseContent) { return { content: remoteContent, hasConflicts: false }; }
  if (remoteContent === baseContent) { return { content: localContent, hasConflicts: false }; }
  const base = splitLines(baseContent);
  const localChanges = changesFrom(base, splitLines(localContent));
  const remoteChanges = changesFrom(base, splitLines(remoteContent));
  const result: string[] = [];
  let localIndex = 0;
  let remoteIndex = 0;
  let position = 0;
  let hasConflicts = false;
  while (position < base.length || localIndex < localChanges.length || remoteIndex < remoteChanges.length) {
    const nextStart = Math.min(localChanges[localIndex]?.start ?? Infinity, remoteChanges[remoteIndex]?.start ?? Infinity);
    if (nextStart === Infinity) { result.push(...base.slice(position)); break; }
    result.push(...base.slice(position, nextStart));
    let end = nextStart;
    const localGroup: Change[] = [];
    const remoteGroup: Change[] = [];
    let expanded = true;
    while (expanded) {
      expanded = false;
      while (localChanges[localIndex] && localChanges[localIndex].start <= end) {
        const change = localChanges[localIndex++]; localGroup.push(change); end = Math.max(end, change.end); expanded = true;
      }
      while (remoteChanges[remoteIndex] && remoteChanges[remoteIndex].start <= end) {
        const change = remoteChanges[remoteIndex++]; remoteGroup.push(change); end = Math.max(end, change.end); expanded = true;
      }
    }
    const local = localGroup.length ? renderChanges(base, nextStart, end, localGroup) : base.slice(nextStart, end);
    const remote = remoteGroup.length ? renderChanges(base, nextStart, end, remoteGroup) : base.slice(nextStart, end);
    if (!localGroup.length) { result.push(...remote); }
    else if (!remoteGroup.length || local.join("\n") === remote.join("\n")) { result.push(...local); }
    else { result.push(CONFLICT_START, ...local, CONFLICT_SEPARATOR, ...remote, CONFLICT_END); hasConflicts = true; }
    position = end;
  }
  return { content: result.join("\n"), hasConflicts };
};
