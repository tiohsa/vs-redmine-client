export type MarkdownImageLink = {
  path: string;
  range: { start: number; end: number };
};

export type MarkdownImageReplacement = {
  range: { start: number; end: number };
  value: string;
};

const IMAGE_LINK_REGEX = /!\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)/g;

export const extractMarkdownImageLinks = (content: string): MarkdownImageLink[] => {
  const links: MarkdownImageLink[] = [];
  let match: RegExpExecArray | null;

  while ((match = IMAGE_LINK_REGEX.exec(content))) {
    const path = match[1];
    const pathIndex = match[0].indexOf(path);
    if (pathIndex < 0 || match.index === undefined) {
      continue;
    }
    const start = match.index + pathIndex;
    const end = start + path.length;
    links.push({ path, range: { start, end } });
  }

  return links;
};

export const applyMarkdownImageReplacements = (
  content: string,
  replacements: MarkdownImageReplacement[],
): string => {
  if (replacements.length === 0) {
    return content;
  }

  const sorted = [...replacements].sort((a, b) => b.range.start - a.range.start);
  let next = content;
  sorted.forEach((replacement) => {
    next =
      next.slice(0, replacement.range.start) +
      replacement.value +
      next.slice(replacement.range.end);
  });

  return next;
};

export const isExternalMarkdownImagePath = (value: string): boolean => {
  if (value.startsWith("data:")) {
    return true;
  }
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
};
