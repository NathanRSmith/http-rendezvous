# HTTP-Rendezvous

A simple http server with 6 routes:

## `POST /stream`

Creates a stream which will wait for up to 1 minute for both sides to connect. Returns the stream id for clients to connect to.

You can call this with no body, or may optionally provide a JSON body with any of the following properties:
* download_headers: Custom headers that will be sent in response to the GET request once streaming begins.
* upload_headers: Custom headers that will be send in response to the PUT request when it completes.

Both properties should be a JSON object in which the keys correspond to header names, and the values correspond to header values. For example:

```
{
  "download_headers": {
    "Content-Type": "text/csv",
    "Content-Disposition": "attachment; filename=\"myfile.csv\""
  },
  "upload_headers": {
    "Location": "http://new/path/to/myfile.csv"
  }
}
```

The following HTTP responses may occur:
* 201 Created: The stream was registered successfully.
* 400 Bad Request: You provided a body that fails to parse as JSON, or the syntax of at least one of the headers you provided violates the spec for HTTP/1.1 headers.  

## `GET /stream/:id`

Pairs with a corresponding PUT request and pipes them together once both are connected. Streaming is continued until completed from the PUT side or until either side disconnects, at which point both sides are terminated.

The following HTTP responses may occur:
* 200 OK: Streaming initiated successfully
* 404 Not Found: The stream id provided does not exist or has already expired
* 429 Too Many Requests: This stream already has a GET request connected
* 502 Bad Gateway: The GET was connected to the corresponding PUT, but then the connection errored or closed
* 504 Gateway Timeout: The stream expired before receiving a corresponding PUT request

Additionally, any arbitrary response is possible due to the ability to report client errors (see below).

## `PUT /stream/:id`

Pairs with a corresponding GET request and pipes them together once both are connected. Streaming is continued until completed from the PUT side or until either side disconnects, at which point both sides are terminated.

The following HTTP responses may occur:
* 200 OK: Streaming completed successfully
* 404 Not Found: The stream id provided does not exist or has already expired
* 429 Too Many Requests: This stream already has a PUT request connected
* 502 Bad Gateway: The PUT was connected to the corresponding GET, but then the connection errored or closed
* 504 Gateway Timeout: The stream expired before receiving a corresponding GET request

Additionally, any arbitrary response is possible due to the ability to report client errors (see below).

## `POST /stream/:id/error`

Allows one side of the stream to report any error that prevents it from sending or receiving the data to/from the other side (e.g. auth failure or missing resources). As soon as the other side connects, the error will be sent in that HTTP response and the stream will be terminated. If both sides have already connected, then this endpoint is unavailable and will fail.

You can call this with no body (i.e. send a vague 400 response), or may optionally provide a JSON body with any of the following properties:
* http_status: The HTTP status with which to respond to the GET or PUT
* name: The name of the error type
* message: A natural language description of the error

For example:

```
{
 "http_status": 404,
 "name": "FileNotFoundError",
 "message": "File 'path/to/myfile.csv' does not exist"
}
```

The above example will cause the connected GET or PUT request to receive this response:

```
HTTP/1.1 404 Not Found

{"name": "FileNotFoundError","message": "File 'path/to/myfile.csv' does not exist"}
```

The following HTTP responses may occur:
* 200 OK: The error was registered successfully
* 400 Bad Request: You provided a body that fails to parse as JSON
* 404 Not Found: The stream id provided does not exist or has already expired
* 409 Conflict: Both sides of the stream have already connected and can no longer receive client errors

## `GET /ping`

Sends back `200` with the body `pong`. Used to verify the server is up & responding to requests.

## `GET /stream`

*Warning: Should only be exposed to trusted networks*

Lists active streams with information such as:

```
[{
  id: stream uuid,
  created_at: ISO8601 timestamp when the stream was created,
  deactivated_at: ISO8601 timestamp when the stream was deactivated,
  state: One of `CREATED, STREAMING, TIMEOUT_NO_SRC, TIMEOUT_NO_DST, SRC_ERROR, DST_ERROR, FINISHED, SRC_DISCONNECTED, DST_DISCONNECTED, CLIENT_ERROR, FINISHED`. In practice should only see `CREATED, STREAMING or FINISHED`,
  active: Boolean whether the stream is active (not finished),
  error: Object with `name` & `message` if an error occurred before or during streaming,
  download_headers: KVP of headers sent to download client,
  upload_headers: KVP of headers sent to upload client,
  bytes_transferred: Count of bytes transferred so far
}]
```

* 200 OK: JSON response successfully retrieved (may be empty list if no active sessions)
* 500 Internal Error: JSON error body with name & message fields

## `GET /stream/:id/status`

Returns status information about the specified stream. Contains a single object in the form described in `GET /stream`. Status information is retained for 1 minute after the stream deactivates.

# Tests

```
mocha -u exports --recursive
```

# Testing locally

```
npm install
node bin/run-standalone --port 9999
```

Create stream:

```
$ curl -X POST http://localhost:9999/stream
{"stream":"c8fd8ddf-5b3e-4380-b0e1-26b02b94b3cb"}
```

Connect two sides to the stream:

```
export STREAM=11df1722-1c3d-456a-9b97-6f6c425a52e2
curl -iX PUT -T /dev/urandom http://localhost:9999/stream/$STREAM
```

```
curl -isX GET http://localhost:9999/stream/$STREAM | pv -rtbaW | wc -lc
```
