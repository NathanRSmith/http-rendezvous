package standalone

import (
	"encoding/json"
	"github.com/julienschmidt/httprouter"
	"io"
	"log"
	"net/http"
  "http-rendezvous/util"
)


type Server struct {
	router *httprouter.Router
	// manager
	// logger
	logger log.Logger
	ttl    int
}

func New() Server {
	router := httprouter.New()
	server := Server{
		router: router,
		ttl:    60000,
	}

	router.GET("/ping", server.replyPong)
	router.POST("/stream", server.handleCreateStream)

	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}
func (s *Server) replyPong(w http.ResponseWriter, r *http.Request, p httprouter.Params) {
	io.WriteString(w, "pong")
}
func (s *Server) replyError(w http.ResponseWriter, http_status int, err util.Error) {
  w.Header().Set("content-type", "application/json")
  w.WriteHeader(http_status)
  res, _ := json.Marshal(err)
  w.Write(res)
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

	log.Println(msg)

}

type createStreamMessage struct {
	Download_headers map[string]string `json:"download_headers"`
	Upload_headers   map[string]string `json:"upload_headers"`
	Test             string            `json:"test"`
}
