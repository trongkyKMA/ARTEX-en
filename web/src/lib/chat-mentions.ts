// label is the canonical keyword written into mention tokens (@[finding#12 title]) and sent to the model;
// alias is an extra short keyword accepted while searching; zh is the legacy Chinese keyword, still accepted
// when typed by the user and inside tokens written before the English labels.
export const mentionKinds = [
  { kind: "finding", label: "finding", alias: "finding", zh: "漏洞" },
  { kind: "asset", label: "asset", alias: "asset", zh: "资产" },
  { kind: "company", label: "company", alias: "company", zh: "企业" },
  { kind: "endpoint", label: "endpoint", alias: "api", zh: "接口" },
  { kind: "ip", label: "IP", alias: "ip", zh: "IP" },
  { kind: "app", label: "app", alias: "app", zh: "应用" },
  { kind: "root_domain", label: "domain", alias: "domain", zh: "域名" },
  { kind: "subdomain", label: "subdomain", alias: "subdomain", zh: "子域名" },
  { kind: "service", label: "service", alias: "service", zh: "服务" },
] as const;

export type MentionKind = (typeof mentionKinds)[number]["kind"];
export interface ChatMention {
  kind: MentionKind;
  id: number;
  label: string;
  description: string;
}

export function activeMention(value: string, caret: number) {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0 || (start > 0 && /[\w.+/-]/.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  if (/[[\]\r\n@]/.test(query) || query.length > 220) return null;
  return { start, end: caret, query };
}

export function mentionSearch(query: string) {
  const text = query.trimStart().toLowerCase();
  for (const item of mentionKinds) {
    for (const alias of [item.label.toLowerCase(), item.alias, item.zh.toLowerCase()]) {
      if (text === alias || text.startsWith(`${alias} `) || (/[^a-z]/.test(alias) && text.startsWith(alias))) {
        return { kind: item.kind, query: query.trimStart().slice(alias.length).trim(), categories: [] };
      }
    }
  }
  const categories = mentionKinds.filter(
    (item) =>
      item.label.toLowerCase().startsWith(text) ||
      item.alias.startsWith(text) ||
      item.zh.toLowerCase().startsWith(text),
  );
  return { kind: "" as const, query: query.trim(), categories };
}

export function mentionToken(item: ChatMention) {
  const kind = mentionKinds.find((entry) => entry.kind === item.kind)?.label ?? "asset";
  const label = item.label
    .replace(/[[\]]/g, (char) => (char === "[" ? "（" : "）"))
    .replace(/\s+/g, " ")
    .slice(0, 100);
  return `@[${kind}#${item.id} ${label}]`;
}

// Tokens carry the English label; the legacy Chinese labels are still recognised.
const MENTION_TOKEN =
  /@\[(finding|asset|company|endpoint|IP|app|domain|subdomain|service|漏洞|资产|企业|接口|应用|域名|子域名|服务)#([0-9]+)(?: ([^\]\r\n]*))?\]/g;

export function selectedMentions(value: string) {
  return [...value.matchAll(MENTION_TOKEN)].map((match) => ({
    token: match[0],
    label: `${match[1]} #${match[2]}${match[3] ? ` · ${match[3]}` : ""}`,
    start: match.index,
  }));
}
