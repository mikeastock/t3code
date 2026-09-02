import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

import {
  getCachedMermaidSvg,
  renderMermaidSvg,
  resetMermaidRendererForTests,
} from "./mermaidRenderer";

describe("renderMermaidSvg", () => {
  beforeEach(() => {
    resetMermaidRendererForTests();
    mermaid.initialize.mockReset();
    mermaid.render.mockReset();
  });

  it("renders with strict security and the selected theme", async () => {
    mermaid.render.mockResolvedValue({ svg: '<svg id="t3m_1_"></svg>' });

    await renderMermaidSvg("flowchart LR\nA-->B", "dark");

    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        htmlLabels: false,
        theme: "dark",
      }),
    );
    expect(mermaid.render).toHaveBeenCalledWith("t3m_1_", "flowchart LR\nA-->B");
  });

  it("continues rendering after an invalid diagram", async () => {
    mermaid.render
      .mockRejectedValueOnce(new Error("Invalid diagram"))
      .mockResolvedValueOnce({ svg: '<svg id="t3m_2_"></svg>' });

    await expect(renderMermaidSvg("invalid", "light")).rejects.toThrow();
    await expect(renderMermaidSvg("sequenceDiagram\nA->>B: Hi", "light")).resolves.toContain(
      "<svg",
    );
  });

  it("reuses a finished render after the first caller is gone", async () => {
    mermaid.render.mockResolvedValue({ svg: '<svg id="t3m_1_"></svg>' });

    await renderMermaidSvg("flowchart LR\nA-->B", "light");
    mermaid.render.mockClear();

    const cached = getCachedMermaidSvg("flowchart LR\nA-->B", "light");
    const second = await renderMermaidSvg("flowchart LR\nA-->B", "light");

    expect(cached).toContain("<svg");
    expect(second).toContain("<svg");
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
