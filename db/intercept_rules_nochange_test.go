package db

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

// toolInputs returns the tool input JSON the way a model sends it (raw ">" and "&")
// and the way Go's encoder escapes it (>, &), since rules match that string.
func toolInputs(key, value string) []string {
	var raw bytes.Buffer
	enc := json.NewEncoder(&raw)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(map[string]string{key: value})
	escaped, _ := json.Marshal(map[string]string{key: value})
	return []string{strings.TrimSpace(raw.String()), string(escaped)}
}

func noChangeMatch(input string) (noChangeRule, bool) {
	for _, r := range noChangeInterceptRules {
		if regexp.MustCompile(r.pattern).MatchString(input) {
			return r, true
		}
	}
	return noChangeRule{}, false
}

func TestNoChangeRulesBlockCredentialAndConfigChanges(t *testing.T) {
	cases := []struct{ cmd, action string }{
		// passwords
		{`passwd admin`, "deny"},
		{`echo 'root:NewP@ss1' | chpasswd`, "deny"},
		{`usermod -p '$6$abc$xyz' root`, "deny"},
		{`net user administrator P@ssw0rd123 /domain`, "deny"},
		{`mysql -h 10.0.0.5 -u root -pX -e "ALTER USER 'app'@'%' IDENTIFIED BY 'n3w'"`, "deny"},
		{`mysql -h 10.0.0.5 -e "SET PASSWORD FOR 'root'@'localhost' = 'n3w'"`, "deny"},
		{`psql -h 10.0.0.6 -U postgres -c "ALTER ROLE postgres PASSWORD 'n3w'"`, "deny"},
		{`redis-cli -h 10.0.0.7 CONFIG SET requirepass x`, "deny"},
		{`smbpasswd -r 10.0.0.10 -U jdoe`, "deny"},
		{`impacket-changepasswd corp.local/jdoe:Old1@10.0.0.10 -newpass 'New123!'`, "deny"},
		{`bloodyAD -d corp.local -u a -p b --host 10.0.0.10 set password victim 'New123!'`, "deny"},
		{`rpcclient -U 'a%b' 10.0.0.10 -c "setuserinfo2 victim 23 'New123!'"`, "deny"},
		{`pwsh -c "Set-ADAccountPassword -Identity jdoe -Reset -NewPassword $p"`, "deny"},
		{`ldapmodify -H ldap://10.0.0.10 -D cn=admin -w x -f chpw.ldif`, "deny"},
		{`curl -X POST http://10.0.0.20/api/users/1/password -d '{"password":"x"}'`, "deny"},
		{`curl -X PUT 'http://10.0.0.20/admin/resetPassword?user=admin&new=x'`, "deny"},
		{`nxc smb 10.0.0.0/24 -u u -p p -x "net user admin Xx123456"`, "deny"},
		// accounts, privileges
		{`mysql -h 10.0.0.5 -e "UPDATE users SET role='admin' WHERE id=5"`, "deny"},
		{`mysql -h 10.0.0.5 -e "GRANT ALL ON *.* TO 'x'@'%'"`, "deny"},
		{`mysql -e "CREATE USER 'x'@'%' IDENTIFIED BY 'y'"`, "deny"},
		{`psql -h 10.0.0.6 -c "CREATE USER pentest WITH SUPERUSER PASSWORD 'y'"`, "deny"},
		{`sqlcmd -S 10.0.0.11 -Q "CREATE LOGIN pentest WITH PASSWORD='y'"`, "deny"},
		{`sudo passwd root`, "deny"},
		{`ssh root@10.0.0.8 passwd admin`, "deny"},
		{`id && passwd admin`, "deny"},
		{`nxc smb 10.0.0.10 -u admin -p pw -x "net localgroup administrators pentest /add"`, "deny"},
		{`ssh root@10.0.0.8 'useradd -o -u 0 backdoor'`, "deny"},
		{`impacket-ntlmrelayx -t ldap://10.0.0.10 --escalate-user pentest`, "deny"},
		{`impacket-addcomputer corp.local/jdoe:pw -computer-name 'EVIL$' -dc-ip 10.0.0.10`, "deny"},
		// configuration
		{`ssh root@10.0.0.8 "sed -i 's/PermitRootLogin no/PermitRootLogin yes/' /etc/ssh/sshd_config"`, "deny"},
		{`ssh root@10.0.0.8 "echo 'ssh-rsa AAAA test' >> /root/.ssh/authorized_keys"`, "deny"},
		{`ssh root@10.0.0.8 "echo 'nameserver 1.2.3.4' > /etc/resolv.conf"`, "deny"},
		{`redis-cli -h 10.0.0.7 CONFIG SET dir /var/spool/cron`, "deny"},
		{`curl -X POST http://10.0.0.9:8080/actuator/env -H 'Content-Type: application/json' -d '{"name":"a","value":"b"}'`, "deny"},
		{`curl http://10.0.0.9:8080/actuator/refresh -X POST`, "deny"},
		{`snmpset -v2c -c private 10.0.0.1 1.3.6.1.2.1.1.5.0 s x`, "deny"},
		{`ssh admin@10.0.0.1 'configure terminal ; no ip access-list extended MGMT'`, "deny"},
		{`ssh root@10.0.0.8 'iptables -P INPUT ACCEPT'`, "deny"},
		{`ssh root@10.0.0.8 'systemctl stop firewalld'`, "deny"},
		{`ssh root@10.0.0.8 "(crontab -l; echo '* * * * * /tmp/x') | crontab -"`, "deny"},
		{`impacket-reg corp/admin:pw@10.0.0.10 add -keyName 'HKLM\SYSTEM\X' -v Y -vt REG_DWORD -vd 0`, "deny"},
		{`kubectl -s https://10.0.0.30:6443 scale deploy web --replicas=0`, "deny"},
		{`docker -H tcp://10.0.0.31:2375 stop web`, "deny"},
		{`curl -X PUT http://10.0.0.40:9200/_cluster/settings -d '{}'`, "deny"},
		// ask
		{`impacket-psexec corp/admin:pw@10.0.0.10 whoami`, "ask"},
		{`echo cGFzc3dkIGFkbWlu | base64 -d | sh`, "ask"},
	}
	for _, c := range cases {
		for _, in := range toolInputs("command", c.cmd) {
			r, ok := noChangeMatch(in)
			if !ok {
				t.Errorf("not blocked: %s", in)
				continue
			}
			if r.action != c.action {
				t.Errorf("%s: action %s (%s), want %s", in, r.action, r.name, c.action)
			}
		}
	}
}

// Recon, credential capture and read-only commands of an internal scan, and prose
// a worker writes into notes, must not be blocked.
func TestNoChangeRulesAllowReadOnlyWork(t *testing.T) {
	commands := []string{
		`net user jdoe /domain`,
		`net user /domain`,
		`net localgroup administrators`,
		`cat /etc/passwd`,
		`grep root /etc/passwd > /tmp/users.txt`,
		`curl -s http://10.0.0.9:8080/actuator/env`,
		`curl -s http://10.0.0.9:8080/actuator/health`,
		`nxc smb 10.0.0.0/24 -u u -p p --shares`,
		`nxc smb 10.0.0.10 -u admin -p pw --sam`,
		`impacket-secretsdump corp/admin:pw@10.0.0.10`,
		`impacket-GetUserSPNs corp.local/jdoe:pw -request -dc-ip 10.0.0.10`,
		`impacket-wmiexec corp/admin:pw@10.0.0.10 whoami`,
		`ldapsearch -x -H ldap://10.0.0.10 -b dc=corp,dc=local '(objectClass=user)'`,
		`mysql -h 10.0.0.5 -u root -pX -e "SELECT user,host FROM mysql.user"`,
		`mysql -h 10.0.0.5 -e "SHOW GRANTS FOR 'app'@'%'"`,
		`redis-cli -h 10.0.0.7 CONFIG GET '*'`,
		`kubectl -s https://10.0.0.30:6443 get pods -A -o wide`,
		`snmpwalk -v2c -c public 10.0.0.1`,
		`grep -ri password /var/www/html/config`,
		`curl -X POST http://10.0.0.20/login -d 'user=admin&password=admin'`,
		`curl -s 'http://10.0.0.20/forgot?email=x'`,
		`curl http://10.0.0.20/api/users/1`,
		`sqlmap -u "http://10.0.0.20/item?id=1" --batch --dbs`,
		`hashcat -m 1000 ntlm.txt rockyou.txt`,
		`hydra -l admin -P top100.txt -t 4 ssh://10.0.0.8`,
		`nmap -sV -T3 10.0.0.0/24`,
		`nmap --script smb-vuln* -p445 10.0.0.0/24`,
		`ssh root@10.0.0.8 'cat /etc/ssh/sshd_config'`,
		`iptables -L -n`,
		`systemctl status nginx`,
		`docker ps`,
		`sed -n 1,20p /etc/hosts`,
		`echo dGVzdA== | base64 -d`,
		`kerbrute userenum -d corp.local users.txt --dc 10.0.0.10`,
		`bloodhound-python -d corp.local -u jdoe -p pw -c All -ns 10.0.0.10`,
		`certipy find -u jdoe@corp.local -p pw -dc-ip 10.0.0.10 -vulnerable`,
		`python3 -c "import requests; print(requests.get('http://10.0.0.20/').status_code)"`,
	}
	for _, c := range commands {
		for _, in := range toolInputs("command", c) {
			if r, ok := noChangeMatch(in); ok {
				t.Errorf("read-only command blocked by %q: %s", r.name, in)
			}
		}
	}
	notes := []string{
		"## Finding\nThe admin panel lets any user grant access to the reports module.\nRemediation: create user accounts with least privilege and set password policy to 14 characters.",
		"Observed /etc/passwd entries and the passwd binary version; no changes were made.",
		"The helpdesk can reset passwords for other users (observed in the UI, not exercised).",
	}
	for _, n := range notes {
		for _, in := range toolInputs("content", n) {
			if r, ok := noChangeMatch(in); ok {
				t.Errorf("note blocked by %q: %s", r.name, in)
			}
		}
	}
}

// Seeding twice creates each rule once, and a rule the user disabled stays disabled.
func TestSeedNoChangeRulesIsToggleSafe(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	first := noChangeInterceptRules[0].name
	if _, err := d.Exec(`UPDATE intercept_rules SET enabled=false WHERE name=$1`, first); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.Exec(`UPDATE intercept_rules SET enabled=true WHERE name=$1`, first) })
	if err := d.SetSetting("intercept_default_rules_v4", ""); err != nil {
		t.Fatal(err)
	}
	if err := d.seedDefaultInterceptRulesV4(); err != nil {
		t.Fatal(err)
	}
	for _, r := range noChangeInterceptRules {
		var n int
		var enabled bool
		if err := d.QueryRow(`SELECT count(*), bool_or(enabled) FROM intercept_rules WHERE name=$1`, r.name).Scan(&n, &enabled); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("%s: %d rows, want 1", r.name, n)
		}
		if want := r.name != first; enabled != want {
			t.Errorf("%s: enabled=%v, want %v", r.name, enabled, want)
		}
	}
}

// A saved intercept tool list gets Monitor, mcp__* and @custom once; a user who later
// turns them off keeps that choice on the next start.
func TestMigrateInterceptToolList(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	keys := []string{"intercept_enabled_tools", "intercept_enabled_tools_monitor_v1", "intercept_enabled_tools_wildcards_v2"}
	for _, key := range keys {
		val, ok, _ := d.GetSetting(key)
		key := key
		t.Cleanup(func() {
			if ok {
				_ = d.SetSetting(key, val)
			} else {
				_, _ = d.Exec(`DELETE FROM settings WHERE key=$1`, key)
			}
		})
	}
	list := func() string { v, _, _ := d.GetSetting("intercept_enabled_tools"); return v }

	_ = d.SetSetting("intercept_enabled_tools", `["Bash","Write","mcp__*"]`)
	for _, flag := range keys[1:] {
		_ = d.SetSetting(flag, "")
	}
	if err := d.migrateInterceptToolList(); err != nil {
		t.Fatal(err)
	}
	if got := list(); got != `["Bash","Write","mcp__*","Monitor","@custom"]` {
		t.Fatalf("missing tools not added once: %s", got)
	}
	_ = d.SetSetting("intercept_enabled_tools", `["Bash","Write"]`) // user turns them off
	if err := d.migrateInterceptToolList(); err != nil {
		t.Fatal(err)
	}
	if got := list(); got != `["Bash","Write"]` {
		t.Fatalf("user choice overridden: %s", got)
	}
}
