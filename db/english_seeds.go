package db

import (
	"fmt"
	"regexp"
)

// English fork: every built-in seed is first-insert only (so user edits survive restarts), which means a
// database first initialised by an upstream build keeps that build's Chinese built-in rows. The helpers
// here rewrite built-in rows that still contain Chinese to the English code defaults. A row without
// Chinese text is never touched, so English edits survive and every helper is idempotent.

// hanPattern matches CJK ideographs. Postgres ARE syntax; passed as a query parameter.
const hanPattern = `[㐀-鿿]`

var hanRE = regexp.MustCompile(`\p{Han}`)

// ContainsHan reports whether s contains Chinese characters.
func ContainsHan(s string) bool { return hanRE.MatchString(s) }

// legacyPromptNote is the version note upstream builds wrote on seeded prompts ("built-in default").
const legacyPromptNote = "内置默认"

// localizeBuiltinRuleSeeds rewrites the name/message of built-in intercept rules and the note of built-in
// asset intercept rules that are still in Chinese. Rows are matched by pattern, which upstream and this
// fork share; a user-written rule only changes if it reuses a built-in pattern and contains Chinese.
func (d *DB) localizeBuiltinRuleSeeds() error {
	type seed struct{ pattern, name, message string }
	var seeds []seed
	for _, r := range defaultInterceptRulesV1 {
		seeds = append(seeds, seed{r.pattern, r.name, r.message})
	}
	for _, r := range defaultInterceptRulesV2 {
		seeds = append(seeds, seed{r.pattern, r.name, r.message})
	}
	seeds = append(seeds, seed{deleteEndpointPathPattern, interceptRuleV3Name, interceptRuleV3Message})
	for _, s := range seeds {
		if _, err := d.Exec(`
UPDATE intercept_rules SET name=$1, message=$2
WHERE pattern=$3 AND (name ~ $4 OR message ~ $4)`, s.name, s.message, s.pattern, hanPattern); err != nil {
			return fmt.Errorf("localize intercept rule %q: %w", s.name, err)
		}
	}
	for _, r := range defaultAssetInterceptRules {
		if _, err := d.Exec(`
UPDATE asset_intercept_rules SET note=$1
WHERE builtin AND kind=$2 AND pattern=$3 AND note ~ $4`, r.note, r.kind, r.pattern, hanPattern); err != nil {
			return fmt.Errorf("localize asset intercept rule %q: %w", r.pattern, err)
		}
	}
	return nil
}

// ReplaceChinesePrompt appends tmpl as the agent's new current prompt version when the current one
// contains Chinese (the old version stays in the history and can be restored). Reports whether it did.
func (d *DB) ReplaceChinesePrompt(agentID int64, tmpl string) (bool, error) {
	cur, err := d.CurrentPrompt(agentID)
	if err != nil || !ContainsHan(cur) || ContainsHan(tmpl) {
		return false, err
	}
	if _, err := d.SavePrompt(agentID, tmpl, "Built-in default (English)", "system"); err != nil {
		return false, err
	}
	return true, nil
}

// LocalizePromptNotes renames the upstream "built-in default" version note in prompt histories.
func (d *DB) LocalizePromptNotes() error {
	_, err := d.Exec(`UPDATE agent_prompts SET note='Built-in default' WHERE note=$1`, legacyPromptNote)
	return err
}

// LocalizeAgentText sets the name and description of an agent seeded by the server (not a builtinAgents
// entry, which seedBuiltins upserts anyway) when either still contains Chinese.
func (d *DB) LocalizeAgentText(key, name, description string) error {
	_, err := d.Exec(`
UPDATE agents SET name=$2, description=$3
WHERE key=$1 AND (name ~ $4 OR COALESCE(description,'') ~ $4)`, key, name, description, hanPattern)
	return err
}
