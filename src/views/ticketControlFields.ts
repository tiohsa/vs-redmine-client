import { FrontmatterControlFields } from "./ticketMetadataControlFields";

/**
 * 新規チケットドラフトの制御フィールドを構築する。
 * issue_id は空（null）、project_id は指定があれば含める。
 */
export const withNewTicketControlFields = (
  projectId?: number,
): FrontmatterControlFields => ({
  mode: "new-ticket",
  ...(projectId !== undefined ? { project_id: projectId } : {}),
  issue_id: null,
});

/**
 * Redmine 作成成功後の制御フィールドを構築する。
 * draft_id を削除し、mode を ticket-update に変更、issue_id と last_synced_at を設定する。
 * projectId が指定された場合はフロントマターに上書き設定する（ダッシュボード選択値を優先）。
 */
export const withRegisteredTicketControlFields = (
  existing: FrontmatterControlFields,
  createdId: number,
  projectId?: number,
): FrontmatterControlFields => {
  const { draft_id: _removed, ...rest } = existing;
  return {
    ...rest,
    mode: "ticket-update",
    issue_id: createdId,
    ...(projectId !== undefined ? { project_id: projectId } : {}),
    last_synced_at: new Date().toISOString(),
  };
};
