export interface TicketEditorContent {
  subject: string;
  description: string;
}

const extractSubject = (lines: string[]): { subject: string; startIndex: number } => {
  const headingIndex = lines.findIndex((line) => line.trim().startsWith("# "));
  if (headingIndex >= 0) {
    const heading = lines[headingIndex].trim().replace(/^#\s+/, "");
    return { subject: heading, startIndex: headingIndex + 1 };
  }

  return { subject: "", startIndex: 0 };
};

export const parseTicketEditorContent = (text: string): TicketEditorContent => {
  const lines = text.split(/\r?\n/);
  const { subject, startIndex } = extractSubject(lines);
  const description = lines.slice(startIndex).join("\n").trim();

  return {
    subject: subject.trim(),
    description,
  };
};

export const buildTicketEditorContent = (content: TicketEditorContent): string => {
  const description = content.description?.trim() ?? "";
  return `# ${content.subject}\n\n${description}`.trim();
};
