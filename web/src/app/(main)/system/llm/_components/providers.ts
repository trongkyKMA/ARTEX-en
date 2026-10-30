// Provider presets for the LLM profile form: picking a provider fills in the wire format, the
// base URL for that format and a list of suggested models. The suggestions are only a starting
// point (model IDs change often) — the form also loads the live list from the provider's
// /models endpoint once an API key is available.

import { tr } from "@/lib/i18n";

export type LLMFormat = "anthropic" | "openai" | "openai-responses";

export interface ProviderPreset {
  id: string;
  label: string;
  // Base URL per supported wire format; the first entry is the default format.
  endpoints: Partial<Record<LLMFormat, string>>;
  models: string[];
  docsUrl: string;
  note?: string;
}

export const CUSTOM_PROVIDER = "custom";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    endpoints: { anthropic: "https://api.anthropic.com" },
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-8"],
    docsUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
    note: tr(
      "Claude Opus 5.5 / Sonnet 5.5 不支持关闭 thinking：「思考开关」保持「不发送」即可。",
      "Claude Opus 5.5 / Sonnet 5.5 can't disable thinking: leave the thinking switch on “Not sent”.",
    ),
  },
  {
    id: "openai",
    label: "OpenAI",
    endpoints: { openai: "https://api.openai.com/v1", "openai-responses": "https://api.openai.com/v1" },
    models: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"],
    docsUrl: "https://developers.openai.com/api/docs/models",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    endpoints: { openai: "https://api.deepseek.com", anthropic: "https://api.deepseek.com/anthropic" },
    models: ["deepseek-flash", "deepseek-v4-pro"],
    docsUrl: "https://api-docs.deepseek.com/",
  },
  {
    id: "glm-zai",
    label: tr("GLM（Z.ai 国际版）", "GLM (Z.ai, international)"),
    endpoints: { openai: "https://api.z.ai/api/paas/v4", anthropic: "https://api.z.ai/api/anthropic" },
    models: ["glm-5.3"],
    docsUrl: "https://docs.z.ai/guides/overview/quick-start",
    note: tr(
      "国际版与国内版（BigModel）的 Key 不通用；GLM Coding Plan 订阅需用其专用端点。",
      "Z.ai and BigModel (China) keys are not interchangeable; GLM Coding Plan subscriptions use their own endpoints.",
    ),
  },
  {
    id: "glm-bigmodel",
    label: tr("GLM（智谱 BigModel 国内版）", "GLM (Zhipu BigModel, China)"),
    endpoints: { openai: "https://open.bigmodel.cn/api/paas/v4", anthropic: "https://open.bigmodel.cn/api/anthropic" },
    models: ["glm-5.3"],
    docsUrl: "https://docs.bigmodel.cn/",
    note: tr("国际版与国内版（BigModel）的 Key 不通用。", "Z.ai and BigModel (China) keys are not interchangeable."),
  },
];

export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function presetFormats(p: ProviderPreset): LLMFormat[] {
  return Object.keys(p.endpoints) as LLMFormat[];
}

const normalizeURL = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

// detectProvider maps a saved profile back to its preset by base URL, so editing an existing
// profile shows the right provider. An empty base URL means the format's official default.
export function detectProvider(format: LLMFormat, baseUrl: string): string {
  const u = normalizeURL(baseUrl);
  if (!u) {
    if (format === "anthropic") return "anthropic";
    return "openai";
  }
  for (const p of PROVIDER_PRESETS) {
    if (Object.values(p.endpoints).some((e) => e && normalizeURL(e) === u)) return p.id;
  }
  return CUSTOM_PROVIDER;
}
