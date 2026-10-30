package notify

import (
	"fmt"
	"strings"
)

// This file is the message rendering shared by the "Markdown family" channels (DingTalk, WeCom).
// Feishu uses card JSON, Telegram uses HTML and email uses HTML, each rendered in its own adapter.

// maxAssetsShown is the maximum number of assets listed in a message. One finding may be anchored to dozens of assets;
// listing them all would overflow the message and carries no information: nobody reads the 4th domain onward in IM.
const maxAssetsShown = 3

// maxSummaryRunes is how many characters the summary is compressed to. An IM message is a "prompt to go read the details",
// not the report itself; the full content is in the platform.
const maxSummaryRunes = 120

// markdownReservedBytes is reserved for the message header (digest line + severity distribution + possible truncation notice)
// and footer (platform link). When packing whole items this is deducted from the budget so header and footer never get cut;
// once they are cut, the reader cannot even tell "which batch this is and how many items were not shown".
const markdownReservedBytes = 320

// markdownEscape escapes markdown metacharacters.
//
// Why it is required: finding titles, summaries, classes and asset display names all come from **untrusted sources**:
// titles and summaries come from model output (and the model reads the tested target's responses), and an asset url is the full
// URL obtained by scanning (including a target-controlled query string). Without escaping, a finding titled
//
//	Login SQL injection\n[URGENT: click here to verify your account](http://attacker.tld)
//
// would render as a **clickable external link** in the security engineer's DingTalk/Feishu; and
// `![](http://attacker.tld/beacon)` would be fetched by the client when rendered, announcing
// "this finding has been viewed" and leaking the reader's IP. Even with benign content, injected bold or
// quote blocks can push the critical findings below out past the fold.
//
// The escape set covers characters for headings/links/emphasis/lists/quotes/strikethrough, which change structure or produce clickable
// elements. `\` must be handled first, otherwise backslashes added later would be escaped again.
func markdownEscape(s string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		"`", "\\`",
		"*", `\*`,
		"_", `\_`,
		"[", `\[`,
		"]", `\]`,
		"(", `\(`,
		")", `\)`,
		"!", `\!`,
		"#", `\#`,
		">", `\>`,
		"|", `\|`,
		"~", `\~`,
	)
	return replacer.Replace(s)
}

// markdownText squeezes untrusted text into a single line and escapes it, for use in markdown bodies.
// Single-lining is the other half besides escaping: a newline by itself can forge a new list item or quote block,
// which escaping characters cannot stop.
func markdownText(s string, maxRunes int) string {
	return markdownEscape(OneLine(s, maxRunes))
}

// markdownTitle returns the message title (the IM platform's title bar/card title) as **unescaped original text**.
//
// It deliberately does not escape: this title is shared by renderers in four contexts: markdown bodies, Telegram's
// HTML, Feishu card plain_text, and the generic webhook's JSON and email subject. Each context has
// different escaping rules (markdown escaping inside HTML leaves visible backslashes, inside JSON it pollutes
// the data), so escaping must be done by each output side, see writeItem / feishuItemLines /
// telegramEscape. Markdown escaping was once added in the shared function, and Telegram messages ended up
// showing visible backslashes like `\(1\)`.
func markdownTitle(m Message) string {
	if m.Batch {
		return fmt.Sprintf("Findings digest · %d total", len(m.Items))
	}
	if len(m.Items) == 0 {
		return "Finding notification"
	}
	it := m.Items[0]
	return fmt.Sprintf("[%s] %s", SeverityLabel(it.Severity), OneLine(it.Title(), 0))
}

// markdownBody renders the message body and returns the body and the **number of items actually written**.
//
// The returned kept is the number of items this delivery actually delivers; the caller marks only the first kept items
// as delivered, and items left out by the channel's length limit must wait for the next batch instead of being
// marked successful along with the rest. This is exactly where "silent loss" comes from: the message was truncated, but the delivery records show all delivered,
// with nowhere to see that the second half was never sent.
//
// maxBytes<=0 means no limit.
func markdownBody(m Message, maxBytes int) (string, int) {
	if !m.Batch {
		if len(m.Items) == 0 {
			return "", 0
		}
		var b strings.Builder
		writeItem(&b, m.Items[0], "", true)
		// A single message is sent even if too long (the final truncation is the backstop): partial information about one finding
		// is better than sending nothing.
		return TruncateBytes(b.String(), maxBytes), 1
	}

	footer := ""
	if m.HomeURL != "" {
		footer = fmt.Sprintf("\n[View all on the platform](%s)\n", m.HomeURL)
	}
	kept := packItemCount(m.Items, maxBytes, markdownReservedBytes, footer, byteSize, func(it Item, idx int) string {
		var b strings.Builder
		writeItem(&b, it, fmt.Sprintf("%d. ", idx+1), false)
		return b.String()
	})

	items := m.Items[:kept]
	var b strings.Builder
	b.WriteString(markdownBatchIntro(m, items, len(m.Items)))
	for i, it := range items {
		writeItem(&b, it, fmt.Sprintf("%d. ", i+1), false)
	}
	b.WriteString(footer)
	return TruncateBytes(b.String(), maxBytes), kept
}

// markdownBatchIntro renders the start of a digest message: time window, count and severity distribution.
// With these, the recipient can decide whether the batch needs immediate attention without opening the platform.
//
// items are the items **actually packed**, total is the number the batch should contain. When they differ it must say explicitly
// "how many more are in the next message", otherwise readers would take the number in the header as everything,
// and the items never sent would not exist anywhere in the UI.
func markdownBatchIntro(m Message, items []Item, total int) string {
	var b strings.Builder
	if m.WindowMinutes > 0 {
		fmt.Fprintf(&b, "**New findings in the last %d minutes: %d**", m.WindowMinutes, total)
	} else {
		fmt.Fprintf(&b, "**New findings: %d**", total)
	}
	if extra := total - len(items); extra > 0 {
		fmt.Fprintf(&b, " (showing the first %d here; the remaining %d follow in the next message)", len(items), extra)
	}
	// Give the distribution by severity so readers see at a glance whether there are critical items. Count only the items **actually included in this message**,
	// so that "Critical 3" matches the items that can be counted below.
	counts := map[string]int{}
	for _, it := range items {
		counts[it.Severity]++
	}
	var parts []string
	for _, sev := range []string{"critical", "high", "medium", "low"} {
		if n := counts[sev]; n > 0 {
			parts = append(parts, fmt.Sprintf("%s %d", SeverityLabel(sev), n))
		}
	}
	if len(parts) > 0 {
		b.WriteString("\n" + strings.Join(parts, " · "))
	}
	b.WriteString("\n\n")
	return b.String()
}

// writeItem renders a single finding entry.
//
// prefix is the sequence number in digest lists; single=true renders the full version (with summary and backlink),
// while digest lists render only a one-line summary, otherwise a 50-item digest would become a long document.
//
// All externally sourced content (title/class/assets/summary) goes through markdownText:
// single-line + escaping. The backlink is built from the admin-configured public_base_url, is not untrusted content,
// and must be a clickable link, so it is output as-is.
func writeItem(b *strings.Builder, it Item, prefix string, single bool) {
	line := fmt.Sprintf("%s**%s · %s**", prefix, SeverityLabel(it.Severity), markdownText(it.Title(), 0))
	if !single {
		// Digest mode: rendered on one line, with assets and summary compressed after it.
		var extras []string
		if a := assetLine(it.Assets, maxAssetsShown); a != "" {
			extras = append(extras, markdownText(a, 0))
		}
		if it.Summary != "" {
			extras = append(extras, markdownText(it.Summary, 60))
		}
		if len(extras) > 0 {
			line += " — " + strings.Join(extras, " · ")
		}
		b.WriteString(line + "\n")
		return
	}
	b.WriteString(line + "\n")
	if it.IsStatusChange() {
		fmt.Fprintf(b, "**Status**: %s → %s\n",
			markdownText(StatusLabel(it.FromStatus), 0), markdownText(StatusLabel(it.ToStatus), 0))
	}
	if it.VulnClass != "" && it.VulnClass != it.Title() {
		fmt.Fprintf(b, "**Type**: %s\n", markdownText(it.VulnClass, 0))
	}
	if a := assetLine(it.Assets, maxAssetsShown); a != "" {
		fmt.Fprintf(b, "**Assets**: %s\n", markdownText(a, 0))
	}
	if it.Summary != "" {
		if s := markdownText(it.Summary, maxSummaryRunes); s != "" {
			fmt.Fprintf(b, "**Summary**: %s\n", s)
		}
	}
	if it.DetailURL != "" {
		fmt.Fprintf(b, "[View details](%s)\n", it.DetailURL)
	}
}
