import type { TicketEditorContent } from "../../views/ticketEditorContent";
import type { IssueMetadata } from "../../views/ticketMetadataTypes";

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const chooseValue = <T>(base: T, canonical: T, latest: T): T => {
  if (sameValue(latest, base)) {
    return canonical;
  }
  return latest;
};

const rebaseMetadata = (
  base: IssueMetadata,
  canonical: IssueMetadata,
  latest: IssueMetadata,
): IssueMetadata => {
  const result = { ...canonical } as Record<string, unknown>;
  const baseRecord = base as unknown as Record<string, unknown>;
  const canonicalRecord = canonical as unknown as Record<string, unknown>;
  const latestRecord = latest as unknown as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(baseRecord),
    ...Object.keys(canonicalRecord),
    ...Object.keys(latestRecord),
  ]);
  for (const key of keys) {
    const selected = chooseValue(
      baseRecord[key],
      canonicalRecord[key],
      latestRecord[key],
    );
    if (selected === undefined) {
      delete result[key];
    } else {
      result[key] = selected;
    }
  }
  return result as unknown as IssueMetadata;
};

/**
 * Applies remote canonical values for fields untouched after the active revision
 * while preserving every local edit made after that revision started.
 */
export const rebaseTicketEditorContent = (
  base: TicketEditorContent,
  canonical: TicketEditorContent,
  latest: TicketEditorContent,
): TicketEditorContent => ({
  subject: chooseValue(base.subject, canonical.subject, latest.subject),
  description: chooseValue(base.description, canonical.description, latest.description),
  metadata: rebaseMetadata(base.metadata, canonical.metadata, latest.metadata),
  layout: chooseValue(base.layout, canonical.layout, latest.layout),
  metadataBlock: chooseValue(
    base.metadataBlock,
    canonical.metadataBlock,
    latest.metadataBlock,
  ),
  controlFields: chooseValue(
    base.controlFields,
    canonical.controlFields,
    latest.controlFields,
  ),
});
