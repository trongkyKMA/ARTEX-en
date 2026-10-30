"use client";

import * as React from "react";

import { tr } from "@/lib/i18n";
import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

// Send/newline key binding for the chat input. Pure frontend preference: stored only in localStorage, not in the DB and not synced with the account,
// so it must be set again in another browser. See issue #39 — 0.3.2 changed Ctrl+Enter-to-send into Enter-to-send;
// this brings the old binding back as an option.
export type ChatSendMode = "enter" | "ctrl-enter";

export const CHAT_SEND_MODE_KEY = "artex_chat_send_mode";
export const DEFAULT_CHAT_SEND_MODE: ChatSendMode = "enter";

export const CHAT_SEND_MODE_OPTIONS: { value: ChatSendMode; label: string }[] = [
  { value: "enter", label: tr("Enter 发送，Shift+Enter 换行", "Enter to send, Shift+Enter for new line") },
  { value: "ctrl-enter", label: tr("Ctrl+Enter 发送，Enter 换行", "Ctrl+Enter to send, Enter for new line") },
];

function parseMode(raw: string | null): ChatSendMode {
  return raw === "ctrl-enter" || raw === "enter" ? raw : DEFAULT_CHAT_SEND_MODE;
}

// Subscribers within the same tab. localStorage's storage event fires only in "other" tabs,
// so after changing the setting on this page we emit to notify inputs on the same page; otherwise a refresh would be needed.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// Returns string literals; Object.is compares by value, so useSyncExternalStore won't loop.
function getSnapshot(): ChatSendMode {
  return parseMode(getLocalStorageValue(CHAT_SEND_MODE_KEY));
}

// The server has no localStorage: render the default first, getSnapshot corrects it after hydration.
function getServerSnapshot(): ChatSendMode {
  return DEFAULT_CHAT_SEND_MODE;
}

export function useChatSendMode(): ChatSendMode {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setChatSendMode(mode: ChatSendMode) {
  setLocalStorageValue(CHAT_SEND_MODE_KEY, mode);
  for (const listener of listeners) listener();
}

// shouldSubmitOnKey decides whether a keypress should send.
// isComposing / keyCode 229 mean an IME (e.g. Chinese) is choosing a candidate; these must pass through, otherwise Enter to pick a word would send.
// enter mode excludes only Shift, identical to the 0.3.2 behaviour — users who don't change the setting feel no difference.
// ctrl-enter mode accepts both Ctrl and Cmd (macOS).
export function shouldSubmitOnKey(e: React.KeyboardEvent, mode: ChatSendMode): boolean {
  if (e.key !== "Enter") return false;
  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return false;
  if (mode === "ctrl-enter") return e.ctrlKey || e.metaKey;
  return !e.shiftKey;
}
