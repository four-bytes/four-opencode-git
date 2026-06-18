// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

import { tool } from "@opencode-ai/plugin";
import { curseScoreTool } from "./curse-score";
import { busFactorTool } from "./bus-factor";
import { implicitCouplingTool } from "./implicit-coupling";
import { ownershipTool } from "./ownership";
import { blastRadiusTool } from "./blast-radius";
import { trendTool } from "./trend";
import { prRiskTool } from "./pr-risk";

const METRICS = [
  "curse_score",
  "bus_factor",
  "implicit_coupling",
  "ownership",
  "blast_radius",
  "trend",
  "pr_risk",
] as const;

type Metric = (typeof METRICS)[number];

const dispatcher: Record<Metric, { execute(args: Record<string, unknown>, ctx: any): Promise<any> }> = {
  curse_score: curseScoreTool,
  bus_factor: busFactorTool,
  implicit_coupling: implicitCouplingTool,
  ownership: ownershipTool,
  blast_radius: blastRadiusTool,
  trend: trendTool,
  pr_risk: prRiskTool,
};

export const gitAnalyze = tool({
  description:
    "Analyze git history for risk, coupling, ownership, and trends. Choose metric: curse_score (dangerous files), bus_factor (orphan risk per directory), implicit_coupling (co-commit pairs), ownership (author breakdown), blast_radius (impact analysis), trend (risk trajectory), pr_risk (uncommitted change risk).",

  args: {
    metric: tool.schema.enum(METRICS, "Analysis metric to run"),
    top: tool.schema.number().optional().describe("Number of results to return (for curse_score, trend)"),
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter — e.g. '90d', '6m', '2024-01-01' (for curse_score, bus_factor, implicit_coupling, trend)"),
    file: tool.schema.string().optional().describe("File path to analyze (for blast_radius, ownership)"),
    threshold: tool.schema.number().optional().describe("Minimum co-commit rate 0.0-1.0 (for implicit_coupling)"),
    path: tool.schema.string().optional().describe("Directory path (for bus_factor, ownership)"),
    window_days: tool.schema.number().optional().describe("Comparison window size in days (for trend)"),
  },

  async execute(args, ctx) {
    const fn = dispatcher[args.metric];

    if (!fn) {
      throw new Error(`Unknown metric: ${args.metric}. Valid options: ${METRICS.join(", ")}`);
    }

    // Strip metric from args and remove undefined values
    const { metric: _, ...rest } = args;
    const cleanArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        cleanArgs[key] = value;
      }
    }

    return await fn.execute(cleanArgs, ctx);
  },
});
