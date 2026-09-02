import { describe, expect, it } from "vite-plus/test";

import { isMermaidFenceLanguage } from "./MermaidDiagram";
import { serializeMarkdownCodeFence } from "../markdown-clipboard";

describe("isMermaidFenceLanguage", () => {
  it("accepts mermaid and mmd fences", () => {
    expect(isMermaidFenceLanguage("mermaid")).toBe(true);
    expect(isMermaidFenceLanguage("MMD")).toBe(true);
    expect(isMermaidFenceLanguage("typescript")).toBe(false);
  });
});

describe("mermaid clipboard fences", () => {
  it("chooses a fence longer than backtick runs in copied source", () => {
    expect(serializeMarkdownCodeFence("flowchart LR\n%% ``` in a comment", "mermaid")).toBe(
      "````mermaid\nflowchart LR\n%% ``` in a comment\n````\n\n",
    );
  });
});
