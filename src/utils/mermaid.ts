export const convertMermaidBlocks = (markdown: string): string =>
  markdown.replace(/```mermaid\s*([\s\S]*?)```/g, (_match, content: string) => {
    const normalized = content.replace(/\s*$/, "");
    return `{{mermaid\n${normalized}\n}}`;
  });
