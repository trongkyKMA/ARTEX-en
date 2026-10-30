"use client";

import { CheckIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { tr } from "@/lib/i18n";
import type { NotificationFilter } from "@/lib/types";

// asText / inputType are value helpers local to this file (closely tied to control rendering), not placed in channel-fields.
import { type FieldDef, type FieldKind, SEVERITY_OPTIONS } from "./channel-fields";

// asText renders any config value as a string usable in an input.
// config comes from JSON, so values may be string / number / boolean / array / null;
// here we only care whether it "fits in a text box"; serialization proper is buildConfig's job.
function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

// inputType maps a field type to the input's type attribute.
function inputType(kind: FieldKind): "text" | "password" | "number" {
  if (kind === "password") return "password";
  if (kind === "number") return "number";
  return "text";
}

// ConfigField renders the control matching a field definition.
//
// Masked fields are the only subtlety here: the input does **not** show the masked value itself, only a
// "saved" hint. That leaves a single rule on screen -- text in the box is what the user typed,
// an empty box is an empty value. If "__masked__:…abc123" were put into the input, users would take it for placeholder text
// they need to delete themselves, making it easier to wipe credentials by mistake.
export function ConfigField({
  def,
  value,
  isSecret,
  onChange,
}: {
  def: FieldDef;
  value: unknown;
  isSecret: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `n-cfg-${def.key}`;
  const raw = asText(value);
  // Masked value echoed by the backend: like "__masked__:…abc123", the tail is a recognizable fragment of the original value.
  const masked = isSecret && raw.startsWith("__masked__");
  const maskedTail = masked ? (raw.split("…")[1] ?? "") : "";

  if (def.kind === "switch") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Switch checked={value === true} onCheckedChange={onChange} aria-label={def.label} />
        {def.label}
        {def.help && <span className="text-muted-foreground">{tr(`（${def.help}）`, `(${def.help})`)}</span>}
      </div>
    );
  }

  if (def.kind === "select") {
    return (
      <div className="grid gap-2">
        <Label>{def.label}</Label>
        <Select value={raw || def.options?.[0]?.value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(def.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Controls are dispatched by field type. An if chain rather than nested ternaries, because four kinds of controls are distinguished here,
  // and three levels of ternaries already make you stop and count parentheses.
  function control() {
    if (def.kind === "textarea" || def.kind === "kv") {
      return (
        <Textarea
          id={id}
          className="font-mono"
          placeholder={def.placeholder}
          value={masked ? "" : raw}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    if (def.kind === "list") {
      return (
        <Input
          id={id}
          value={Array.isArray(value) ? (value as string[]).join(", ") : raw}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
        />
      );
    }
    return (
      <Input
        id={id}
        className={def.kind === "text" ? "font-mono" : ""}
        type={inputType(def.kind)}
        placeholder={def.placeholder}
        value={masked ? "" : raw}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const hint = masked ? (
    <p className="text-muted-foreground flex items-center gap-1 text-xs">
      <CheckIcon className="size-3" />
      {tr("已保存", "Saved")}
      {maskedTail ? tr(`（尾号 ${maskedTail}）`, ` (ending ${maskedTail})`) : ""}
      {tr(" · 填入新值即覆盖，清空则删除该项", " · Enter a new value to overwrite; clear it to remove")}
    </p>
  ) : (
    def.help && <p className="text-muted-foreground text-xs">{def.help}</p>
  );

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{def.label}</Label>
      {control()}
      {hint}
    </div>
  );
}

// FilterSummary summarizes the filter conditions into one line, so the card shows what this channel pushes without expanding.
export function FilterSummary({ filter }: { filter: NotificationFilter }) {
  const parts: string[] = [];
  if (filter.min_severity) {
    parts.push(SEVERITY_OPTIONS.find((o) => o.value === filter.min_severity)?.label ?? filter.min_severity);
  }
  if (filter.vulnclass_include?.length)
    parts.push(
      tr(`类型含 ${filter.vulnclass_include.length} 词`, `Type includes ${filter.vulnclass_include.length} keyword(s)`),
    );
  if (filter.vulnclass_exclude?.length)
    parts.push(
      tr(`排除 ${filter.vulnclass_exclude.length} 词`, `Excludes ${filter.vulnclass_exclude.length} keyword(s)`),
    );
  if (filter.task_ids?.length) parts.push(tr(`${filter.task_ids.length} 个任务`, `${filter.task_ids.length} task(s)`));
  if (filter.asset_ids?.length)
    parts.push(tr(`${filter.asset_ids.length} 个资产`, `${filter.asset_ids.length} asset(s)`));
  if (filter.on_status_change) parts.push(tr("含状态变更", "Incl. status changes"));
  if (parts.length === 0) {
    return <p className="text-muted-foreground text-sm">{tr("全部漏洞", "All findings")}</p>;
  }
  return <p className="text-muted-foreground text-sm">{parts.join(" · ")}</p>;
}
