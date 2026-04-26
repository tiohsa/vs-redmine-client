const suppressedUris = new Set<string>();

export const suppressSaveSync = (uriString: string): void => {
  suppressedUris.add(uriString);
};

export const releaseSaveSync = (uriString: string): void => {
  suppressedUris.delete(uriString);
};

export const isSaveSyncSuppressed = (uriString: string): boolean =>
  suppressedUris.has(uriString);
