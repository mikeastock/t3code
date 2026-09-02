import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  getCachedMermaidSvg,
  loadMermaid,
  renderMermaidSvg,
  type MermaidTheme,
} from "../lib/mermaidRenderer";
import { serializeMarkdownCodeFence } from "../markdown-clipboard";

export function isMermaidFenceLanguage(language: string): boolean {
  const normalized = language.toLowerCase();
  return normalized === "mermaid" || normalized === "mmd";
}

export function prefetchMermaid(): void {
  void loadMermaid();
}

export function MermaidDiagram({
  code,
  theme,
  fenceTitle,
  fallback,
}: {
  code: string;
  theme: MermaidTheme;
  fenceTitle: string | null;
  fallback: ReactNode;
}) {
  const diagramRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState(() => getCachedMermaidSvg(code, theme));

  useEffect(() => {
    let active = true;
    const cached = getCachedMermaidSvg(code, theme);
    if (cached) setSvg(cached);
    void renderMermaidSvg(code, theme).then(
      (nextSvg) => {
        if (active) setSvg(nextSvg);
      },
      () => {
        if (active) setSvg(null);
      },
    );
    return () => {
      active = false;
    };
  }, [code, theme]);

  useLayoutEffect(() => {
    const rendered = diagramRef.current?.querySelector("svg");
    const width = rendered?.viewBox.baseVal.width ?? 0;
    if (rendered && Number.isFinite(width) && width > 0) {
      rendered.style.width = `${Math.ceil(width)}px`;
      rendered.style.maxWidth = "none";
    }
  }, [svg]);

  if (!svg) return fallback;

  return (
    <figure
      className="chat-markdown-mermaid my-[0.65rem] overflow-hidden rounded-[var(--radius)] border border-border/70 bg-secondary dark:border-transparent dark:bg-input/32"
      data-markdown-copy={serializeMarkdownCodeFence(code, "mermaid")}
    >
      {fenceTitle ? (
        <figcaption className="chat-markdown-mermaid-title border-b border-border/70 px-3 py-2 [font-family:var(--font-mono,ui-monospace,SFMono-Regular,monospace)] [font-size:0.6875rem] text-muted-foreground dark:border-transparent">
          {fenceTitle}
        </figcaption>
      ) : null}
      <div
        ref={diagramRef}
        className="chat-markdown-mermaid-canvas overflow-x-auto p-4"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </figure>
  );
}
