"use client";

import * as React from "react";

import { ExplorationGraph } from "@/components/exploration-graph";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { Edge, TaskNode } from "@/lib/types";

// FindingLineageView renders the exploration sub-graph from the task's initial
// node down to this finding's node — the same attack-chain graph canvas as the task graph,
// scoped to just this finding's lineage.
export function FindingLineageView({ findingId }: { findingId: string }) {
  const [nodes, setNodes] = React.useState<TaskNode[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    api
      .findingLineage(findingId)
      .then((g) => {
        if (!alive) return;
        setNodes(g.nodes ?? []);
        setEdges(g.edges ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [findingId]);

  if (loaded && nodes.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {tr(
          "无链路可展示（该漏洞未关联探索节点，或所属任务已删除）。",
          "No chain to show (this finding is not linked to an exploration node, or its task was deleted).",
        )}
      </p>
    );
  }

  return (
    <ExplorationGraph
      nodes={nodes}
      edges={edges}
      className="h-[68vh]"
      emptyHint={loaded ? tr("无链路", "No chain") : tr("加载中…", "Loading…")}
    />
  );
}
