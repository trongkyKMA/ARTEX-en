// Package notify implements the IM / email push channel adapter layer for vulnerability findings.
//
// Layering: this package is a **leaf package** that depends only on the standard library. It knows nothing about the database or the server. Channel configs
// come in as map[string]any (matching the notification_channels.config JSONB column),
// and content to push comes in as Message. The benefit of this split: the genuinely error-prone parts, such as signature computation, UTF-8 truncation and filter matching,
// can be unit tested without PostgreSQL, and the host only orchestrates on the server side.
//
// Concurrency contract: Channel implementations must be **stateless**. One Channel instance is shared concurrently by multiple channel configs
// (even multiple robot instances of the same channel); all credentials come in via the cfg argument,
// and things like webhook URLs must not be cached in the implementation's own fields.
package notify

// Channel type identifiers. The values are also the valid set for notification_channels.kind, enforced by a server-side
// allowlist (like findings.status, not a DB CHECK, so channels are easy to add later).
const (
	KindDingTalk = "dingtalk" // DingTalk custom robot
	KindFeishu   = "feishu"   // Feishu (incl. Lark) custom robot
	KindWeCom    = "wecom"    // WeCom group robot
	KindWebhook  = "webhook"  // generic webhook: custom method/headers/JSON template
	KindTelegram = "telegram" // Telegram Bot API
	KindEmail    = "email"    // SMTP email
)

// Event types, matching notification_events.kind.
const (
	EventFindingCreated       = "finding_created"
	EventFindingStatusChanged = "finding_status_changed"
)

// InitKind is the fallback value for an empty kind in config.
const InitKind = KindDingTalk

// severityRank maps finding severity to a comparable ordinal. Unknown severities return 0, so any
// min_severity setting blocks unknown severities: when in doubt, don't push, to avoid flooding with false positives.
var severityRank = map[string]int{
	"low":      1,
	"medium":   2,
	"high":     3,
	"critical": 4,
}

// SeverityRank returns the severity's ordinal; unknown severities return 0.
func SeverityRank(severity string) int { return severityRank[severity] }

// SeverityLabel returns the severity name with an emoji, used in message titles and card colors.
// Unknown severities are echoed back as-is, nothing is made up.
func SeverityLabel(severity string) string {
	switch severity {
	case "critical":
		return "🔴 Critical"
	case "high":
		return "🟠 High"
	case "medium":
		return "🟡 Medium"
	case "low":
		return "🔵 Low"
	default:
		return severity
	}
}

// StatusLabel turns a triage status into a readable label, used in status change messages.
func StatusLabel(status string) string {
	switch status {
	case "pending":
		return "Pending"
	case "in_progress":
		return "In progress"
	case "confirmed":
		return "Confirmed"
	case "resolved":
		return "Resolved"
	case "fixed":
		return "Fixed"
	case "false_positive":
		return "False positive"
	case "ignored":
		return "Ignored"
	case "duplicate":
		return "Duplicate"
	case "risk_accepted":
		return "Risk accepted"
	default:
		return status
	}
}

// AtLeast reports whether severity reaches the min threshold. An empty min means no threshold and always passes.
// Note that an unknown severity has ordinal 0 and is rejected by any non-empty min (see the severityRank comment).
func AtLeast(severity, min string) bool {
	if min == "" {
		return true
	}
	return SeverityRank(severity) >= SeverityRank(min)
}
