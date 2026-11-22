import { describe, it, expect, afterEach, mock } from "bun:test";

// Mock execSync so git branch detection returns nothing (no GH-# match)
mock.module("node:child_process", () => ({
  execSync: () => "",
}));

import { IssueSliceLayer } from "../src/layers/issue-slice";

describe("IssueSliceLayer", () => {
  const origIss = process.env.GH_ISSUE;

  afterEach(() => {
    if (origIss) process.env.GH_ISSUE = origIss;
    else delete process.env.GH_ISSUE;
  });

  it("returns empty when no issue detected", async () => {
    delete process.env.GH_ISSUE;
    const layer = new IssueSliceLayer();
    const result = await layer.generate();
    expect(result.content).toBe("");
  });
});
