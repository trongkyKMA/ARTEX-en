"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { ArrowUpIcon, MessageCircleQuestionIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import type { SideQuestions } from "@/hooks/use-side-questions";
import { intlLocale, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ComposerLayout = "inline" | "stacked";

const preparationLabels = {
  preparing: tr("正在准备上下文…", "Preparing context…"),
  summarizing_history: tr("正在整理早期旁路问答…", "Summarizing earlier side questions…"),
  compressing_snapshot: tr("正在压缩旁路上下文副本…", "Compressing the side-question context copy…"),
  retrying: tr("模型上下文超限，正在缩减后重试…", "Model context limit exceeded, trimming and retrying…"),
  answering: tr("正在回答…", "Answering…"),
};

export function SideQuestionButton({ side }: { side: SideQuestions }) {
  if (!side.enabled) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => side.setOpen(true)}
      title={tr("/btw 旁路提问", "/btw side question")}
    >
      <MessageCircleQuestionIcon data-icon="inline-start" />
      {tr("旁路提问", "Side question")}
    </Button>
  );
}

function SidePanel({
  side,
  label,
  composerLayout,
}: {
  side: SideQuestions;
  label: string;
  composerLayout: ComposerLayout;
}) {
  const inlineComposer = composerLayout === "inline";
  const [confirm, setConfirm] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const tail = side.items.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: New cumulative text scrolls only readers who remain at the bottom.
  useEffect(() => {
    if (pinned.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [tail?.answer, tail?.id]);
  const status = {
    running: tr("回答中", "Answering"),
    completed: tr("已完成", "Completed"),
    failed: tr("失败", "Failed"),
    cancelled: tr("已停止", "Stopped"),
    interrupted: tr("已中断", "Interrupted"),
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label={tr("旁路提问面板", "Side question panel")}
    >
      <div className="flex items-center gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {tr("旁路提问", "Side question")} <span className="text-muted-foreground">/btw</span>
          </p>
          <p className="truncate text-muted-foreground text-xs">{label}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setConfirm(true)}
          disabled={!side.items.length || side.busy}
          aria-label={tr("清空旁路历史", "Clear side-question history")}
        >
          <Trash2Icon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => side.setOpen(false)}
          aria-label={tr("关闭旁路面板", "Close side-question panel")}
        >
          <XIcon />
        </Button>
      </div>
      <div className="border-b px-3 py-2 text-muted-foreground text-xs">
        {side.snapshot ? (
          <>
            <p>{side.snapshot.model.model}</p>
            <p>
              {tr("上下文更新于", "Context updated")} {new Date(side.snapshot.captured_at).toLocaleString(intlLocale())}
            </p>
          </>
        ) : (
          tr("主 Agent 首次运行后即可提问", "You can ask once the main Agent has run for the first time")
        )}
      </div>
      <div
        ref={viewport}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto p-3"
      >
        {side.nextCursor > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void side.load(side.nextCursor)}>
            {tr("加载更早的旁路问答", "Load earlier side questions")}
          </Button>
        )}
        {side.loading && <Skeleton className="h-16 w-full" />}
        {!side.loading && side.items.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{tr("随时问一个问题", "Ask a question anytime")}</EmptyTitle>
              <EmptyDescription>
                {tr(
                  "根据当前 Agent 的上下文回答，主任务继续运行。",
                  "Answered from the current Agent's context while the main task keeps running.",
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div className="flex flex-col gap-5">
          {side.items.map((item) => (
            <article key={item.id} className="flex min-w-0 flex-col gap-2">
              <div className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">{item.question}</div>
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                <Badge variant="secondary">{status[item.status]}</Badge>
                <span className="truncate">{item.model.model}</span>
                <time dateTime={item.snapshot_at} title={new Date(item.snapshot_at).toLocaleString(intlLocale())}>
                  {tr("上下文", "Context")} {new Date(item.snapshot_at).toLocaleTimeString(intlLocale())}
                </time>
              </div>
              {item.context?.estimated_input_tokens != null && (
                <p className="text-muted-foreground text-xs">
                  {tr(
                    `最近 ${item.context.recent_exchanges} 组问答原文`,
                    `Last ${item.context.recent_exchanges} Q&A exchanges verbatim`,
                  )}
                  {item.context.history_summarized && tr(" · 含早期问答摘要", " · includes summary of earlier Q&A")}
                  {item.context.snapshot_summarized && tr(" · 使用主上下文摘要", " · uses main context summary")}
                </p>
              )}
              {item.answer && <Markdown text={item.answer} />}
              {!item.answer && item.status === "running" && (
                <p role="status" className="text-muted-foreground text-sm">
                  {preparationLabels[item.context?.phase ?? "answering"]}
                </p>
              )}
              {item.error && (
                <Alert variant="destructive">
                  <AlertDescription>{item.error}</AlertDescription>
                </Alert>
              )}
            </article>
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t p-3">
        {(side.error || side.snapshot?.reason) && (
          <Alert variant="destructive" className="mb-2">
            <AlertDescription>{side.error || side.snapshot?.reason}</AlertDescription>
          </Alert>
        )}
        <InputGroup className={inlineComposer ? "min-h-10" : "min-h-9"}>
          <InputGroupTextarea
            rows={1}
            className={cn("overflow-y-auto", inlineComposer ? "max-h-40 min-h-0" : "max-h-36 min-h-9")}
            aria-label={tr("旁路问题", "Side question")}
            placeholder={tr("询问当前上下文…", "Ask about the current context…")}
            value={side.draft}
            maxLength={4000}
            disabled={side.busy}
            onChange={(event) => side.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void side.ask(side.draft);
              }
            }}
          />
          <InputGroupAddon align={inlineComposer ? "inline-end" : "block-end"}>
            {!inlineComposer && (
              <span className="text-muted-foreground text-xs">
                {tr("独立问答 · 无工具执行", "Standalone Q&A · no tool execution")}
              </span>
            )}
            {side.running ? (
              <InputGroupButton
                className="ml-auto"
                variant="destructive"
                size="icon-xs"
                onClick={() => void side.stop()}
                aria-label={tr("停止旁路回答", "Stop side answer")}
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                className="ml-auto"
                variant="default"
                size="icon-xs"
                onClick={() => void side.ask(side.draft)}
                disabled={side.busy || !side.draft.trim() || !side.snapshot?.available}
                aria-label={tr("发送旁路问题", "Send side question")}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
      {inlineComposer && (
        <div className="shrink-0 truncate px-3 pt-0.5 pb-1 text-muted-foreground text-xs">
          {tr("独立问答 · 无工具执行", "Standalone Q&A · no tool execution")}
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("清空旁路历史？", "Clear side-question history?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr(
                "删除当前 Agent 的旁路问答，并停止正在生成的旁路回答。主会话和上下文快照会保留。",
                "Deletes this Agent's side questions and stops any answer being generated. The main conversation and context snapshot are kept.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("取消", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void side.clear()}>{tr("清空历史", "Clear history")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function SideQuestionWorkspace({
  side,
  label,
  children,
  composerLayout = "stacked",
}: {
  side: SideQuestions;
  label: string;
  children: ReactNode;
  composerLayout?: ComposerLayout;
}) {
  const mobile = useIsMobile();
  return (
    <>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
        <ResizablePanel id="main-conversation" minSize="35%" className="flex min-h-0 min-w-0 flex-col">
          {children}
        </ResizablePanel>
        {side.open && side.enabled && !mobile && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="side-question" defaultSize="38%" minSize="280px" maxSize="65%">
              <SidePanel side={side} label={label} composerLayout={composerLayout} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <Drawer open={mobile && side.open && side.enabled} onOpenChange={side.setOpen}>
        <DrawerContent className="h-[85svh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{tr("旁路提问", "Side question")}</DrawerTitle>
            <DrawerDescription>{tr(`${label} 的独立问答`, `Standalone Q&A for ${label}`)}</DrawerDescription>
          </DrawerHeader>
          <SidePanel side={side} label={label} composerLayout={composerLayout} />
        </DrawerContent>
      </Drawer>
    </>
  );
}
