import * as fs from "fs";
import * as path from "path";
import { TicketEditorContent, parseTicketEditorContent } from "../views/ticketEditorContent";
import { DEFAULT_TEMPLATE_FILE } from "./templateConstants";
import { isProjectNameMatch } from "./templateMatcher";

export type TemplateContentResolution = {
  content?: TicketEditorContent;
  errorMessage?: string;
};

export type ProjectTemplateResolution = {
  content?: TicketEditorContent;
  errorMessage?: string;
  usedTemplate: boolean;
  usedDefault: boolean;
};

export const resolveNewTicketTemplateContent = (input: {
  templatePath: string;
  readFileSync?: (targetPath: string) => string;
  existsSync?: (targetPath: string) => boolean;
}): TemplateContentResolution => {
  const templatePath = input.templatePath.trim();
  if (!path.isAbsolute(templatePath)) {
    return { errorMessage: "Template file path must be an absolute path." };
  }

  const exists = input.existsSync ?? fs.existsSync;
  if (!exists(templatePath)) {
    return { errorMessage: "Template file does not exist." };
  }

  const readFile =
    input.readFileSync ?? ((targetPath: string) => fs.readFileSync(targetPath, "utf8"));
  let raw: string;
  try {
    raw = readFile(templatePath);
  } catch {
    return { errorMessage: "Template file could not be read." };
  }

  if (raw.trim().length === 0) {
    return { errorMessage: "Template file is empty." };
  }

  try {
    return { content: parseTicketEditorContent(raw, { allowMissingSubject: true }) };
  } catch {
    return { errorMessage: "Template content is invalid." };
  }
};

export const resolveProjectTemplateContent = (options: {
  templatesDir: string;
  projectName?: string;
  defaultTemplateFileName?: string;
  readFileSync?: (targetPath: string) => string;
  existsSync?: (targetPath: string) => boolean;
  readdirSync?: (targetPath: string) => string[];
  statSync?: (targetPath: string) => fs.Stats;
}): ProjectTemplateResolution => {
  const exists = options.existsSync ?? fs.existsSync;
  const readDir = options.readdirSync ?? fs.readdirSync;
  const defaultFileName = options.defaultTemplateFileName ?? DEFAULT_TEMPLATE_FILE;

  let fileNames: string[];
  try {
    const entries = readDir(options.templatesDir);
    if (!options.statSync) {
      fileNames = entries;
    } else {
      fileNames = entries.filter((entry) => {
        const candidate = path.join(options.templatesDir, entry);
        try {
          return options.statSync?.(candidate).isFile();
        } catch {
          return false;
        }
      });
    }
  } catch {
    return {
      errorMessage: "Template directory could not be read.",
      usedTemplate: false,
      usedDefault: false,
    };
  }

  const projectName = options.projectName?.trim() ?? "";
  const projectMatches =
    projectName.length > 0
      ? fileNames.filter(
          (entry) =>
            entry.toLowerCase() !== defaultFileName.toLowerCase() &&
            isProjectNameMatch(entry, projectName),
        )
      : [];

  const resolveFromPath = (targetPath: string): TemplateContentResolution =>
    resolveNewTicketTemplateContent({
      templatePath: targetPath,
      readFileSync: options.readFileSync,
      existsSync: exists,
    });

  if (projectMatches.length > 1) {
    const defaultPath = path.join(options.templatesDir, defaultFileName);
    const fallback = resolveFromPath(defaultPath);
    if (fallback.content) {
      return {
        content: fallback.content,
        usedTemplate: false,
        usedDefault: true,
        errorMessage: "Multiple project templates matched.",
      };
    }
    return {
      errorMessage: fallback.errorMessage ?? "Multiple project templates matched.",
      usedTemplate: false,
      usedDefault: false,
    };
  }

  if (projectMatches.length === 1) {
    const matchPath = path.join(options.templatesDir, projectMatches[0]);
    const match = resolveFromPath(matchPath);
    if (match.content) {
      return { content: match.content, usedTemplate: true, usedDefault: false };
    }
    return { errorMessage: match.errorMessage, usedTemplate: false, usedDefault: false };
  }

  const defaultPath = path.join(options.templatesDir, defaultFileName);
  if (!exists(defaultPath)) {
    return {
      errorMessage: "Default template file does not exist.",
      usedTemplate: false,
      usedDefault: false,
    };
  }

  const fallback = resolveFromPath(defaultPath);
  if (fallback.content) {
    return { content: fallback.content, usedTemplate: false, usedDefault: true };
  }

  return { errorMessage: fallback.errorMessage, usedTemplate: false, usedDefault: false };
};
