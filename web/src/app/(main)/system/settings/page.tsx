"use client";

import * as React from "react";

import {
  CpuIcon,
  FlaskConicalIcon,
  KeyboardIcon,
  LanguagesIcon,
  RadioTowerIcon,
  SearchIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { CHAT_SEND_MODE_OPTIONS, type ChatSendMode, setChatSendMode, useChatSendMode } from "@/lib/chat-send-mode";
import { tr } from "@/lib/i18n";
import type { Settings } from "@/lib/types";

import { UpdateCard } from "./_components/update-card";

export default function SystemSettingsPage() {
  const [trafficCapture, setTrafficCapture] = React.useState(false);
  const [agentTrafficBinding, setAgentTrafficBinding] = React.useState(false);
  const [outputLanguage, setOutputLanguage] = React.useState<Settings["output_language"]>("en");
  const [webSearch, setWebSearch] = React.useState(false);
  const [backend, setBackend] = React.useState("ddgs");
  const [braveKeySet, setBraveKeySet] = React.useState(false);
  const [braveKeyInput, setBraveKeyInput] = React.useState("");
  const [tavilyKeySet, setTavilyKeySet] = React.useState(false);
  const [tavilyKeyInput, setTavilyKeyInput] = React.useState("");
  const [savingTavilyKey, setSavingTavilyKey] = React.useState(false);
  const [proxyInput, setProxyInput] = React.useState("");
  const [savingProxy, setSavingProxy] = React.useState(false);
  const [globalProxyInput, setGlobalProxyInput] = React.useState("");
  const [savingGlobalProxy, setSavingGlobalProxy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savingKey, setSavingKey] = React.useState(false);
  const [pyInterp, setPyInterp] = React.useState("");
  const [workers, setWorkers] = React.useState("3");
  const [savingWorkers, setSavingWorkers] = React.useState(false);
  // Operation constraint injection scope (both on by default).
  const [injectPlanner, setInjectPlanner] = React.useState(true);
  const [injectWorker, setInjectWorker] = React.useState(true);
  // Experimental feature: noa context compaction (off by default).
  const [noaCompaction, setNoaCompaction] = React.useState(false);
  // Pure frontend preference: doesn't go through /api/settings, reads/writes localStorage directly.
  const sendMode = useChatSendMode();

  const apply = React.useCallback((s: Settings) => {
    setTrafficCapture(!!s.traffic_capture);
    setAgentTrafficBinding(!!s.agent_traffic_binding);
    setOutputLanguage(s.output_language === "zh" ? "zh" : "en");
    setWebSearch(!!s.web_search_enabled);
    setBackend(s.web_search_backend || "ddgs");
    setBraveKeySet(!!s.brave_key_set);
    setTavilyKeySet(!!s.tavily_key_set);
    setProxyInput(s.web_search_proxy ?? "");
    setGlobalProxyInput(s.global_proxy ?? "");
    setPyInterp(s.python_interpreter ?? "");
    setWorkers(String(s.workers ?? 3));
    setInjectPlanner(s.constraints_inject_planner !== false);
    setInjectWorker(s.constraints_inject_worker !== false);
    setNoaCompaction(!!s.noa_compaction);
  }, []);

  const saveWorkers = () => {
    const n = Number(workers);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error(tr("并发数必须是大于 0 的整数", "Concurrency must be an integer greater than 0"));
      return;
    }
    setSavingWorkers(true);
    api
      .setSettings({ workers: n })
      .then((s) => {
        apply(s);
        toast.success(
          tr(
            "已保存并发工作 agent 数（对之后启动的任务生效）",
            "Saved the number of concurrent worker agents (applies to tasks started afterwards)",
          ),
        );
      })
      .catch((e) => toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message))
      .finally(() => setSavingWorkers(false));
  };

  const savePython = () => {
    setSaving(true);
    api
      .setSettings({ python_interpreter: pyInterp.trim() })
      .then((s) => {
        apply(s);
        toast.success(tr("已保存 Python 解释器配置", "Python interpreter saved"));
      })
      .catch((e) => toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message))
      .finally(() => setSaving(false));
  };
  const detectPython = () => {
    setSaving(true);
    api
      .detectPython()
      .then((r) => setPyInterp(r.python_interpreter))
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  React.useEffect(() => {
    api
      .settings()
      .then(apply)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [apply]);

  const toggleTraffic = (v: boolean) => {
    setTrafficCapture(v); // optimistic
    setSaving(true);
    api
      .setSettings({ traffic_capture: v })
      .then(apply)
      .catch(() => setTrafficCapture(!v)) // revert on failure
      .finally(() => setSaving(false));
  };

  const toggleInjectPlanner = (v: boolean) => {
    setInjectPlanner(v); // optimistic
    api
      .setSettings({ constraints_inject_planner: v })
      .then(apply)
      .catch(() => setInjectPlanner(!v)); // revert on failure
  };

  const changeOutputLanguage = (v: Settings["output_language"]) => {
    const prev = outputLanguage;
    setOutputLanguage(v); // optimistic
    api
      .setSettings({ output_language: v })
      .then((s) => {
        apply(s);
        toast.success(tr("Agent 输出语言已保存", "Agent output language saved"));
      })
      .catch((e) => {
        setOutputLanguage(prev);
        toast.error(tr(`保存失败：${(e as Error).message}`, `Save failed: ${(e as Error).message}`));
      });
  };

  const toggleAgentTrafficBinding = (v: boolean) => {
    setAgentTrafficBinding(v);
    setSaving(true);
    api
      .setSettings({ agent_traffic_binding: v })
      .then((s) => {
        apply(s);
        toast.success(
          v
            ? tr("已开启 Agent 自动绑定流量", "Agent automatic traffic binding enabled")
            : tr("已关闭 Agent 自动绑定流量", "Agent automatic traffic binding disabled"),
        );
      })
      .catch((e) => {
        setAgentTrafficBinding(!v);
        toast.error(tr(`保存失败：${(e as Error).message}`, `Save failed: ${(e as Error).message}`));
      })
      .finally(() => setSaving(false));
  };

  const toggleInjectWorker = (v: boolean) => {
    setInjectWorker(v); // optimistic
    api
      .setSettings({ constraints_inject_worker: v })
      .then(apply)
      .catch(() => setInjectWorker(!v)); // revert on failure
  };

  const toggleNoaCompaction = (v: boolean) => {
    setNoaCompaction(v); // optimistic
    api
      .setSettings({ noa_compaction: v })
      .then((s) => {
        apply(s);
        toast.success(
          v
            ? tr(
                "已开启 noa 上下文压缩（对之后启动的运行生效）",
                "noa context compaction enabled (applies to runs started afterwards)",
              )
            : tr(
                "已关闭 noa 上下文压缩（恢复内置压缩）",
                "noa context compaction disabled (built-in compaction restored)",
              ),
        );
      })
      .catch((e) => {
        setNoaCompaction(!v); // revert on failure
        toast.error(tr(`保存失败：${(e as Error).message}`, `Save failed: ${(e as Error).message}`));
      });
  };

  // Persist a web-search patch (enable and/or backend). Optimistic with refetch.
  const saveWebSearch = (patch: Partial<Settings>) => {
    setSaving(true);
    api
      .setSettings(patch)
      .then((s) => {
        apply(s);
        toast.success(tr("已保存网络搜索配置", "Web search settings saved"));
      })
      .catch((e) => {
        toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message);
        api
          .settings()
          .then(apply)
          .catch(() => undefined);
      })
      .finally(() => setSaving(false));
  };

  const saveBraveKey = () => {
    setSavingKey(true);
    api
      .setSettings({ brave_search_api_key: braveKeyInput })
      .then((s) => {
        apply(s);
        setBraveKeyInput("");
        toast.success(tr("已保存 Brave API Key", "Brave API key saved"));
      })
      .catch((e) => toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message))
      .finally(() => setSavingKey(false));
  };

  const saveTavilyKey = () => {
    setSavingTavilyKey(true);
    api
      .setSettings({ tavily_search_api_key: tavilyKeyInput })
      .then((s) => {
        apply(s);
        setTavilyKeyInput("");
        toast.success(tr("已保存 Tavily API Key", "Tavily API key saved"));
      })
      .catch((e) => toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message))
      .finally(() => setSavingTavilyKey(false));
  };

  const saveProxy = () => {
    setSavingProxy(true);
    api
      .setSettings({ web_search_proxy: proxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(
          proxyInput.trim()
            ? tr("已保存出口代理", "Egress proxy saved")
            : tr("已清除出口代理（改为直连）", "Egress proxy cleared (direct connection)"),
        );
      })
      .catch((e) => toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message))
      .finally(() => setSavingProxy(false));
  };

  const saveGlobalProxy = () => {
    setSavingGlobalProxy(true);
    api
      .setSettings({ global_proxy: globalProxyInput.trim() })
      .then((s) => {
        apply(s);
        toast.success(
          globalProxyInput.trim()
            ? tr("已保存全局代理", "Global proxy saved")
            : tr("已清除全局代理（改为直连）", "Global proxy cleared (direct connection)"),
        );
      })
      .catch((e) => toast.error(tr("保存失败：", "Save failed: ") + (e as Error).message))
      .finally(() => setSavingGlobalProxy(false));
  };

  // Run a real "test" search ("test") against the CURRENT form values (backend +
  // proxy + entered key), falling back to saved values server-side. Toasts result.
  const runTest = () => {
    setTesting(true);
    api
      .testWebSearch({
        web_search_backend: backend,
        web_search_proxy: proxyInput.trim(),
        brave_search_api_key: braveKeyInput,
        tavily_search_api_key: tavilyKeyInput,
      })
      .then((r) => {
        if (r.ok)
          toast.success(
            tr(
              `搜索测试成功 · ${r.backend} 返回 ${r.count} 条结果`,
              `Search test succeeded · ${r.backend} returned ${r.count} results`,
            ),
          );
        else toast.error(tr("搜索测试失败：", "Search test failed: ") + (r.error || tr("未知错误", "unknown error")));
      })
      .catch((e) => toast.error(tr("搜索测试失败：", "Search test failed: ") + (e as Error).message))
      .finally(() => setTesting(false));
  };

  // brave-free selected but no key stored and none being entered → tool stays off.
  const braveNeedsKey = webSearch && backend === "brave-free" && !braveKeySet;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{tr("系统配置", "Settings")}</h1>
        <p className="text-muted-foreground text-sm">{tr("全局运行时开关", "Global runtime switches")}</p>
      </div>

      {/* Columns rather than grid: the web search card is several times taller than the rest, and its height varies with the selected backend (the brave/tavily
          key input is conditionally rendered). A grid would stretch the whole row to the tallest card and leave large blank areas beside it,
          while columns balance the fill by content height automatically. Card spacing uses mb instead of gap -- in a multi-column layout
          column-gap only handles spacing between columns; row spacing must come from the children themselves. */}
      <div className="columns-1 gap-4 md:gap-6 lg:columns-2">
        <UpdateCard />

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              {tr("流量捕获", "Traffic capture")}
            </CardTitle>
            <CardDescription>
              {tr(
                "开启后，所有 Agent 的 HTTP 流量经记录代理全量落库，并向 Agent 注入 traffic_search / traffic_get 工具与代理配置（提示词含代理说明）。",
                "When on, all Agent HTTP traffic goes through a recording proxy and is stored in full, and Agents get the traffic_search / traffic_get tools plus proxy settings (the prompt explains the proxy).",
              )}
              <br />
              {tr("关闭（默认）时不记录任何流量：Agent", "When off (default), no traffic is recorded: Agents ")}
              <b>{tr("不会", "do not")}</b>
              {tr("拿到代理配置与流量工具，提示词也", " get the proxy settings or traffic tools, and the prompt ")}
              <b>{tr("不含", "contains nothing")}</b>
              {tr(
                "代理相关内容。切换后会即时重建 Agent 生效。",
                " about the proxy. Switching rebuilds the Agents immediately.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="traffic-capture" className="text-sm font-normal text-muted-foreground">
              {trafficCapture
                ? tr("已开启 · 正在记录流量并注入代理", "On · recording traffic and injecting the proxy")
                : tr("已关闭 · 不记录、不注入代理", "Off · not recording, no proxy injected")}
            </Label>
            <Switch
              id="traffic-capture"
              checked={trafficCapture}
              disabled={!loaded || saving}
              onCheckedChange={toggleTraffic}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LanguagesIcon className="size-4" />
              {tr("Agent 输出语言", "Agent output language")}
            </CardTitle>
            <CardDescription id="output-language-description">
              {tr(
                "Agent 撰写漏洞、事实、意图、报告、复测结论及对话回复所用的语言。默认 English（提示词本身为英文）；选中文时，会在所有 Agent 的系统提示末尾追加中文输出要求（优先于提示词里的语言要求），提示词正文不变。",
                "The language Agents use for findings, facts, intents, reports, retest verdicts and chat replies. The default is English (the prompts themselves are in English); with 中文, a Chinese-output instruction is appended to the end of every Agent's system prompt (taking precedence over language instructions in the prompts); the prompt bodies are unchanged.",
              )}
              <br />
              {tr(
                "对之后启动的 Agent 运行生效；已生成的内容不会被翻译。拦截审批的模型裁决理由保持英文。",
                "Applies to Agent runs started afterwards; existing content is not translated. Model verdict reasons in intercept approvals stay in English.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="output-language" className="text-sm font-normal text-muted-foreground">
              {tr("输出语言", "Output language")}
            </Label>
            <Select
              value={outputLanguage}
              disabled={!loaded}
              onValueChange={(v) => changeOutputLanguage(v as Settings["output_language"])}
            >
              <SelectTrigger id="output-language" aria-describedby="output-language-description" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">中文</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              {tr("Agent 自动绑定流量", "Agent automatic traffic binding")}
            </CardTitle>
            <CardDescription id="agent-traffic-binding-description">
              {tr(
                "默认关闭。开启后，漏洞入库时触发的报告 Agent 会核对已有 HTTP 请求/响应，关联对应流量后再编写报告。",
                "Off by default. When on, the report Agent triggered when a finding is saved checks the existing HTTP requests/responses and links the matching traffic before writing the report.",
              )}
              <b>
                {tr(
                  "查阅数据包及额外的工具调用会增加 Token 消耗。",
                  " Reviewing packets and the extra tool calls increase token usage.",
                )}
              </b>
              <br />
              {tr(
                "TCP、未抓包或没有匹配流量时仍可正常上报。此开关不影响流量捕获、人工绑定及已保存证据的查看。 对下一轮 Agent 生效；关闭后会立即拒绝新的自动绑定。",
                "Findings are still reported normally for TCP, uncaptured traffic, or when nothing matches. This switch does not affect traffic capture, manual binding, or viewing saved evidence. It applies from the next Agent round; turning it off rejects new automatic bindings immediately.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="agent-traffic-binding" className="text-sm font-normal text-muted-foreground">
              {agentTrafficBinding
                ? tr("已开启 · 会增加 Token 消耗", "On · increases token usage")
                : tr("已关闭 · 可继续人工绑定", "Off · manual binding still available")}
            </Label>
            <Switch
              id="agent-traffic-binding"
              aria-describedby="agent-traffic-binding-description"
              checked={agentTrafficBinding}
              disabled={!loaded || saving}
              onCheckedChange={toggleAgentTrafficBinding}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              {tr("全局代理", "Global proxy")}
            </CardTitle>
            <CardDescription>
              {tr("所有 Agent 的", "All Agents' ")}
              <b>{tr("目标流量", "target traffic")}</b>
              {tr(
                "经此代理出网（隐藏源 IP / 走跳板）。支持 ",
                " leaves through this proxy (hides the source IP / uses a jump host). Supports ",
              )}
              <b>http / https / socks5</b>
              {tr("，可带", " with optional")} <code>user:pass</code>{" "}
              {tr("认证。留空=直连。", "authentication. Empty = direct connection.")}
              <br />
              {tr("开启", "With ")}
              <b>{tr("流量捕获", "traffic capture")}</b>
              {tr("时，它作为记录代理的", " on, it acts as the recording proxy's ")}
              <b>{tr("上游", "upstream")}</b>
              {tr(
                "（流量仍全量落库，再经此代理出网）；关闭捕获时，直接注入 Agent 的 bash / WebFetch 出网。与网络搜索代理、LLM 代理相互独立。",
                " (traffic is still stored in full, then leaves through this proxy); with capture off, it is injected directly into the Agents' bash / WebFetch egress. Independent of the web search proxy and the LLM proxy.",
              )}
              <br />
              <b>{tr("提示", "Tip")}</b>
              {tr("：socks5 在", ": with socks5 and ")}
              <b>{tr("关闭捕获", "capture off")}</b>
              {tr("时依赖各命令行工具对 ", ", it depends on each CLI tool supporting ")}
              <code>ALL_PROXY</code>
              {tr(
                " 的支持（curl 可用，部分工具可能忽略）； 若主要用 socks5，建议开启流量捕获——此路径由 MITM 亲自拨号，工具无感知、稳定生效。",
                " (curl works, some tools may ignore it). If you mainly use socks5, turn on traffic capture: that path dials through the MITM itself, transparently to tools, and works reliably.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="global-proxy" className="text-sm font-normal text-muted-foreground">
              {tr("代理地址", "Proxy URL")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="global-proxy"
                autoComplete="off"
                placeholder={tr(
                  "socks5://user:pass@host:1080 或 http://host:port（留空=直连）",
                  "socks5://user:pass@host:1080 or http://host:port (empty = direct)",
                )}
                value={globalProxyInput}
                disabled={!loaded || savingGlobalProxy}
                onChange={(e) => setGlobalProxyInput(e.target.value)}
              />
              <Button type="button" onClick={saveGlobalProxy} disabled={!loaded || savingGlobalProxy}>
                {tr("保存", "Save")}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {globalProxyInput.trim()
                ? tr("已配置 · 所有目标流量经此代理出网", "Configured · all target traffic leaves through this proxy")
                : tr("未配置 · 目标流量直连出网", "Not configured · target traffic connects directly")}
            </p>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlertIcon className="size-4" />
              {tr("操作约束注入", "Constraint injection")}
            </CardTitle>
            <CardDescription>
              {tr("开启后，把每个任务的", "When on, each task's ")}
              <b>{tr("操作约束", "operating constraints")}</b>
              {tr(
                "（在任务总览「操作约束」里维护的 allow/deny 条目）拼进对应 Agent 的系统提示，用来框定探索边界（如「仅测当前端口」「禁止爆破」）。",
                ' (the allow/deny entries maintained under "Constraints" in the task overview) are added to the matching Agent\'s system prompt to bound exploration (e.g. "only test the current port", "no brute force").',
              )}
              <br />
              {tr("可分别控制注入到 ", "Injection can be controlled separately for the ")}
              <b>{tr("规划者（planner）", "planner")}</b>
              {tr("与 ", " and the ")}
              <b>{tr("执行者（worker）", "worker")}</b>
              {tr(
                "；默认都开。切换即时生效（下一轮读取），无需重建 Agent。关闭后该 Agent 不再看到约束。",
                "; both are on by default. Changes take effect immediately (read on the next round) without rebuilding Agents. When off, that Agent no longer sees the constraints.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="inject-planner" className="text-sm font-normal text-muted-foreground">
                {tr("注入规划者（planner）", "Inject into planner")}
                {injectPlanner ? tr(" · 已开启", " · On") : tr(" · 已关闭", " · Off")}
              </Label>
              <Switch
                id="inject-planner"
                checked={injectPlanner}
                disabled={!loaded}
                onCheckedChange={toggleInjectPlanner}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="inject-worker" className="text-sm font-normal text-muted-foreground">
                {tr("注入执行者（worker）", "Inject into worker")}
                {injectWorker ? tr(" · 已开启", " · On") : tr(" · 已关闭", " · Off")}
              </Label>
              <Switch
                id="inject-worker"
                checked={injectWorker}
                disabled={!loaded}
                onCheckedChange={toggleInjectWorker}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConicalIcon className="size-4" />
              {tr("实验功能", "Experimental")}
            </CardTitle>
            <CardDescription>
              {tr(
                "尚在验证中的机制，默认关闭。可能改变 Agent 行为或影响稳定性，请在了解影响后启用。",
                "Mechanisms still being validated, off by default. They may change Agent behavior or affect stability; enable them only once you understand the impact.",
              )}
              <br />
              <b>{tr("noa 上下文压缩", "noa context compaction")}</b>
              {tr(
                "：由模型主动压缩长对话历史（norma v0.4.0）。开启后平台接入的四类 Agent（",
                ": the model itself compacts long conversation history (norma v0.4.0). When on, the four Agent types (",
              )}
              <b>{tr("规划者 / 执行者 / 主 Agent / 对话", "planner / worker / main Agent / chat")}</b>
              {tr(
                "）改用 noa 接管上下文，取代内置压缩，压缩原文会归档到任务工作目录下便于回溯。切换即时生效（对之后启动的运行生效），无需重建 Agent；关闭后立即恢复内置压缩。",
                ") hand context management to noa instead of the built-in compaction, and the compacted originals are archived in the task working directory for review. Changes apply to runs started afterwards without rebuilding Agents; turning it off restores the built-in compaction immediately.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="noa-compaction" className="text-sm font-normal text-muted-foreground">
              {tr("noa 上下文压缩", "noa context compaction")}
              {noaCompaction ? tr(" · 已开启", " · On") : tr(" · 已关闭", " · Off")}
            </Label>
            <Switch
              id="noa-compaction"
              checked={noaCompaction}
              disabled={!loaded}
              onCheckedChange={toggleNoaCompaction}
            />
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SearchIcon className="size-4" />
              {tr("网络搜索", "Web search")}
            </CardTitle>
            <CardDescription>
              {tr("这是网络搜索的", "This is the web search ")}
              <b>{tr("总开关 + 来源配置", "master switch + source settings")}</b>
              {tr("。开启后，才能在", ". Only when it is on can you choose, in ")}
              <b>{tr("每个 Agent 的配置", "each Agent's settings")}</b>
              {tr("里单独选择是否启用", ", whether to enable ")}
              <b>web_search</b>
              {tr(
                "（仅返回标题/链接/摘要，不抓取正文；抓取由 WebFetch 负责）。网络搜索",
                " (returns only titles/links/snippets, no page bodies; fetching is done by WebFetch). Web search ",
              )}
              <b>{tr("不走", "does not go through")}</b>
              {tr("记录代理，独立于流量捕获。", " the recording proxy and is independent of traffic capture.")}
              <br />
              {tr("来源可选 ", "Sources: ")}
              <b>{tr("DuckDuckGo（ddgs）", "DuckDuckGo (ddgs)")}</b>
              {tr("（无需 Key）、", " (no key needed), ")}
              <b>{tr("Brave（免费版）", "Brave (free tier)")}</b>
              {tr("（需填写 Brave API Key）、", " (requires a Brave API key), ")} <b>Tavily</b>
              {tr("（需填写 Tavily API Key）或 ", " (requires a Tavily API key) or ")}
              <b>DeepSeek</b>
              {tr(
                "（复用当前 LLM 配置）。总开关关闭时，各 Agent 的网络搜索开关不可用。",
                " (reuses the current LLM profile). When the master switch is off, the per-Agent web search switch is unavailable.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="web-search" className="text-sm font-normal text-muted-foreground">
                {webSearch
                  ? tr(
                      "总开关已开启 · 可在各 Agent 配置里单独启用",
                      "Master switch on · enable it per Agent in Agent settings",
                    )
                  : tr("已关闭 · 各 Agent 无法启用网络搜索", "Off · Agents cannot enable web search")}
              </Label>
              <Switch
                id="web-search"
                checked={webSearch}
                disabled={!loaded || saving}
                onCheckedChange={(v) => {
                  setWebSearch(v); // optimistic
                  saveWebSearch({ web_search_enabled: v });
                }}
              />
            </div>

            {webSearch && (
              <div className="flex items-center justify-between gap-4">
                <Label className="text-sm font-normal text-muted-foreground">{tr("搜索来源", "Search source")}</Label>
                <Select
                  value={backend}
                  disabled={!loaded || saving}
                  onValueChange={(v) => {
                    setBackend(v); // optimistic
                    saveWebSearch({ web_search_backend: v });
                  }}
                >
                  <SelectTrigger className="w-48 shrink-0">
                    <SelectValue placeholder={tr("选择来源", "Select source")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ddgs">
                      {tr("DuckDuckGo（ddgs · 免费无 Key）", "DuckDuckGo (ddgs · free, no key)")}
                    </SelectItem>
                    <SelectItem value="brave-free">
                      {tr("Brave（免费版 · 需 Key）", "Brave (free tier · key required)")}
                    </SelectItem>
                    <SelectItem value="tavily">{tr("Tavily（需 Key）", "Tavily (key required)")}</SelectItem>
                    <SelectItem value="deepseek">{tr("DeepSeek（官方）", "DeepSeek (official)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {webSearch && backend === "deepseek" && (
              <div className="border-border/60 bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
                <p className="text-sm font-medium">{tr("DeepSeek 官方联网搜索", "DeepSeek official web search")}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {tr("该来源直接复用", "This source reuses ")}
                  <b>{tr("当前激活的 LLM 配置", "the currently active LLM profile")}</b>
                  {tr("。因此它", ". It therefore ")}
                  <b>{tr("仅支持 DeepSeek 官方模型", "only supports official DeepSeek models")}</b>
                  {tr("，且该配置", ", and the profile ")}
                  <b>{tr("必须使用 anthropic 协议", "must use the anthropic protocol")}</b>
                  {tr(
                    "——DeepSeek 的 OpenAI 协议端点不支持服务端搜索。切换 LLM 配置后此来源可能失效。",
                    ": DeepSeek's OpenAI-protocol endpoint does not support server-side search. Switching the LLM profile may break this source.",
                  )}
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {tr("与其它来源不同，搜索由 ", "Unlike the other sources, the search is ")}
                  <b>{tr("DeepSeek 服务端执行", "executed by DeepSeek's servers")}</b>
                  {tr(
                    "：每次搜索会额外消耗一次模型调用（产生 Token 费用），搜索请求",
                    ": each search costs an extra model call (token charges), search requests ",
                  )}
                  <b>{tr("不经过上面的出口代理", "do not go through the egress proxy above")}</b>
                  {tr("，也", " and are ")}
                  <b>{tr("不计入流量留痕", "not recorded in traffic logs")}</b>
                  {tr("；返回结果", "; results contain ")}
                  <b>{tr("只有标题和链接", "only titles and links")}</b>
                  {tr(
                    "（无摘要），需要正文时由 WebFetch 抓取。",
                    " (no snippets), and WebFetch fetches page bodies when needed.",
                  )}
                </p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {tr(
                    "是否满足上述条件由你自行确认，系统不做拦截；可用下方「测试搜索」按钮实际跑一次来验证。",
                    'You are responsible for meeting these conditions; the system does not block it. Use the "Test search" button below to verify with a real run.',
                  )}
                </p>
              </div>
            )}

            {webSearch && backend === "brave-free" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="brave-key" className="text-sm font-normal text-muted-foreground">
                  Brave Search API Key
                  {braveKeySet && <span className="ml-2 text-xs text-emerald-500">{tr("已配置", "Configured")}</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="brave-key"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      braveKeySet
                        ? tr("已配置（留空则不变）", "Configured (leave empty to keep)")
                        : tr("输入 Brave API Key", "Enter Brave API key")
                    }
                    value={braveKeyInput}
                    disabled={!loaded || savingKey}
                    onChange={(e) => setBraveKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveBraveKey}
                    disabled={!loaded || savingKey || braveKeyInput.trim() === ""}
                  >
                    {tr("保存", "Save")}
                  </Button>
                </div>
                {braveNeedsKey && (
                  <p className="text-xs text-amber-500">
                    {tr(
                      "已选择 Brave 但尚未配置 Key —— 在保存 Key 之前，搜索工具不会启用。",
                      "Brave is selected but no key is configured; the search tool stays off until a key is saved.",
                    )}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "免费版额度约 2,000 次/月。前往 https://brave.com/search/api/ 获取 Key。",
                    "The free tier allows about 2,000 queries/month. Get a key at https://brave.com/search/api/.",
                  )}
                </p>
              </div>
            )}

            {webSearch && backend === "tavily" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="tavily-key" className="text-sm font-normal text-muted-foreground">
                  Tavily Search API Key
                  {tavilyKeySet && <span className="ml-2 text-xs text-emerald-500">{tr("已配置", "Configured")}</span>}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tavily-key"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      tavilyKeySet
                        ? tr("已配置（留空则不变）", "Configured (leave empty to keep)")
                        : tr("输入 Tavily API Key（tvly-…）", "Enter Tavily API key (tvly-…)")
                    }
                    value={tavilyKeyInput}
                    disabled={!loaded || savingTavilyKey}
                    onChange={(e) => setTavilyKeyInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={saveTavilyKey}
                    disabled={!loaded || savingTavilyKey || tavilyKeyInput.trim() === ""}
                  >
                    {tr("保存", "Save")}
                  </Button>
                </div>
                {webSearch && backend === "tavily" && !tavilyKeySet && (
                  <p className="text-xs text-amber-500">
                    {tr(
                      "已选择 Tavily 但尚未配置 Key —— 在保存 Key 之前，搜索工具不会启用。",
                      "Tavily is selected but no key is configured; the search tool stays off until a key is saved.",
                    )}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "前往 https://tavily.com 注册并获取 API Key。",
                    "Sign up at https://tavily.com to get an API key.",
                  )}
                </p>
              </div>
            )}

            {webSearch && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="ws-proxy" className="text-sm font-normal text-muted-foreground">
                  {tr("出口代理（可选）", "Egress proxy (optional)")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ws-proxy"
                    autoComplete="off"
                    placeholder={tr(
                      "http://host:port 或 socks5://host:port（留空=直连）",
                      "http://host:port or socks5://host:port (empty = direct)",
                    )}
                    value={proxyInput}
                    disabled={!loaded || savingProxy}
                    onChange={(e) => setProxyInput(e.target.value)}
                  />
                  <Button type="button" onClick={saveProxy} disabled={!loaded || savingProxy}>
                    {tr("保存", "Save")}
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "独立出口代理，仅用于访问搜索端点（VPN/SOCKS 等）。与记录流量的 MITM 代理无关；网络不通时经此代理访问。",
                    "A separate egress proxy used only to reach the search endpoints (VPN/SOCKS, etc.). Unrelated to the traffic-recording MITM proxy; use it when the network cannot reach them directly.",
                  )}
                </p>
              </div>
            )}

            {webSearch && (
              <div className="flex items-center justify-between gap-4 border-t pt-4">
                <p className="text-muted-foreground text-xs">
                  {tr(
                    "用当前配置（来源 + 代理 + Key）实际搜索一次「test」，验证是否可用。",
                    'Runs a real search for "test" with the current settings (source + proxy + key) to verify it works.',
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runTest}
                  disabled={!loaded || testing}
                  className="shrink-0"
                >
                  {testing ? tr("测试中…", "Testing…") : tr("测试搜索", "Test search")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4" />
              {tr("自定义脚本 · Python 解释器", "Custom scripts · Python interpreter")}
            </CardTitle>
            <CardDescription>
              {tr("自定义 ", "Custom ")}
              <b>script</b>
              {tr(
                " 类型工具用它跑 Python。开机会自动检测（python3 优先）；此处可手填 venv / 特定版本的绝对路径，留空则运行时自动检测。",
                " tools run Python with it. It is auto-detected at startup (python3 preferred); you can enter the absolute path of a venv / specific version here, or leave it empty to auto-detect at runtime.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                className="font-mono text-sm"
                placeholder={tr("/usr/bin/python3（留空=自动检测）", "/usr/bin/python3 (empty = auto-detect)")}
                value={pyInterp}
                disabled={!loaded || saving}
                onChange={(e) => setPyInterp(e.target.value)}
              />
              <Button variant="outline" onClick={detectPython} disabled={!loaded || saving}>
                {tr("重新检测", "Re-detect")}
              </Button>
              <Button onClick={savePython} disabled={!loaded || saving}>
                {tr("保存", "Save")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CpuIcon className="size-4" />
              {tr("工作并发 · Work Agent 数", "Concurrency · worker Agents")}
            </CardTitle>
            <CardDescription>
              {tr(
                "每个任务并发运行的工作 agent 数量（默认 3）。数值越大并发探测越多、消耗也越高。修改后",
                "Number of worker agents each task runs concurrently (default 3). Higher values mean more parallel probing and higher cost. Changes ",
              )}
              <b>{tr("对之后启动的任务生效", "apply to tasks started afterwards")}</b>
              {tr("，正在运行的任务不受影响。", "; running tasks are unaffected.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                className="w-32 font-mono text-sm"
                placeholder="3"
                value={workers}
                disabled={!loaded || savingWorkers}
                onChange={(e) => setWorkers(e.target.value)}
              />
              <Button onClick={saveWorkers} disabled={!loaded || savingWorkers}>
                {tr("保存", "Save")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4 break-inside-avoid md:mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyboardIcon className="size-4" />
              {tr("会话输入框发送键位", "Chat input send key")}
            </CardTitle>
            <CardDescription>
              {tr(
                "对话页与任务详情的主 Agent 会话输入框共用此设置，选择后立即生效、无需保存。",
                "Shared by the chat page and the main Agent chat input on task details. Takes effect immediately, no save needed.",
              )}
              <br />
              {tr("该偏好", "This preference is ")}
              <b>{tr("只存在本浏览器", "stored only in this browser")}</b>
              {tr(
                "，不随账号同步，换浏览器或清理站点数据后需重新设置。",
                " and is not synced with your account; set it again after switching browsers or clearing site data.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="chat-send-mode" className="text-sm font-normal text-muted-foreground">
              {tr("发送方式", "Send with")}
            </Label>
            <Select value={sendMode} onValueChange={(v) => setChatSendMode(v as ChatSendMode)}>
              <SelectTrigger id="chat-send-mode" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_SEND_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
