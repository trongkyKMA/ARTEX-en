"use client";

import * as React from "react";

import { Bot, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { AgentEditor } from "@/components/agent-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { Agent } from "@/lib/types";

// AgentGridCard is one clickable tile opening the agent's editor drawer. Custom
// (non-builtin) agents get a delete button.
function AgentGridCard({ agent, onOpen, onDeleted }: { agent: Agent; onOpen: () => void; onDeleted: () => void }) {
  async function del() {
    try {
      await api.deleteAgent(agent.key);
      toast.success(tr(`已删除 Agent「${agent.name}」`, `Deleted agent "${agent.name}"`));
      onDeleted();
    } catch (e) {
      toast.error(tr("删除失败：", "Delete failed: ") + (e as Error).message);
    }
  }
  return (
    <div className="hover:border-primary/50 group relative flex flex-col gap-2 rounded-lg border p-4 transition-colors">
      <button type="button" onClick={onOpen} className="flex flex-col gap-2 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="text-muted-foreground size-4" />
          <span className="text-sm font-medium">{agent.name}</span>
          <span className="text-muted-foreground font-mono text-xs">{agent.key}</span>
          {agent.builtin ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {tr("内置", "Built-in")}
            </Badge>
          ) : (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {tr("自定义", "Custom")}
            </Badge>
          )}
          {!agent.enabled && (
            <Badge variant="outline" className="text-destructive px-1.5 py-0 text-[10px]">
              {tr("已停用", "Disabled")}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground line-clamp-2 min-h-8 text-xs">
          {agent.description || tr("（无描述）", "(No description)")}
        </p>
        <div className="text-muted-foreground flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded border px-1.5 py-0.5">MCP {agent.mcp_count ?? 0}</span>
          <span className="rounded border px-1.5 py-0.5">Skill {agent.skill_count ?? 0}</span>
          <span className="rounded border px-1.5 py-0.5">
            {tr("工具", "Tools")} {agent.tool_count ?? 0}
          </span>
        </div>
      </button>
      {!agent.builtin && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {tr(`删除 Agent「${agent.name}」？`, `Delete agent "${agent.name}"?`)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {tr(
                  "将一并删除它的提示词、变量、可见性与工具绑定。此操作不可撤销。",
                  "Its prompts, variables, visibility and tool bindings will be deleted too. This cannot be undone.",
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr("取消", "Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={del}>{tr("删除", "Delete")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function CreateAgentDialog({ onCreated }: { onCreated: (key: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function create() {
    setBusy(true);
    try {
      const a = await api.createAgent(key.trim(), name.trim(), description.trim());
      toast.success(tr(`已创建 Agent「${a.name}」`, `Created agent "${a.name}"`));
      setOpen(false);
      setKey("");
      setName("");
      setDescription("");
      onCreated(a.key);
    } catch (e) {
      toast.error(tr("创建失败：", "Create failed: ") + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const keyOk = /^[a-z][a-z0-9_]*$/.test(key.trim());
  const canCreate = keyOk && name.trim().length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> {tr("新建 Agent", "New agent")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("新建自定义 Agent", "New custom agent")}</DialogTitle>
          <DialogDescription>
            {tr(
              "创建一个会话型助手。key 用于内部标识，创建后不可更改；名称与描述用于识别。",
              "Create a conversational assistant. The key is an internal identifier and cannot be changed later; the name and description help identify it.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-key">Key</Label>
            <Input
              id="agent-key"
              placeholder={tr("如 research_helper", "e.g. research_helper")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="font-mono"
            />
            {key.length > 0 && !keyOk && (
              <span className="text-destructive text-xs">
                {tr(
                  "小写字母开头，仅含小写字母/数字/下划线",
                  "Must start with a lowercase letter; only lowercase letters, digits and underscores",
                )}
              </span>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">{tr("名称", "Name")}</Label>
            <Input
              id="agent-name"
              placeholder={tr("如 研究助手", "e.g. Research helper")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-desc">{tr("描述", "Description")}</Label>
            <Textarea
              id="agent-desc"
              placeholder={tr("一句话说明这个 Agent 是干什么的", "One sentence on what this agent does")}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={!canCreate}>
            {tr("创建", "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [editKey, setEditKey] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    api
      .agents()
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);

  const editing = agents.find((a) => a.key === editKey) ?? null;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agent</h1>
          <p className="text-muted-foreground text-sm">
            {tr(
              "内置 Agent 的提示词/配置，以及自定义会话 Agent 的创建与管理",
              "Prompts and settings of built-in agents, plus creating and managing custom conversational agents",
            )}
          </p>
        </div>
        <CreateAgentDialog
          onCreated={(key) => {
            reload();
            setEditKey(key);
          }}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr("Agent 清单", "Agents")}</CardTitle>
          <CardDescription>{tr(`共 ${agents.length} 个`, `${agents.length} total`)}</CardDescription>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{tr("（暂无 Agent）", "(No agents yet)")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((a) => (
                <AgentGridCard key={a.key} agent={a} onOpen={() => setEditKey(a.key)} onDeleted={reload} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditKey(null)}>
        <SheetContent
          side="right"
          className="flex flex-col gap-0 p-0 data-[side=right]:w-[45vw] data-[side=right]:sm:max-w-[45vw]"
        >
          {editing && (
            <>
              <SheetHeader className="px-4">
                <SheetTitle className="flex items-center gap-2">
                  {editing.name}
                  <span className="text-muted-foreground font-mono text-xs">{editing.key}</span>
                  {!editing.builtin && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      {tr("自定义", "Custom")}
                    </Badge>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {editing.description ||
                    tr("提示词、配置、可见资源与工具绑定", "Prompts, settings, visible resources and tool bindings")}
                </SheetDescription>
              </SheetHeader>
              <AgentEditor agentKey={editing.key} onSaved={reload} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
