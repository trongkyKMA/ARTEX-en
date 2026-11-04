package server

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Autumn-27/artex/db"
)

func TestSetupTokenLifecycle(t *testing.T) {
	dir := t.TempDir()
	s := &Server{}
	s.initSetupToken(dir) // no DB: password state unknown → token created
	raw, err := os.ReadFile(filepath.Join(dir, setupTokenFilename))
	if err != nil {
		t.Fatalf("setup token file not written: %v", err)
	}
	tok := strings.TrimSpace(string(raw))
	if len(tok) != setupTokenLen {
		t.Fatalf("token length %d", len(tok))
	}
	if info, _ := os.Stat(filepath.Join(dir, setupTokenFilename)); info.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Errorf("token file must not be readable by others: %v", info.Mode())
	}
	for _, bad := range []string{"", "x", tok[:len(tok)-1], tok + "x"} {
		if s.checkSetupToken(bad) {
			t.Errorf("accepted wrong token %q", bad)
		}
	}
	if !s.checkSetupToken(" " + tok + "\n") {
		t.Fatal("the token from the file must be accepted")
	}
	s.consumeSetupToken()
	if s.checkSetupToken(tok) {
		t.Fatal("a consumed token must be rejected")
	}
	if _, err := os.Stat(filepath.Join(dir, setupTokenFilename)); !os.IsNotExist(err) {
		t.Fatal("token file must be removed once used")
	}
}

// First-run init needs the setup token; with it the password is set and the token is gone.
func TestAuthInitRequiresSetupToken(t *testing.T) {
	dsn, _, err := db.DSN()
	if err != nil {
		t.Skip("no test database configured")
	}
	d, err := db.Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	old, had, _ := d.GetSetting(authPassKey)
	t.Cleanup(func() {
		if had {
			_ = d.SetSetting(authPassKey, old)
		} else {
			_, _ = d.Exec(`DELETE FROM settings WHERE key=$1`, authPassKey)
		}
	})
	if _, err := d.Exec(`DELETE FROM settings WHERE key=$1`, authPassKey); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	s := &Server{m: &Manager{pg: d}, jwtKey: []byte("setup-token-test-key-0123456789ab")}
	s.initSetupToken(dir)
	raw, _ := os.ReadFile(filepath.Join(dir, setupTokenFilename))
	tok := strings.TrimSpace(string(raw))

	init := func(body string) int {
		w := httptest.NewRecorder()
		s.authInit(w, httptest.NewRequest("POST", "/api/auth/init", strings.NewReader(body)))
		return w.Code
	}
	if code := init(`{"password":"correct horse battery"}`); code != 403 {
		t.Fatalf("init without setup token: %d, want 403", code)
	}
	if code := init(`{"password":"correct horse battery","setup_token":"guess"}`); code != 403 {
		t.Fatalf("init with a wrong setup token: %d, want 403", code)
	}
	if v, _, _ := d.GetSetting(authPassKey); v != "" {
		t.Fatal("a rejected init must not set the password")
	}
	if code := init(`{"password":"correct horse battery","setup_token":"` + tok + `"}`); code != 200 {
		t.Fatalf("init with the setup token: %d, want 200", code)
	}
	if _, err := os.Stat(filepath.Join(dir, setupTokenFilename)); !os.IsNotExist(err) {
		t.Fatal("token file must be removed after init")
	}
	// A restart with the password set leaves no token behind.
	_ = os.WriteFile(filepath.Join(dir, setupTokenFilename), []byte("stale"), 0o600)
	s2 := &Server{m: &Manager{pg: d}}
	s2.initSetupToken(dir)
	if _, err := os.Stat(filepath.Join(dir, setupTokenFilename)); !os.IsNotExist(err) {
		t.Fatal("a stale token file must be removed when the password is set")
	}
}
