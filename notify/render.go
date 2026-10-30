package notify

import (
	"strings"
	"unicode/utf8"
)

const ellipsis = "…"

// TruncateBytes truncates s to at most max bytes, guaranteeing valid UTF-8 without splitting characters.
//
// Why cutting on character boundaries is required: WeCom group robot markdown has a hard 4096 **byte** limit (not
// characters), and a Chinese character is 3 bytes. Slicing by bytes directly splits a character in half and produces invalid
// UTF-8, which the platform either rejects entirely or displays as garbage boxes. The approach here is to step back from the budget position
// to the nearest rune start byte (utf8.RuneStart detects continuation bytes 0b10xxxxxx).
//
// max<=0 means no limit. An ellipsis is appended after truncation, unless max is too small to hold it.
func TruncateBytes(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	budget := max - len(ellipsis)
	suffix := ellipsis
	if budget < 0 {
		// max is shorter than the ellipsis: drop the ellipsis and truncate plainly, so the result does not exceed max.
		budget = max
		suffix = ""
	}
	cut := budget
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + suffix
}

// OneLine squeezes multi-line text into a single line: collapse all whitespace, then truncate by character count.
// Used for IM message title lines: summaries often contain newlines, which would break the layout if put into tables/titles directly.
// max<=0 means no length limit.
func OneLine(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	return TruncateRunes(s, max)
}

// TruncateRunes truncates s to at most max characters (not bytes), appending an ellipsis when it exceeds.
// max<=0 means no limit.
//
// The difference from TruncateBytes is the platform's measure: WeCom limits by bytes, Telegram by character count.
// Using the wrong measure produces no error, it only makes messages cut far shorter than expected (1 Chinese character = 3 bytes,
// cutting at 4096 bytes leaves only about 1365 characters), so both functions must be kept and chosen per channel.
func TruncateRunes(s string, max int) string {
	if max <= 0 {
		return s
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	if max <= 1 {
		return string(runes[:max])
	}
	return string(runes[:max-1]) + ellipsis
}

// TruncateHTML truncates an HTML fragment by character count while guaranteeing no half-cut tags.
//
// Truncating HTML by characters directly can produce broken tags like `<a href="htt`, and the platform parser either
// rejects the whole message or swallows the following text as an attribute value. The approach here: truncate by characters first,
// then check whether the tail has an unclosed `<`, and if so step back to before it.
//
// No tag balancing (adding </b> etc.): Telegram's HTML parser closes unclosed tags automatically,
// while implementing balancing ourselves would mean handling quotes in attributes, comments and self-closing tags, out of proportion to the benefit.
func TruncateHTML(s string, max int) string {
	if max <= 0 || len([]rune(s)) <= max {
		return s
	}
	cut := TruncateRunes(s, max)
	// If the tail is a fragment starting with `<` (no `>` after the last `<`), step back to before the `<`.
	if lt := strings.LastIndex(cut, "<"); lt >= 0 && !strings.Contains(cut[lt:], ">") {
		cut = cut[:lt]
	}
	// If the tail is a cut-off HTML entity (e.g. `&amp;` cut to `&amp`), step back as well.
	// An entity fragment can make a strict entity-aware parser reject the **whole message**, and digest messages exceeding
	// the length limit are common, so it is not worth losing a whole notification over it.
	if amp := strings.LastIndex(cut, "&"); amp >= 0 && !strings.Contains(cut[amp:], ";") {
		cut = cut[:amp]
	}
	return cut
}

// packItemCount computes how many items fit **completely** within the budget, so digest messages are packed by whole items.
//
// Why pack by whole items instead of rendering the whole thing and truncating: truncation makes the trailing items vanish,
// while their delivery records would still be marked delivered: invisible in the message and invisible in the delivery history,
// the finding is simply gone. With whole-item packing, items that do not fit stay in the database for the next batch,
// and the kept value the caller gets is the number of items this message actually delivers.
//
// Parameters: maxSize<=0 means no limit; reserve is the amount reserved for the message header/footer;
// size does the measuring (platforms differ: WeCom/DingTalk measure bytes, Telegram measures characters;
// using the wrong measure produces no error, it only compresses Chinese messages far below the limit);
// render renders item idx into its actual text; length varies with content and cannot be estimated.
//
// It returns at least 1 (as long as there are items). Even an extremely long single item must be sent, with the caller's
// final truncation as the backstop; otherwise one overlong finding would leave the whole batch stuck forever.
func packItemCount(items []Item, maxSize, reserve int, footer string, size func(string) int, render func(Item, int) string) int {
	if maxSize <= 0 {
		return len(items)
	}
	budget := maxSize - reserve - size(footer)
	if budget < 0 {
		budget = 0
	}
	used := 0
	for i, it := range items {
		used += size(render(it, i))
		if used > budget && i > 0 {
			return i
		}
	}
	return len(items)
}

// byteSize / runeSize are the two measures for packItemCount, named to avoid bare
// func(s string) int closures at call sites, where it would be hard to tell at a glance which measure is used.
func byteSize(s string) int { return len(s) }
func runeSize(s string) int { return utf8.RuneCountInString(s) }

// assetLine renders the asset list as one line of display text, omitting the rest beyond limit and noting the total.
// One finding may be anchored to dozens of assets; listing them all would overflow the message.
func assetLine(assets []string, limit int) string {
	if len(assets) == 0 {
		return ""
	}
	if limit <= 0 || len(assets) <= limit {
		return strings.Join(assets, ", ")
	}
	return strings.Join(assets[:limit], ", ") + " and " + itoa(len(assets)-limit) + " more"
}

// itoa is a short alias for strconv.Itoa, used only for building display text, to avoid importing strconv everywhere.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
