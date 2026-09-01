import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { serializeMarkdownCodeFence } from "../markdown-clipboard";

type MermaidTheme = "light" | "dark";

type MermaidRenderResult = {
  svg: string;
};

// Mermaid configuration is global, so initialization and rendering must stay paired.
let mermaidRenderQueue = Promise.resolve();

export function isMermaidFenceLanguage(language: string): boolean {
  const normalized = language.toLowerCase();
  return normalized === "mermaid" || normalized === "mmd";
}

export function renderMermaidDiagram(
  id: string,
  code: string,
  theme: MermaidTheme,
  isActive: () => boolean = () => true,
) {
  const render = async () => {
    if (!isActive()) return null;
    const { default: mermaid } = await import("mermaid");
    if (!isActive()) return null;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: theme === "dark" ? "dark" : "default",
    });
    return mermaid.render(id, code);
  };

  const result = mermaidRenderQueue.then(render, render);
  mermaidRenderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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
  const reactId = useId();
  const diagramId = `t3-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const renderSequenceRef = useRef(0);
  const diagramRef = useRef<HTMLDivElement>(null);
  const inputKey = `${theme}\0${code}`;
  const [renderState, setRenderState] = useState<{
    inputKey: string;
    result: MermaidRenderResult;
  } | null>(null);
  const result = renderState?.inputKey === inputKey ? renderState.result : null;

  useEffect(() => {
    let active = true;
    const renderId = `${diagramId}-${renderSequenceRef.current++}`;
    void renderMermaidDiagram(renderId, code, theme, () => active).then(
      (nextResult) => {
        if (active && nextResult) setRenderState({ inputKey, result: nextResult });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [code, diagramId, inputKey, theme]);

  useLayoutEffect(() => {
    const svg = diagramRef.current?.querySelector("svg");
    const width = svg?.viewBox.baseVal.width ?? 0;
    if (svg && Number.isFinite(width) && width > 0) {
      svg.style.width = `${Math.ceil(width)}px`;
      svg.style.maxWidth = "none";
    }
  }, [result]);

  if (!result) return fallback;

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
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
    </figure>
  );
}
