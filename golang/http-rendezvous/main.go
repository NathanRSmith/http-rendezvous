package main

import (
	"http-rendezvous/servers"
	"log"
	"net/http"
)

const PORT = ":8080"

func main() {
	// TODO: parse args
	// port, mode, log-level, etc

	// load server
	server := standalone.New()

	// bind to port
	log.Print("listening at " + PORT)
	log.Fatal(http.ListenAndServe(PORT, &server))
	// TODO: handle shutdown
}
