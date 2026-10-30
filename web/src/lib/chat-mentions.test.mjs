import assert from "node:assert/strict";
import test from "node:test";
import { activeMention, mentionSearch, mentionToken, selectedMentions } from "./chat-mentions.ts";

test("mention trigger supports Chinese and cursor placement without hijacking email", () => {
  assert.equal(activeMention("user@example.com", 16), null);
  assert.equal(activeMention("已选 @[漏洞#1 X]", 12), null);
  assert.deepEqual(activeMention("查看@漏洞 后面的文字", 5), { start: 2, end: 5, query: "漏洞" });
  assert.equal(activeMention("@漏洞\n下一行", 8), null);
});

test("mention trigger with English text", () => {
  assert.equal(activeMention("selected @[finding#1 X]", 23), null);
  assert.deepEqual(activeMention("see @finding then text", 12), { start: 4, end: 12, query: "finding" });
});

test("categories, Chinese aliases, IP and keyword search", () => {
  assert.equal(mentionSearch("").categories.length, 9);
  assert.equal(mentionSearch("漏").categories[0].kind, "finding");
  assert.equal(mentionSearch("漏洞").kind, "finding");
  assert.equal(mentionSearch("漏洞SQL注入").query, "SQL注入");
  assert.equal(mentionSearch("ip 192.0.2.1").kind, "ip");
  assert.equal(mentionSearch("接口 GET /api").query, "GET /api");
  assert.equal(mentionSearch("子域名 a.example.com").kind, "subdomain");
  assert.equal(mentionSearch("acme.com").kind, "");
});

test("English labels and aliases", () => {
  assert.equal(mentionSearch("fin").categories[0].kind, "finding");
  assert.equal(mentionSearch("finding").kind, "finding");
  assert.equal(mentionSearch("finding SQL injection").query, "SQL injection");
  assert.equal(mentionSearch("endpoint GET /api").kind, "endpoint");
  assert.equal(mentionSearch("api GET /api").query, "GET /api");
  assert.equal(mentionSearch("IP 192.0.2.1").kind, "ip");
  assert.equal(mentionSearch("domain example.com").kind, "root_domain");
  assert.equal(mentionSearch("subdomain a.example.com").kind, "subdomain");
  assert.equal(mentionSearch("findings").kind, "");
});

test("tokens roundtrip labels and removing one reference preserves its neighbors", () => {
  const first = mentionToken({ kind: "finding", id: 12, label: "Title[1]\ndetails" });
  const second = mentionToken({ kind: "ip", id: 13, label: "192.0.2.1" });
  assert.equal(first, "@[finding#12 Title（1） details]");
  assert.equal(second, "@[IP#13 192.0.2.1]");
  const value = `analyze ${first} and ${second}`;
  const selected = selectedMentions(value);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].label, "finding #12 · Title（1） details");
  const next = value.slice(0, selected[0].start) + value.slice(selected[0].start + selected[0].token.length);
  assert.equal(selectedMentions(next)[0].token, second);
});

test("legacy Chinese tokens are still recognised", () => {
  const value = "分析 @[漏洞#12 标题（1） 描述] 和 @[子域名#3 a.example.com] 以及 @[endpoint#4 GET /x]";
  const selected = selectedMentions(value);
  assert.deepEqual(
    selected.map((s) => s.label),
    ["漏洞 #12 · 标题（1） 描述", "子域名 #3 · a.example.com", "endpoint #4 · GET /x"],
  );
});
