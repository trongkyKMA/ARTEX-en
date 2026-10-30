package server

import (
	"log"

	"github.com/Autumn-27/artex/agent"
	"github.com/Autumn-27/artex/db"
)

// localizeLegacyChineseSeeds brings a database first initialised by an upstream (Chinese) build to the
// English defaults. Prompt and agent seeds are first-insert only, so without this the fork would keep
// running the Chinese prompts stored there. Only rows that still contain Chinese are rewritten, so it is
// idempotent and leaves English edits alone; a replaced prompt stays in the version history.
// Built-in tools and intercept rules are handled by db.SeedTool and db.seedBuiltins.
func (s *Server) localizeLegacyChineseSeeds() {
	pg := s.m.pg
	prompts := agent.BuiltinPromptSeeds()
	prompts["reporter"] = agent.ReporterDefaultPrompt
	prompts[db.FindingRetestAgentKey] = agent.RetesterDefaultPrompt
	for key, tmpl := range prompts {
		a, err := pg.GetAgentByKey(key)
		if err != nil || a == nil {
			continue
		}
		replaced, err := pg.ReplaceChinesePrompt(a.ID, tmpl)
		if err != nil {
			log.Printf("[i18n] replace Chinese prompt of %s: %v", key, err)
		} else if replaced {
			log.Printf("[i18n] prompt of %s replaced with the English default (old version kept in history)", key)
		}
	}
	if err := pg.LocalizePromptNotes(); err != nil {
		log.Printf("[i18n] localize prompt notes: %v", err)
	}
	if err := pg.LocalizeAgentText("reporter", reporterAgentName, reporterAgentDescription); err != nil {
		log.Printf("[i18n] localize reporter agent: %v", err)
	}
	if err := pg.LocalizeAgentText(db.FindingRetestAgentKey, retesterAgentName, retesterAgentDescription); err != nil {
		log.Printf("[i18n] localize retester agent: %v", err)
	}
	triggers, err := pg.ListTriggersFor("reporter")
	if err != nil {
		log.Printf("[i18n] read reporter triggers: %v", err)
		return
	}
	for _, t := range triggers {
		if !t.OnToolCall || !db.ContainsHan(t.ToolCallMessage) {
			continue
		}
		t.ToolCallMessage = reporterToolCallMessage
		if err := pg.UpdateTrigger(t); err != nil {
			log.Printf("[i18n] localize reporter trigger: %v", err)
		}
	}
}
