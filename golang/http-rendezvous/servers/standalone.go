package standalone

import (
	"encoding/json"
	"github.com/julienschmidt/httprouter"
	"http-rendezvous/session_manager"
	"http-rendezvous/util"
	"io"
	"log"
	"net/http"
	"time"
)

const DEFAULT_TTL = time.Minute

type Server struct {
	router *httprouter.Router
	// manager
	// logger
	logger  log.Logger
	ttl     time.Duration
	manager session_manager.SessionManager
}

func New() Server {
	router := httprouter.New()
	server := Server{
		router:  router,
		ttl:     DEFAULT_TTL,
		manager: session_manager.NewSessionManager(DEFAULT_TTL),
	}

	router.GET("/ping", server.replyPong)
	router.GET("/stream", server.handleListStreams)
	router.POST("/stream", server.handleCreateStream)

	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}
func (s *Server) replyPong(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	io.WriteString(w, "pong")
}
func (s *Server) replyError(w http.ResponseWriter, http_status int, err error) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(http_status)

	if err, ok := err.(*util.Error); !ok {
		err = util.NewError("InternalError", err.Error())
	}
	res, _ := json.Marshal(err)
	w.Write(res)
}
func (s *Server) replyJSON(w http.ResponseWriter, res []byte) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(200)
	w.Write(res)
}

type createStreamMessage struct {
	Download_headers util.HeaderSet `json:"download_headers"`
	Upload_headers   util.HeaderSet `json:"upload_headers"`
	Test             string         `json:"test"`
}

func (s *Server) handleCreateStream(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	r.Body = http.MaxBytesReader(w, r.Body, 1024*1024)
	decoder := json.NewDecoder(r.Body)
	msg := createStreamMessage{}

	if err := decoder.Decode(&msg); err != nil {
		// TODO: handle
		s.replyError(w, 400, util.NewError("InvalidBodyError", "Invalid JSON: "+err.Error()))
		return
	}

	// TODO: validate header kvp formats

	sess := s.manager.CreateSession(msg.Download_headers, msg.Upload_headers)
	s.replyJSON(w, []byte("{\"stream\":\""+sess.Id+"\"}"))
}

func (s *Server) handleListStreams(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	res, _ := json.Marshal(s.manager.ToJSON())
	s.replyJSON(w, []byte(res))
}