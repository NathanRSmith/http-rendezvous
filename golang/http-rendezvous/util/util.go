package util

import (
	"fmt"
	"io"
)

type Error struct {
	Name    string `json:"name"`
	Message string `json:"message"`
}

func NewError(name string, message string) *Error {
	return &Error{name, message}
}

// func NewErrorFromError(error error) *Error {
//   return &Error{"Error", error.Error()}
// }
func (err *Error) Error() string {
	return fmt.Sprint(err.Name, ":", err.Message)
}

type HeaderSet map[string]string

type ByteCounter struct {
	src   io.Reader
	Bytes int
	Reads int
}

func NewByteCounter(r io.Reader) *ByteCounter {
	return &ByteCounter{r, 0, 0}
}
func (bc *ByteCounter) Read(p []byte) (n int, err error) {
	n, err = bc.src.Read(p)
	// inspect anything here
	bc.Bytes = bc.Bytes + n
	bc.Reads++
	if bc.Reads % 1000 == 0 {
		fmt.Println("reads:", bc.Reads, "bytes:", bc.Bytes)
	}
	return
}
