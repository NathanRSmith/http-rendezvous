package util

import (
	"fmt"
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
