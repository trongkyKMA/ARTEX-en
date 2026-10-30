import { tr } from "@/lib/i18n";
import type { NewAssetType } from "@/lib/types";

const ASSET_TYPE_LABELS: Record<NewAssetType, string> = {
  app: tr("应用", "App"),
  endpoint: tr("接口", "Endpoint"),
  ip: "IP",
  root_domain: tr("根域名", "Root domain"),
  service: tr("服务", "Service"),
  subdomain: tr("子域名", "Subdomain"),
};

const TASK_ASSET_SOURCE_LABELS: Record<string, string> = {
  agent: tr("Agent 发现", "Agent discovery"),
  anchor: tr("黑板锚点", "Blackboard anchor"),
  api: tr("资产 API", "Asset API"),
  company: tr("企业关联", "Company link"),
  legacy: tr("历史关联", "Legacy link"),
  manual: tr("人工加入", "Added manually"),
  system: tr("系统关联", "System link"),
  task: tr("任务初始化", "Task init"),
};

export function taskAssetTypeLabel(type: NewAssetType): string {
  return ASSET_TYPE_LABELS[type];
}

export function taskAssetSourceLabel(source: string): string {
  return TASK_ASSET_SOURCE_LABELS[source] ?? source;
}
