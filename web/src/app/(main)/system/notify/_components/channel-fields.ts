// Channel field table and helpers for parsing config values.
//
// It is separate from the page because this is **data**, not a view: it describes which fields each channel has,
// which control each one should use, and the two-way conversion between form text and config values (JSON).
// With it in its own file, adding a channel only touches this file, not the page itself.
import { tr } from "@/lib/i18n";

// Display names and blurbs of channel types. Kept in the frontend because they only affect wording; the backend doesn't need to know.
export const KIND_LABEL: Record<string, string> = {
  dingtalk: tr("钉钉", "DingTalk"),
  feishu: tr("飞书", "Feishu"),
  wecom: tr("企业微信", "WeCom"),
  webhook: tr("通用 Webhook", "Generic Webhook"),
  telegram: "Telegram",
  email: tr("邮件", "Email"),
};

// Config field definitions per channel.
//
// A frontend field table is deliberately kept here instead of having the backend ship a schema: the backend is only responsible for
// Validate (required/format), while the UI needs layout and control types; the two concerns are different.
// The only coupling point is secret_keys -- which fields render as password inputs is given by the backend,
// because only the channel implementation knows which values count as credentials (WeCom's whole Webhook is a credential,
// while for DingTalk it's just one secret). A missing entry here for a new channel only leaves the form blank,
// it doesn't fail silently (hasFields below flags it).
export type FieldKind = "text" | "password" | "number" | "select" | "textarea" | "switch" | "kv" | "list";
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}
export const CHANNEL_FIELDS: Record<string, FieldDef[]> = {
  dingtalk: [
    {
      key: "webhook",
      label: tr("Webhook 地址", "Webhook URL"),
      kind: "text",
      placeholder: "https://oapi.dingtalk.com/robot/send?access_token=...",
    },
    {
      key: "secret",
      label: tr("加签密钥", "Signing secret"),
      kind: "password",
      help: tr(
        "机器人安全设置选「加签」时填写；选「自定义关键词」或未开启安全设置则留空",
        'Fill in when the bot security setting is "Signature"; leave empty for "Custom keywords" or no security setting',
      ),
    },
  ],
  feishu: [
    {
      key: "webhook",
      label: tr("Webhook 地址", "Webhook URL"),
      kind: "text",
      placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
    },
    {
      key: "secret",
      label: tr("签名校验密钥", "Signature verification secret"),
      kind: "password",
      help: tr(
        "机器人开启「签名校验」时填写，否则留空",
        "Fill in when the bot has signature verification enabled; otherwise leave empty",
      ),
    },
  ],
  wecom: [
    {
      key: "webhook",
      label: tr("Webhook 地址", "Webhook URL"),
      kind: "text",
      placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
    },
  ],
  webhook: [
    {
      key: "url",
      label: tr("目标 URL", "Target URL"),
      kind: "text",
      placeholder: "https://your-endpoint.example.com/hook",
    },
    {
      key: "method",
      label: tr("请求方法", "HTTP method"),
      kind: "select",
      options: [
        { value: "POST", label: tr("POST（带请求体）", "POST (with body)") },
        { value: "PUT", label: tr("PUT（带请求体）", "PUT (with body)") },
        { value: "PATCH", label: tr("PATCH（带请求体）", "PATCH (with body)") },
        { value: "GET", label: tr("GET（不带请求体）", "GET (no body)") },
      ],
    },
    {
      key: "headers",
      label: tr("自定义请求头", "Custom headers"),
      kind: "kv",
      help: tr(
        "每行 KEY=VALUE，例如 Authorization=Bearer xxx",
        "One KEY=VALUE per line, e.g. Authorization=Bearer xxx",
      ),
    },
    {
      key: "body_template",
      label: tr("请求体模板", "Body template"),
      kind: "textarea",
      help: tr(
        "留空用内置默认模板。变量：{{.Title}} {{.Batch}} {{.Count}} {{.HomeURL}} {{.SentAt}}，" +
          "以及 range .Items 下的 .Name/.VulnClass/.Severity/.Summary/.Assets/.DetailURL/.StatusLabel。" +
          "插入字符串请用 {{json .Xxx}} 而不是 {{.Xxx}}，否则标题里的引号会破坏 JSON。",
        "Leave empty to use the built-in default template. Variables: {{.Title}} {{.Batch}} {{.Count}} {{.HomeURL}} {{.SentAt}}, " +
          "plus .Name/.VulnClass/.Severity/.Summary/.Assets/.DetailURL/.StatusLabel inside range .Items. " +
          "Insert strings with {{json .Xxx}} rather than {{.Xxx}}, otherwise quotes in titles will break the JSON.",
      ),
    },
  ],
  telegram: [
    { key: "bot_token", label: "Bot Token", kind: "password", placeholder: "123456:ABC-DEF..." },
    { key: "chat_id", label: "Chat ID", kind: "text", placeholder: "-1001234567890" },
    {
      key: "base_url",
      label: tr("API 地址", "API URL"),
      kind: "text",
      placeholder: "https://api.telegram.org",
      help: tr(
        "留空用官方地址；自建 Bot API 反代时填写",
        "Leave empty for the official endpoint; set it when using a self-hosted Bot API proxy",
      ),
    },
  ],
  email: [
    { key: "host", label: tr("SMTP 服务器", "SMTP server"), kind: "text", placeholder: "smtp.example.com" },
    {
      key: "port",
      label: tr("端口", "Port"),
      kind: "number",
      placeholder: "587",
      help: tr("587 走 STARTTLS；465 请把「隐式 TLS」打开", 'Port 587 uses STARTTLS; for 465 turn on "Implicit TLS"'),
    },
    { key: "username", label: tr("账号", "Username"), kind: "text" },
    { key: "password", label: tr("密码 / 授权码", "Password / app password"), kind: "password" },
    { key: "from", label: tr("发件人", "From"), kind: "text", placeholder: "artex@example.com" },
    {
      key: "to",
      label: tr("收件人", "To"),
      kind: "list",
      help: tr("多个地址用逗号分隔", "Separate multiple addresses with commas"),
    },
    {
      key: "tls",
      label: tr("隐式 TLS", "Implicit TLS"),
      kind: "switch",
      help: tr(
        "465 端口打开；587 保持关闭（会自动 STARTTLS）",
        "On for port 465; keep off for 587 (STARTTLS is used automatically)",
      ),
    },
  ],
};

export const SEVERITY_OPTIONS = [
  { value: "", label: tr("不限", "Any") },
  { value: "low", label: tr("低危及以上", "Low and above") },
  { value: "medium", label: tr("中危及以上", "Medium and above") },
  { value: "high", label: tr("高危及以上", "High and above") },
  { value: "critical", label: tr("仅严重", "Critical only") },
];

export type ChannelForm = {
  name: string;
  kind: string;
  mode: "realtime" | "digest";
  enabled: boolean;
  ratePerMin: string;
  config: Record<string, unknown>;
  minSeverity: string;
  includeText: string;
  excludeText: string;
  taskIDsText: string;
  assetIDsText: string;
  onStatusChange: boolean;
};

export const emptyForm = (kind: string): ChannelForm => ({
  name: "",
  kind,
  mode: "realtime",
  enabled: true,
  ratePerMin: "",
  config: {},
  minSeverity: "",
  includeText: "",
  excludeText: "",
  taskIDsText: "",
  assetIDsText: "",
  onStatusChange: false,
});

// parseKV parses a textarea of "one KEY=VALUE per line".
export function parseKV(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
// parseIDs parses a comma/whitespace-separated id list.
export function parseIDs(text: string): number[] {
  return text
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}
// parseKeywords parses a line/comma-separated keyword list (vulnerability type names may contain spaces, so split by line or comma).
export function parseKeywords(text: string): string[] {
  return text
    .split(/[\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
