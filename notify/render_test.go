package notify

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncateBytesKeepsValidUTF8(t *testing.T) {
	// This is the package's most important invariant. WeCom limits by **bytes**, and Chinese is 3 bytes per character;
	// any implementation that hard-cuts by bytes splits a character in half, producing invalid UTF-8 that the platform rejects.
	// Use several mixed CJK/ASCII inputs with coprime lengths to hit every possible cut point.
	inputs := []string{
		"中文测试内容",
		"混合 mixed 内容 content",
		"a中b文c测d试e",
		"🔴🟠🟡🔵", // 4-byte emoji, cutting wrong is more visible
		strings.Repeat("漏洞", 100),
	}
	for _, in := range inputs {
		for max := 1; max <= len(in)+2; max++ {
			got := TruncateBytes(in, max)
			if !utf8.ValidString(got) {
				t.Fatalf("input %q max=%d: produced invalid UTF-8 %q", in, max, got)
			}
			if len(got) > max {
				t.Fatalf("input %q max=%d: result is %d bytes, over the limit", in, max, len(got))
			}
			// Content must not change when not truncated.
			if len(in) <= max && got != in {
				t.Fatalf("input %q max=%d: content changed although within the limit -> %q", in, max, got)
			}
		}
	}
}

func TestTruncateBytesZeroMeansUnlimited(t *testing.T) {
	long := strings.Repeat("x", 10000)
	if got := TruncateBytes(long, 0); got != long {
		t.Fatal("max=0 should mean no limit")
	}
	if got := TruncateBytes(long, -5); got != long {
		t.Fatal("max<0 should mean no limit")
	}
}

func TestTruncateBytesEllipsisBudget(t *testing.T) {
	// When max is smaller than the ellipsis itself, appending the ellipsis must not in turn exceed the limit.
	got := TruncateBytes("abcdefgh", 1)
	if len(got) > 1 {
		t.Fatalf("with max=1 the result %q has length %d, over the limit", got, len(got))
	}
	// The normal case should carry an ellipsis.
	if got := TruncateBytes("abcdefgh", 5); !strings.HasSuffix(got, ellipsis) {
		t.Fatalf("expected an ellipsis, got %q", got)
	}
}

func TestTruncateRunesCountsCharactersNotBytes(t *testing.T) {
	// The difference in measure from TruncateBytes must be kept: Telegram limits by characters,
	// and measuring bytes would cut CJK messages down to a third.
	s := "一二三四五六七八九十"
	got := TruncateRunes(s, 5)
	if n := utf8.RuneCountInString(got); n != 5 {
		t.Fatalf("expected 5 characters, got %d (%q)", n, got)
	}
	// The same string measured in bytes should come out clearly shorter.
	if utf8.RuneCountInString(TruncateBytes(s, 5)) >= 5 {
		t.Fatal("the byte measure should not produce the same character count as the character measure")
	}
}

func TestOneLineCollapsesWhitespace(t *testing.T) {
	got := OneLine("first line\n\nsecond line\twith a tab   and spaces", 0)
	if strings.ContainsAny(got, "\n\t") {
		t.Fatalf("all whitespace should be collapsed, got %q", got)
	}
	if strings.Contains(got, "  ") {
		t.Fatalf("consecutive spaces should not be kept, got %q", got)
	}
	// After truncation (by runes, CJK input) the result must still be readable and valid.
	got = OneLine("一二三四五六七八九十", 4)
	if n := utf8.RuneCountInString(got); n != 4 {
		t.Fatalf("expected 4 characters, got %d (%q)", n, got)
	}
}

func TestTruncateHTMLNeverCutsTagInHalf(t *testing.T) {
	// Truncating HTML directly would cut out fragments like `<a href="htt`, and the platform would reject the whole message.
	s := `<b>标题</b>正文正文正文<a href="https://example.com/very/long/path">查看详情</a>`
	for max := 1; max <= utf8.RuneCountInString(s)+2; max++ {
		got := TruncateHTML(s, max)
		if n := utf8.RuneCountInString(got); max > 0 && n > max {
			t.Fatalf("max=%d: result is %d characters, over the limit", max, n)
		}
		// The tail must not have an unclosed `<` (i.e. a `<` without `>` in the last segment).
		if lt := strings.LastIndex(got, "<"); lt >= 0 && !strings.Contains(got[lt:], ">") {
			t.Fatalf("max=%d: trailing tag was cut -> %q", max, got)
		}
	}
}

func TestAssetLineOmitsExcess(t *testing.T) {
	if got := assetLine(nil, 3); got != "" {
		t.Fatalf("no assets should return an empty string, got %q", got)
	}
	if got := assetLine([]string{"a", "b"}, 3); got != "a, b" {
		t.Fatalf("within the limit everything should be listed, got %q", got)
	}
	// Beyond the limit the total must be noted, otherwise readers do not know how many assets are not listed.
	got := assetLine([]string{"a", "b", "c", "d", "e"}, 2)
	if !strings.Contains(got, "and 3 more") {
		t.Fatalf("should note the remaining 3, got %q", got)
	}
}

func TestSeverityAndStatusLabels(t *testing.T) {
	if AtLeast("", "low") {
		t.Fatal("an empty severity has ordinal 0 and should be blocked by any threshold")
	}
	if !AtLeast("critical", "") {
		t.Fatal("an empty threshold should let it through")
	}
	if got := StatusLabel("fixed"); got != "Fixed" {
		t.Fatalf("wrong status mapping, got %q", got)
	}
	// Unknown statuses are echoed back as-is, no label is made up.
	if got := StatusLabel("weird_status"); got != "weird_status" {
		t.Fatalf("an unknown status should be echoed back as-is, got %q", got)
	}
}

// TestTruncateHTMLNeverCutsEntity covers an omission pointed out by the audit: truncation must avoid not only
// half-cut tags but also cut-off HTML entities.
//
// After `&amp;` is cut to `&amp`, a strict entity-aware parser may reject the **whole** message,
// and overlong digest messages are common, so the cost is too high.
func TestTruncateHTMLNeverCutsEntity(t *testing.T) {
	s := "aaaa&amp;bbbb&lt;cccc&quot;dddd"
	for max := 1; max <= utf8.RuneCountInString(s)+2; max++ {
		got := TruncateHTML(s, max)
		// The tail must not contain an entity fragment "with & but no matching ;".
		if amp := strings.LastIndex(got, "&"); amp >= 0 && !strings.Contains(got[amp:], ";") {
			t.Fatalf("max=%d: entity fragment left at the tail %q", max, got[amp:])
		}
		if strings.Contains(got, "&amp\x00") {
			t.Fatalf("max=%d: malformed entity appeared", max)
		}
	}
}
