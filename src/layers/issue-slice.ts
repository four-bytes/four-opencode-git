import type { Layer, LayerConfig, LayerContent } from "../layers";
import { execSync } from "node:child_process";

export class IssueSliceLayer implements Layer {
  config: LayerConfig;

  constructor() {
    this.config = {
      id: "issue_slice",
      order: 4,
      enabled: true,
    };
  }

  async generate(): Promise<LayerContent> {
    const now = Date.now();
    const issueRef = await this.detectIssue();

    if (!issueRef) {
      return { content: "", updatedAt: now, source: "issue_slice (no issue)" };
    }

    try {
      const issueBody = execSync(`gh issue view ${issueRef} --json title,number,labels,state -q '.' 2>/dev/null || echo ""`, {
        encoding: "utf-8",
        timeout: 5000,
        cwd: process.cwd(),
      }).trim();

      if (!issueBody || issueBody === "null") {
        return { content: "", updatedAt: now, source: `issue_slice (gh returned null for #${issueRef})` };
      }

      const content = [
        `ACTIVE ISSUE: #${issueRef}`,
        issueBody,
      ].join("\n");

      return { content, updatedAt: now, source: `gh issue view #${issueRef}` };
    } catch (err) {
      // gh not installed, no network, or issue doesn't exist
      return {
        content: "",
        updatedAt: now,
        source: `issue_slice (gh failed: ${err})`,
      };
    }
  }

  private async detectIssue(): Promise<string | null> {
    const envIssue = process.env.GH_ISSUE || process.env.ISSUE;
    if (envIssue) return envIssue.replace("#", "");

    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ''", {
        encoding: "utf-8",
        timeout: 3000,
        cwd: process.cwd(),
      }).trim();

      // Patterns: feat/GH-NR-... or fix/123-...
      const ghMatch = branch.match(/GH-(\d+)/);
      if (ghMatch) return ghMatch[1];
      const numMatch = branch.match(/(\d+)/);
      if (numMatch) return numMatch[1];
    } catch {
      // not in git repo
    }

    return null;
  }
}
