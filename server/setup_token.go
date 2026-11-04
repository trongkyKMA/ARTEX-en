package server

import (
	"crypto/rand"
	"crypto/subtle"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// The admin password is set by the first POST /api/auth/init, which needs no login.
// Without a second factor whoever reached a fresh install first owned it (and its
// command execution). The init request must therefore carry a one-time setup token
// that is only readable on the host: it is written to <keyDir>/setup.token and never
// logged or returned by the API.

const (
	setupTokenFilename = "setup.token"
	setupTokenLen      = 32
)

type setupGate struct {
	mu    sync.Mutex
	path  string
	token string
}

// initSetupToken creates the setup token when no admin password is set yet, and
// removes a leftover token file once one is. A database that cannot be read counts
// as "not set": authInit still refuses on that error, the token only adds a gate.
func (s *Server) initSetupToken(keyDir string) {
	s.setup.path = filepath.Join(keyDir, setupTokenFilename)
	if s.m != nil && s.m.pg != nil {
		if hash, _, err := s.m.pg.GetSetting(authPassKey); err == nil && hash != "" {
			_ = os.Remove(s.setup.path)
			return
		}
	}
	tok, err := randomSetupToken()
	if err != nil {
		log.Printf("[auth] cannot generate the setup token, first-run setup is disabled: %v", err)
		return
	}
	if err := os.WriteFile(s.setup.path, []byte(tok+"\n"), 0o600); err != nil {
		log.Printf("[auth] cannot write the setup token, first-run setup is disabled: %v", err)
		return
	}
	s.setup.mu.Lock()
	s.setup.token = tok
	s.setup.mu.Unlock()
	log.Printf("[auth] admin password not set: first-run setup needs the one-time token in %s "+
		"(Docker: docker compose exec artex cat /app/%s)", s.setup.path, setupTokenFilename)
}

// checkSetupToken reports whether tok is the current setup token.
func (s *Server) checkSetupToken(tok string) bool {
	s.setup.mu.Lock()
	defer s.setup.mu.Unlock()
	tok = strings.TrimSpace(tok)
	return s.setup.token != "" && subtle.ConstantTimeCompare([]byte(tok), []byte(s.setup.token)) == 1
}

// consumeSetupToken invalidates the token after the password was set.
func (s *Server) consumeSetupToken() {
	s.setup.mu.Lock()
	s.setup.token = ""
	path := s.setup.path
	s.setup.mu.Unlock()
	if path != "" {
		_ = os.Remove(path)
	}
}

func randomSetupToken() (string, error) {
	buf := make([]byte, setupTokenLen)
	for i := range buf {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(keyChars))))
		if err != nil {
			return "", err
		}
		buf[i] = keyChars[n.Int64()]
	}
	return string(buf), nil
}
