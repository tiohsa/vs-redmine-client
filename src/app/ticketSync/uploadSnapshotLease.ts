import type { UploadRequestSnapshot } from "../syncEffects";
import type { FrozenUpload } from "./ports";

const frozenUploadLeases = new WeakMap<UploadRequestSnapshot, FrozenUpload>();

export const retainUploadSnapshotLease = (snapshot: UploadRequestSnapshot, lease: FrozenUpload): void => {
  frozenUploadLeases.set(snapshot, lease);
};

export const persistUploadSnapshot = async <T>(snapshot: UploadRequestSnapshot, persist: () => Promise<T>): Promise<T> => {
  try {
    return await persist();
  } finally {
    frozenUploadLeases.get(snapshot)?.release();
    frozenUploadLeases.delete(snapshot);
  }
};
