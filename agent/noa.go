package agent

import (
	"log"
	"path/filepath"

	"github.com/Autumn-27/norma/agentcore"
	"github.com/Autumn-27/norma/noaadapter"
)

// noaWarn returns a diagnostics sink tagging non-fatal noa messages with the
// session, routed through the package logger (agents have no per-instance one).
func noaWarn(session string) func(string) {
	return func(msg string) { log.Printf("[noa] %s: %s", session, msg) }
}

// noa is the "model-driven context compression" mechanism introduced in norma v0.4.0, exposed
// as an experimental platform feature the user toggles in system settings. It is mutually
// exclusive with the built-in compaction: noaadapter.Enable is the only entry point and attaches
// the context takeover (Compactor), the Compress tool and three resident prompt segments in one
// go; not calling Enable means off (built-in compaction works as usual). The toggle is resolved
// by the noaEnabledFn injected into each agent and read once per run, so switching only affects
// runs started afterwards, without rebuilding the agent.

// enableNoa wires noa into opts when the resolver reports it enabled. archiveRoot is the
// persistent base dir for the original compressed text (the global workDir; all agents land
// under <workDir>/noa rather than being scattered across task/intent dirs), and sessionID names
// the archive subdirectory under it (globally unique, so no collisions within one base dir).
//
// noa is experimental: a wiring failure must not interrupt a real task. On error it reports via
// onWarn and falls back to the built-in compaction. On success it clears opts.Compaction so
// agentcore doesn't warn about "two context managers set at once".
func enableNoa(opts *agentcore.Options, enabled func() bool, archiveRoot, sessionID string, onWarn func(string)) {
	if enabled == nil || !enabled() {
		return
	}
	if opts.OnWarn == nil {
		opts.OnWarn = onWarn
	}
	if err := noaadapter.Enable(opts, noaadapter.Options{
		ArchiveBaseDir: filepath.Join(archiveRoot, "noa"),
		SessionID:      sessionID,
		OnWarn:         onWarn,
	}); err != nil {
		if onWarn != nil {
			onWarn("failed to enable noa compression, falling back to built-in compaction: " + err.Error())
		}
		return
	}
	// Compactor overrides Compaction, but agentcore warns every time both are set; clear it explicitly.
	opts.Compaction = nil
}
