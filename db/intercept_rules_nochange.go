package db

import (
	"encoding/json"
	"fmt"
)

// noChangeRule is one rule of the v4 "no credential or configuration change" pack.
// They are ordinary intercept rules (tool_input + regex), so each one can be turned
// on or off on the intercept rules page like the other [builtin] rules.
type noChangeRule struct {
	name    string
	pattern string
	action  string // deny | ask
	message string
}

// Rules match the whole tool input JSON, so they also apply to Write/Edit content:
// a script written to change a password is stopped when it is written, not only
// when it runs. ">" is matched in both raw and JSON-escaped (\u003e) form.
var noChangeInterceptRules = []noChangeRule{
	{
		name:    "[builtin][no-change] Change account passwords",
		pattern: `(?i)(?:(?:^|[;&|"'(\x60]|\\u0026)\s*|\b(?:sudo|doas)\s+(?:-\S+\s+)*|\bssh\b[^\n]{0,160}\s)(?:passwd|chpasswd|smbpasswd|kpasswd|ldappasswd|(?:impacket-)?changepasswd(?:\.py)?)(?:[\s;&|"'\\)]|$)|\bsetuserinfo2?\b|\bSet-ADAccountPassword\b|\bSet-LocalUser\b[^\n]{0,120}-Password\b|\bmysqladmin\b[^\n]{0,120}\bpassword\b|\bnet\s+user\s+[^\s/"\\]+\s+[^\s/"\\]|\busermod\b[^\n]{0,60}\s-p\s|\bbloodyAD\b[^\n]{0,200}\bset\s+password\b|\bipa\s+passwd\b`,
		action:  "deny",
		message: "Changing or resetting account passwords on the target is forbidden in this engagement (passwd / chpasswd / net user / Set-ADAccountPassword / changepasswd / setuserinfo ...)",
	},
	{
		name:    "[builtin][no-change] Change database users and privileges",
		pattern: `(?i)\bALTER\s+(?:USER|ROLE|LOGIN)\s+\S|\bSET\s+PASSWORD\s*(?:FOR\s|=)|\bCREATE\s+(?:USER|LOGIN|ROLE)\s+['"]?[\w@%.-]+['"]?(?:@|\s+(?:IDENTIFIED|PASSWORD|LOGIN|FROM\s+LOGIN|WITH\s+(?:(?:UN)?ENCRYPTED\s+)?(?:PASSWORD|LOGIN|SUPERUSER|CREATEDB|CREATEROLE))\b)|\b(?:GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|SELECT|INSERT|UPDATE|DELETE|EXECUTE|USAGE|CREATE|ALTER|DROP|SUPER|FILE|PROCESS|RELOAD|REPLICATION|CONNECT|RESOURCE|DBA|SYSADMIN)\b[^;\n]{0,120}\s(?:ON|TO|FROM)\s|\bsp_(?:password|addlogin|addsrvrolemember|addrolemember)\b|\bUPDATE\s+[\w.\[\]"]+\s+SET\b[^;\n]{0,200}\b(?:pass(?:word|wd)?|pwd|hash|role|is_?admin|privileges?)\b`,
		action:  "deny",
		message: "Changing database accounts, passwords or privileges on the target is forbidden in this engagement (ALTER USER / SET PASSWORD / CREATE USER / GRANT / REVOKE / UPDATE of password or role columns)",
	},
	{
		name:    "[builtin][no-change] Change OS and directory accounts or groups",
		pattern: `(?i)\b(?:useradd|adduser|userdel|groupadd|groupmod|gpasswd|New-ADUser|Set-ADUser|Add-ADGroupMember|Remove-ADGroupMember|New-LocalUser|Add-LocalGroupMember)\b|\busermod\s+-|\bnet\s+(?:localgroup|group)\s+[^\n]{1,120}/(?:add|del(?:ete)?)\b|\bnet\s+user\s+[^\n]{1,120}/(?:add|del(?:ete)?|active:)|\b(?:impacket-)?addcomputer(?:\.py)?\b|--(?:escalate-user|add-computer|shadow-credentials|delegate-access)\b|\bldap(?:modify|add|delete)\b|\b(?:dacledit|owneredit|rbcd)(?:\.py)?\b[^\n]{0,160}-action\s+write|\bpywhisker\b[^\n]{0,120}--action\s+add|\bbloodyAD\b[^\n]{0,200}\s(?:add|set|remove)\s+\w`,
		action:  "deny",
		message: "Creating, deleting or changing accounts, groups, machine accounts or ACLs on the target is forbidden in this engagement (useradd / net localgroup /add / ldapmodify / addcomputer / ntlmrelayx --escalate-user ...)",
	},
	{
		name:    "[builtin][no-change] Change services, firewall or system configuration",
		pattern: `(?i)\bsystemctl\s+(?:stop|disable|mask|restart|edit|set-property|kill)\b|\bservice\s+\S+\s+(?:stop|restart)\b|\bsc(?:\.exe)?\s+(?:\\\\\S+\s+)?(?:config|stop|delete|create)\b|\b(?:iptables|ip6tables)\s+(?:-t\s+\w+\s+)?(?:-[ADIPRXFZN]\b|--(?:append|delete|insert|policy|replace|flush|zero|new-chain|delete-chain))|\bnft\s+(?:add|delete|insert|replace|flush)\b|\bufw\s+(?:disable|allow|deny|delete|reset|default)\b|\bfirewall-cmd\b[^\n]{0,120}--(?:add|remove|set|reload|panic)|\bnetsh\b[^\n]{0,80}\s(?:set|add|delete)\s|\bsysctl\s+-w\b|\bcrontab\s+(?:-r\b|-e\b|-(?:["\\\s)]|$))|\breg(?:\.exe)?\s+(?:add|delete|import)\b|\bimpacket-reg\b[^\n]{0,200}\s(?:add|delete)\b|\bSet-ItemProperty\b|\bsed\s+-i\b[^\n]{0,200}\s/etc/|(?:>|\\u003e){1,2}\s*/etc/|(?:>|\\u003e){1,2}\s*\S*authorized_keys|\bsnmpset\b|\bconfigure\s+terminal\b|\bwrite\s+mem(?:ory)?(?:\s*[;"'\\]|$)|\bcopy\s+run(?:ning-config)?\s+start`,
		action:  "deny",
		message: "Changing services, firewall rules, scheduled tasks, registry or system/network-device configuration on the target is forbidden in this engagement (systemctl stop / iptables / crontab / reg add / sed -i /etc / authorized_keys / snmpset / configure terminal ...)",
	},
	{
		name:    "[builtin][no-change] Change Redis / database runtime configuration",
		pattern: `(?i)\bCONFIG\s+(?:SET|REWRITE|RESETSTAT)\b|\b(?:SLAVEOF|REPLICAOF)\s+\S|\bMODULE\s+LOAD\b|\bALTER\s+SYSTEM\b|\bSET\s+GLOBAL\s+\w`,
		action:  "deny",
		message: "Changing the runtime configuration of the target's Redis or database is forbidden in this engagement (CONFIG SET / SLAVEOF / MODULE LOAD / ALTER SYSTEM / SET GLOBAL)",
	},
	{
		name:    "[builtin][no-change] Password-change and configuration HTTP endpoints",
		pattern: `(?i)/[\w./-]*(?:change|reset|set|update)[-_]?pass(?:word|wd)?\b|/users?/[^/\s"']+/pass(?:word|wd)?\b|(?:-X\s*|--request\s+)(?:POST|PUT|PATCH)\b[^\n]{0,300}/(?:actuator/|_cluster/settings|_settings\b)|/(?:actuator/(?:env|refresh|restart|pause|loggers)|_cluster/settings)[^\s"']*[^\n]{0,300}(?:-X\s*|--request\s+)(?:POST|PUT|PATCH)\b|/actuator/(?:env|refresh|restart|pause|loggers)[^\n]{0,300}\s(?:-d|--data(?:-raw|-binary)?|--json)\s`,
		action:  "deny",
		message: "Calling password-change/reset endpoints or writing to configuration endpoints (Spring Actuator env/refresh/restart, Elasticsearch settings) is forbidden in this engagement",
	},
	{
		name:    "[builtin][no-change] Change containers and clusters",
		pattern: `(?i)\bkubectl\b[^\n]{0,200}\s(?:apply|create|delete|edit|patch|replace|scale|set|drain|cordon|uncordon|label|annotate|taint)\s|\bkubectl\b[^\n]{0,200}\srollout\s+(?:restart|undo|pause)\b|\bdocker\s+(?:-H|--host)[=\s]?\S+[^\n]{0,100}\s(?:stop|kill|rm|restart|update|pause|run|create|exec)\b|\bhelm\s+(?:install|upgrade|uninstall|rollback|delete)\b`,
		action:  "deny",
		message: "Changing the target's Kubernetes, Docker or Helm deployments is forbidden in this engagement (kubectl apply/scale/delete/patch, docker -H ... stop/run, helm install/upgrade ...)",
	},
	{
		name:    "[builtin][no-change] Remote execution that creates services or tasks",
		pattern: `(?i)\b(?:impacket-)?(?:psexec|smbexec|atexec|dcomexec)(?:\.py)?\b|--exec-method\s+(?:smbexec|atexec)\b|\bschtasks\b[^\n]{0,60}/(?:create|change|delete)\b`,
		action:  "ask",
		message: "This remote-execution method creates a service or scheduled task on the target (a configuration change); a human must approve it",
	},
	{
		name:    "[builtin][no-change] Obfuscated shell execution",
		pattern: `(?i)\bbase64\s+(?:-d|--decode)\b[^\n]{0,60}\|\s*(?:ba|z|da|k)?sh\b`,
		action:  "ask",
		message: "Decoding and piping a command into a shell hides what it does from the other rules; a human must approve it",
	},
}

// noChangeAskTimeoutSeconds bounds how long an "ask" rule of this pack waits for a
// human before it denies, so an unattended worker does not hang forever.
const noChangeAskTimeoutSeconds = 300

// seedDefaultInterceptRulesV4 adds the "no credential or configuration change" pack.
// The v1-v3 built-in rules only block destruction (rm -rf, DROP, DELETE ...): every
// password change and configuration change fell through to the LLM judge, which is
// off by default. Gated by its own flag and inserted by name, so a rule the user
// disables or deletes is never re-enabled or re-created on restart.
func (d *DB) seedDefaultInterceptRulesV4() error {
	if v, _, _ := d.GetSetting("intercept_default_rules_v4"); v == "done" {
		return nil
	}
	for _, r := range noChangeInterceptRules {
		timeoutEnabled := r.action == "ask"
		if _, err := d.Exec(`
INSERT INTO intercept_rules(name, enabled, priority, match_target, match_type, pattern, action, message, timeout_enabled, timeout_seconds, timeout_action)
SELECT $1, true, 95, 'tool_input', 'regex', $2, $3, $4, $5, $6, 'deny'
WHERE NOT EXISTS (SELECT 1 FROM intercept_rules WHERE name = $1)`,
			r.name, r.pattern, r.action, r.message, timeoutEnabled, noChangeAskTimeoutSeconds,
		); err != nil {
			return fmt.Errorf("rule %q: %w", r.name, err)
		}
	}
	return d.SetSetting("intercept_default_rules_v4", "done")
}

// migrateInterceptMonitorTool puts the Monitor tool under intercept on a database
// that already saved its intercept tool list. Monitor runs an arbitrary shell
// command like Bash but was missing from the list, so every rule and the LLM judge
// were bypassed through it. Runs once (own flag): if the user later turns Monitor
// off on the intercept page, that choice is kept.
func (d *DB) migrateInterceptMonitorTool() error {
	if v, _, _ := d.GetSetting("intercept_enabled_tools_monitor_v1"); v == "done" {
		return nil
	}
	val, ok, err := d.GetSetting("intercept_enabled_tools")
	if err != nil {
		return err
	}
	if ok { // nothing saved → the code default, which already includes Monitor
		var names []string
		if err := json.Unmarshal([]byte(val), &names); err != nil {
			return fmt.Errorf("intercept_enabled_tools: %w", err)
		}
		has := false
		for _, n := range names {
			if n == "Monitor" {
				has = true
				break
			}
		}
		if !has {
			b, _ := json.Marshal(append(names, "Monitor"))
			if err := d.SetSetting("intercept_enabled_tools", string(b)); err != nil {
				return err
			}
		}
	}
	return d.SetSetting("intercept_enabled_tools_monitor_v1", "done")
}
