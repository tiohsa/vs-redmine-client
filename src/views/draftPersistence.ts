import * as vscode from "vscode";
import { TicketDraftState } from "./ticketSaveTypes";

const STORAGE_KEY_PREFIX = "redmine.draft.ticket.";

/** 旧ステータス値を新ステータスに移行するマッピング */
const LEGACY_STATUS_MAP: Record<string, TicketDraftState["status"]> = {
  clean: "Synced",
  dirty: "Dirty",
  conflict: "Conflict",
};

const migrateLegacyStatus = (status: string): TicketDraftState["status"] =>
  (LEGACY_STATUS_MAP[status] ?? status) as TicketDraftState["status"];

export interface DraftStorage {
  loadAll(): Map<number, TicketDraftState>;
  save(ticketId: number, draft: TicketDraftState): void;
  delete(ticketId: number): void;
  clear(): void;
}

export const createGlobalStateDraftStorage = (state: vscode.Memento): DraftStorage => ({
  loadAll(): Map<number, TicketDraftState> {
    const result = new Map<number, TicketDraftState>();
    const keys = state.keys().filter((k) => k.startsWith(STORAGE_KEY_PREFIX));
    for (const key of keys) {
      const raw = state.get<TicketDraftState>(key);
      if (!raw) { continue; }
      const migrated: TicketDraftState = {
        ...raw,
        status: migrateLegacyStatus(raw.status as string),
      };
      result.set(migrated.ticketId, migrated);
    }
    return result;
  },
  save(ticketId: number, draft: TicketDraftState): void {
    state.update(`${STORAGE_KEY_PREFIX}${ticketId}`, draft);
  },
  delete(ticketId: number): void {
    state.update(`${STORAGE_KEY_PREFIX}${ticketId}`, undefined);
  },
  clear(): void {
    const keys = state.keys().filter((k) => k.startsWith(STORAGE_KEY_PREFIX));
    for (const key of keys) {
      state.update(key, undefined);
    }
  },
});

export const createInMemoryDraftStorage = (): DraftStorage => {
  const map = new Map<number, TicketDraftState>();
  return {
    loadAll(): Map<number, TicketDraftState> {
      return new Map(map);
    },
    save(ticketId: number, draft: TicketDraftState): void {
      map.set(ticketId, { ...draft });
    },
    delete(ticketId: number): void {
      map.delete(ticketId);
    },
    clear(): void {
      map.clear();
    },
  };
};
