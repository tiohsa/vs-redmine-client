import * as vscode from "vscode";
import { TicketDraftState } from "./ticketSaveTypes";

const STORAGE_KEY_PREFIX = "redmine.draft.ticket.";
const storagePrefixForScope = (scope?: string): string =>
  scope ? `${STORAGE_KEY_PREFIX}${encodeURIComponent(scope)}.` : STORAGE_KEY_PREFIX;
const legacyClaims = new WeakSet<object>();

/** 旧ステータス値を新ステータスに移行するマッピング */
const LEGACY_STATUS_MAP: Record<string, TicketDraftState["status"]> = {
  clean: "Synced",
  dirty: "Dirty",
  conflict: "Conflict",
  // "Syncing" は同期中の一時ステータス。永続化されていた場合は同期が中断されたことを意味するため "Dirty" にリセット
  Syncing: "Dirty",
};

const migrateLegacyStatus = (status: string): TicketDraftState["status"] =>
  (LEGACY_STATUS_MAP[status] ?? status) as TicketDraftState["status"];

export interface DraftStorage {
  loadAll(): Map<number, TicketDraftState>;
  save(ticketId: number, draft: TicketDraftState): void;
  delete(ticketId: number): void;
  clear(): void;
}

export const createGlobalStateDraftStorage = (
  state: vscode.Memento,
  scope?: string,
): DraftStorage => {
  const prefix = storagePrefixForScope(scope);
  const legacyKeys = scope
    ? state.keys().filter((key) => key.startsWith(STORAGE_KEY_PREFIX) && /^\d+$/.test(key.slice(STORAGE_KEY_PREFIX.length)))
    : [];
  const useLegacyFallback = Boolean(
    scope &&
    !state.keys().some((key) => key.startsWith(prefix)) &&
    legacyKeys.length > 0 &&
    !legacyClaims.has(state),
  );
  if (useLegacyFallback) {
    legacyClaims.add(state);
    for (const key of legacyKeys) {
      const value = state.get<TicketDraftState>(key);
      if (value) {
        void state.update(`${prefix}${value.ticketId}`, value);
      }
      void state.update(key, undefined);
    }
  }
  return {
    loadAll(): Map<number, TicketDraftState> {
      const result = new Map<number, TicketDraftState>();
      const scopedKeys = state.keys().filter((k) => k.startsWith(prefix));
      // Memento.update の完了前でも、現在の接続先へ割り当てた旧形式データを返す。
      const keys = scopedKeys.length > 0 ? scopedKeys : useLegacyFallback ? legacyKeys : [];
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
      state.update(`${prefix}${ticketId}`, draft);
    },
    delete(ticketId: number): void {
      state.update(`${prefix}${ticketId}`, undefined);
    },
    clear(): void {
      const keys = state.keys().filter((k) => k.startsWith(prefix));
      for (const key of keys) {
        state.update(key, undefined);
      }
    },
  };
};

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
