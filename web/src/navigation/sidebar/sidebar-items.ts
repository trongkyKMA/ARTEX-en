import {
  Activity,
  Ban,
  BellRing,
  Bot,
  Brain,
  Bug,
  ClipboardList,
  FolderOpen,
  FolderSync,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Network,
  Plug,
  Radio,
  ScrollText,
  Settings2,
  ShieldAlert,
  Sparkles,
  Target,
  Terminal,
  Wrench,
} from "lucide-react";

import { tr } from "@/lib/i18n";

export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: tr("功能", "Functions"),
    items: [
      { id: "dashboard", title: tr("仪表盘", "Dashboard"), url: "/dashboard", icon: LayoutDashboard },
      { id: "chat", title: tr("对话", "Chat"), url: "/chat", icon: MessageSquare },
      { id: "tasks", title: tr("任务", "Tasks"), url: "/function/tasks", icon: Target },
      { id: "findings", title: tr("发现", "Findings"), url: "/function/findings", icon: Bug },
      { id: "traffic", title: tr("流量", "Traffic"), url: "/function/traffic", icon: Activity },
      { id: "commands", title: tr("工具执行", "Tool executions"), url: "/function/commands", icon: Terminal },
      { id: "llm-records", title: tr("LLM 录制", "LLM records"), url: "/function/llm-records", icon: Radio },
      { id: "assets", title: tr("资产", "Assets"), url: "/function/assets", icon: Network },
      { id: "sync", title: tr("资产同步", "Asset sync"), url: "/function/sync", icon: FolderSync },
      { id: "workspace", title: tr("工作空间", "Workspace"), url: "/function/workspace", icon: FolderOpen },
    ],
  },
  {
    id: 2,
    label: tr("系统", "System"),
    items: [
      { id: "llm", title: "LLM", url: "/system/llm", icon: Brain },
      { id: "agents", title: "Agent", url: "/system/agents", icon: Bot },
      { id: "mcp", title: "MCP", url: "/system/mcp", icon: Plug },
      { id: "skills", title: "Skill", url: "/system/skills", icon: Sparkles },
      { id: "tools", title: tr("工具", "Tools"), url: "/system/tools", icon: Wrench },
      { id: "notify", title: tr("通知推送", "Notifications"), url: "/system/notify", icon: BellRing },
      { id: "intercept", title: tr("拦截规则", "Intercept rules"), url: "/system/intercept", icon: ShieldAlert },
      { id: "asset-intercept", title: tr("资产拦截", "Asset intercept"), url: "/system/intercept/assets", icon: Ban },
      {
        id: "approvals",
        title: tr("审批记录", "Approval records"),
        url: "/system/intercept/approvals",
        icon: ClipboardList,
      },
      { id: "logs", title: tr("日志", "Logs"), url: "/system/logs", icon: ScrollText },
      { id: "settings", title: tr("系统配置", "Settings"), url: "/system/settings", icon: Settings2 },
    ],
  },
];
