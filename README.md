# HTTP-Rendezvous

A simple http server with 3 routes:

* `POST /stream`: Creates a stream which will wait for up to 1 minute for both sides to connect. Returns the stream id for clients to connect to.
* `GET/PUT /stream/:id`: Pairs one GET with one PUT and pipes them together once both are connected. Streaming is continued until completed from the PUT side or until either side disconnects, at which point both sides are terminated.

# Testing locally

```
npm install
node run.js --port 9999
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
