export type InsertFrontmatterResult =
  | {
      status: "inserted";
      content: string;
    }
  | {
      status: "replaceRequired";
      content: string;
      message: string;
    }
  | {
      status: "blocked";
      message: string;
    }
  | {
      status: "noChange";
      message: string;
    };

/**
 * Redmineチケット用のFrontmatterを生成・挿入・置換確認を行うサービス関数。
 * VS Code UIに依存しないため、純粋なユニットテストが可能です。
 */
export const buildRedmineTicketFrontmatterContent = (input: {
  content: string;
  projectId?: number;
  tracker?: string;
  priority?: string;
  status?: string;
}): InsertFrontmatterResult => {
  const lines = input.content.split(/\r?\n/);
  const firstLine = lines[0]?.trim();

  let hasFrontmatter = false;
  let blockEndIndex = -1;

  if (firstLine === "---") {
    blockEndIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (blockEndIndex !== -1) {
      hasFrontmatter = true;
    }
  }

  let bodyContent = input.content;
  let frontmatterText = "";

  if (hasFrontmatter) {
    frontmatterText = lines.slice(1, blockEndIndex).join("\n");
    bodyContent = lines.slice(blockEndIndex + 1).join("\n");
  }

  // Redmine用のFrontmatterか判定する
  const hasNewTicketMode = /mode:\s*new-ticket/.test(frontmatterText);
  const hasTicketUpdateMode = /mode:\s*ticket-update/.test(frontmatterText);
  const hasIssueKey = /^\s*issue\s*:/m.test(frontmatterText);
  const hasIssueIdKey = /^\s*issue_id\s*:/m.test(frontmatterText);
  const isRedmine = hasFrontmatter && (hasNewTicketMode || hasTicketUpdateMode || hasIssueKey || hasIssueIdKey);

  // Redmine用Frontmatterの場合、issue_idがあるか抽出する
  let issueId: string | undefined;
  if (isRedmine && hasIssueIdKey) {
    const issueIdMatch = frontmatterText.match(/^\s*issue_id\s*:\s*([^\s]+)/m);
    if (issueIdMatch) {
      issueId = issueIdMatch[1];
    }
  }

  // プロジェクトIDや各デフォルト値の解決
  const resolvedProjectId = input.projectId !== undefined ? String(input.projectId) : "";
  const tracker = input.tracker ?? "Task";
  const priority = input.priority ?? "Normal";
  const status = input.status ?? "New";

  const newFrontmatter = `---
mode: new-ticket
project_id: ${resolvedProjectId}
issue:
  tracker:   ${tracker}
  priority:  ${priority}
  status:    ${status}
  assignee:
  assignee_id:
  start_date:
  due_date:
---`;

  // 本文中の最初のH1見出しの有無を調べる
  const bodyLines = bodyContent.split(/\r?\n/);
  const hasH1 = bodyLines.some(line => /^\s*#\s+[^#]/.test(line));

  let finalBody = bodyContent;
  if (!hasH1) {
    const trimmedBody = bodyContent.trim();
    if (trimmedBody.length === 0) {
      finalBody = "# Ticket subject\n";
    } else {
      // 本文の先頭の不要な改行を取り除き、H1プレースホルダーを挿入
      finalBody = `# Ticket subject\n\n${bodyContent.replace(/^\s*\n/, "")}`;
    }
  }

  const generatedContent = `${newFrontmatter}\n\n${finalBody}`;

  if (!hasFrontmatter) {
    return {
      status: "inserted",
      content: generatedContent,
    };
  }

  if (isRedmine) {
    if (issueId !== undefined) {
      return {
        status: "blocked",
        message: `This file is already linked to Redmine ticket #${issueId}.`,
      };
    } else {
      return {
        status: "replaceRequired",
        content: generatedContent,
        message: "Replace existing Redmine ticket frontmatter?",
      };
    }
  }

  // 非Redmine用Frontmatter
  return {
    status: "blocked",
    message: "This file already has non-Redmine frontmatter. Insert Redmine frontmatter manually to avoid overwriting existing metadata.",
  };
};
