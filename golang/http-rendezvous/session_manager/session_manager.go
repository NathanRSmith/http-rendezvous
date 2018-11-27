package session_manager

import (
	"github.com/satori/go.uuid"
	"http-rendezvous/util"
	"time"
)

type SessionManager struct {
	sessions map[string]Session
	// logger Logger
	session_ttl time.Duration
}

func NewSessionManager(ttl time.Duration) SessionManager {
	return SessionManager{make(map[string]Session), ttl}
}
func (sm *SessionManager) CreateSession(downloadHeaders util.HeaderSet, uploadHeaders util.HeaderSet) Session {
	sess := newSession(
		uuid.NewV4().String(),
		sm.session_ttl,
	)
	sm.sessions[sess.Id] = sess
	// TODO: autodelete?
	return sess
}
func (sm *SessionManager) GetSession(id string) (Session, error) {
	sess, ok := sm.sessions[id]
	if !ok {
		return Session{}, util.NewError("SessionNotFoundError", "The specified session id does not exist")
	}
	return sess, nil
}
func (sm *SessionManager) ToJSON() []SessionJSON {
	res := []SessionJSON{}
	for _, v := range sm.sessions {
		res = append(res, v.ToJSON())
	}
	return res
}

type Session struct {
	Id      string
	timeout *time.Timer
}

func newSession(id string, ttl time.Duration) Session {
	sess := Session{
		Id: id,
	}
	sess.timeout = time.AfterFunc(ttl, sess.onTimeout)

	return sess
}
func (s *Session) onTimeout() {
	// TODO
}

type SessionJSON struct {
	Id                string            `json:"id"`
	State             string            `json:"state"`
	Download_headers  map[string]string `json:"download_headers,omitempty"`
	Upload_headers    map[string]string `json:"upload_headers,omitempty"`
	Bytes_transferred int               `json:"bytes_transferred"`
}

func (s *Session) ToJSON() SessionJSON {
	return SessionJSON{
		Id: s.Id,
	}
}
