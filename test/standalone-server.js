const _ = require('lodash');
const assert = require('assert');
const EventEmitter = require('events');
const miss = require('mississippi');
const MockReq = require('mock-req');
const MockRes = require('mock-res');

const StandaloneServer = require('../lib/servers/standalone');

MockReq.prototype.setTimeout = ()=>{};

function assertErrorResponse(res, http_status, name, message) {
  assert.equal(res.statusCode, http_status);
  let body = JSON.parse(res._getString());
  assert.equal(body.name, name);
  assert.equal(body.message, message);
}

module.exports = {
  'Standalone Server': {

    'should send 404 to unknown route': function(done) {
      var server = new StandaloneServer({});
      var req = new MockReq({url: '/fail'});
      var res = new MockRes(() => {
        assertErrorResponse(res, 404, "BadRouteError", "No endpoint exists for the specified method and/or route");
        done();
      });

      server.handleRequest(req, res);
    },

    'should create a session at /stream': function(done) {
      var server = new StandaloneServer({});
      var req = new MockReq({method: 'POST', url: '/stream'});
      req.end();
      var res = new MockRes(() => {
        assert.equal(res.statusCode, 201);
        assert.equal(res.getHeader('content-type'), 'application/json');
        assert(res._getJSON().stream);
        done();
      });

      server.handleRequest(req, res);
    },

    'should send 404 to source request if session not found': function(done) {
      var server = new StandaloneServer({});
      var req = new MockReq({method: 'PUT', url: '/stream/fail'});
      var res = new MockRes(() => {
        assertErrorResponse(res, 404, "SessionNotFoundError", "The specified session id does not exist");
        done();
      });

      server.handleRequest(req, res);
    },

    'should send 404 to destination request if session not found': function(done) {
      var server = new StandaloneServer({});
      var req = new MockReq({method: 'GET', url: '/stream/fail'});
      var res = new MockRes(() => {
        assertErrorResponse(res, 404, "SessionNotFoundError", "The specified session id does not exist");
        done();
      });

      server.handleRequest(req, res);
    },

    'should send 404 to source request if session previously expired': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        setTimeout(sendSrc, 10);
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 404, "SessionNotFoundError", "The specified session id does not exist");
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 404 to destination request if session previously expired': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        setTimeout(sendDst, 10);
      });

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 404, "SessionNotFoundError", "The specified session id does not exist");
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 504 to source request if session expires': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 504, "SessionTimeoutError", "The specified session expired before both sides connected");
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 504 to destination request if session expires': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendDst();
      });

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 504, "SessionTimeoutError", "The specified session expired before both sides connected");
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 429 if source already connected': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc1();
        sendSrc2();
      });

      var sendSrc1 = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);
      }

      var sendSrc2 = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 429, "AlreadyConnectedError", "A client has already connected to the source side of this stream");
          server._cancel
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 429 if destination already connected': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendDst1();
        sendDst2();
      });

      var sendDst1 = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);
      }

      var sendDst2 = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 429);
          assertErrorResponse(res, 429, "AlreadyConnectedError", "A client has already connected to the destination side of this stream");
          server._cancel
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 502 if immediate source error': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('src', res));
        server.handleRequest(req, res);

        setTimeout(() =>req.emit('error', new Error('blahdeblah')), 5);
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('dst', res));
        server.handleRequest(req, res);
      }

      var dones = 0;
      var onEnd = (side, res) => {
        if(side === 'src') {
          assertErrorResponse(res, 502, "StreamSourceError", "Stream source raised an error");
          dones++;
        }
        else if(side === 'dst') {
          assertErrorResponse(res, 502, "StreamSourceError", "Stream source raised an error");
          dones++;
        }
        if(dones === 2) done();
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should end stream if mid-stream source error': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
        // timeout value should be greater than 5
        setTimeout(getStatus, 10);
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('src', res));
        server.handleRequest(req, res);

        req.write('abc');
        setTimeout(() =>req.emit('error', new Error('blahdeblah')), 5);
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => onEnd('dst', res));
        res.headersSent = true; // our mock doesn't handle this for us
        server.handleRequest(req, res);
      }
      var getStatus = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream+"/status"});
        var res = new MockRes(() => {
          assert.equal(res._getString(), '{"error":{"name":"StreamSourceError","message":"Stream source raised an error"}}');
          assert.equal(res.statusCode, 200);
          done();
        });
        server.handleRequest(req, res);
      }

      var onEnd = (side, res) => {
        if(side === 'src') {
          // src won't have gotten a response yet so we can still set appropriate status header
          assertErrorResponse(res, 502, "StreamSourceError", "Stream source raised an error");
        }
        else if(side === 'dst') {
          // dest headers have already been sent as success, so no error status header
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), 'abc');
        }
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 502 if immediate destination error': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('src', res));
        server.handleRequest(req, res);
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('dst', res));
        server.handleRequest(req, res);
        setTimeout(() =>res.emit('error', new Error('blahdeblah')), 5);
      }

      var dones = 0;
      var onEnd = (side, res) => {
        if(side === 'src') {
          assertErrorResponse(res, 502, "StreamDestinationError", "Stream destination raised an error");
          dones++;
        }
        else if(side === 'dst') {
          assertErrorResponse(res, 502, "StreamDestinationError", "Stream destination raised an error");
          dones++;
        }
        if(dones === 2) done();
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should end stream if mid-stream destination error': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
        setTimeout(getStatus, 10);
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => onEnd('src', res));
        server.handleRequest(req, res);
        req.write('abc');
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('dst', res));
        res.headersSent = true; // our mock doesn't handle this for us
        server.handleRequest(req, res);
        setTimeout(() =>res.emit('error', new Error('blahdeblah')), 5);
      }
      var getStatus = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream+"/status"});
        var res = new MockRes(() => {
          assert.equal(res._getString(), '{"error":{"name":"StreamDestinationError","message":"Stream destination raised an error"}}');
          assert.equal(res.statusCode, 200);
          done();
        });
        server.handleRequest(req, res);
      }
      var onEnd = (side, res) => {
        if(side === 'src') {
          // src won't have gotten a response yet so we can still set appropriate status header
          assertErrorResponse(res, 502, "StreamDestinationError", "Stream destination raised an error");
        }
        else if(side === 'dst') {
          // dest headers have already been sent as success, so no error status header
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), 'abc');
        }
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should end stream if source closes mid-stream unexpectedly': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
        setTimeout(getStatus, 10);
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);

        req.write('abc');
        setTimeout(() =>req.emit('close'), 5);
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), 'abc');
        });
        res.headersSent = true; // our mock doesn't handle this for us
        server.handleRequest(req, res);
      }
      var getStatus = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream+"/status"});
        var res = new MockRes(() => {
          assert.equal(res._getString(), '{"error":{"name":"StreamSourceError","message":"Stream source closed unexpectedly"}}');
          assert.equal(res.statusCode, 200);
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should end stream if destination closes mid-stream unexpectedly': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 502, "StreamDestinationError", "Stream destination closed unexpectedly");
          done();
        });
        server.handleRequest(req, res);

        req.write('abc');
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        res.headersSent = true; // our mock doesn't handle this for us
        server.handleRequest(req, res);
        setTimeout(() =>res.emit('close'), 5);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 200 & stream if source then destination connects': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, 'abc'), 5);
        setTimeout(req.write.bind(req, 'def'), 10);
        setTimeout(req.write.bind(req, 'ghi'), 15);
        setTimeout(req.write.bind(req, 'jkl'), 20);
        setTimeout(req.end.bind(req), 21);
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), 'abcdefghijkl');
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 200 & stream if destination then source connects': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendDst();
        sendSrc();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, 'abc'), 5);
        setTimeout(req.write.bind(req, 'def'), 10);
        setTimeout(req.write.bind(req, 'ghi'), 15);
        setTimeout(req.write.bind(req, 'jkl'), 20);
        setTimeout(req.end.bind(req), 21);
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), 'abcdefghijkl');
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should provide any initial error from source to subsequent request from destination': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendError();
        sendDst();
      });

      var sendError = () => {
        var req = new MockReq({method: 'POST', url: '/stream/'+resCreate._getJSON().stream+'/error'});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, '{ '), 5);
        setTimeout(req.write.bind(req, '"http_status":400, '), 10);
        setTimeout(req.write.bind(req, '"name":"GenericError", '), 15);
        setTimeout(req.write.bind(req, '"message":"this is an error" '), 20);
        setTimeout(req.write.bind(req, '}'), 25);
        setTimeout(req.end.bind(req), 30);
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 400, "GenericError", "this is an error");
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should provide any initial error from destination to subsequent request from source': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendError();
        sendSrc();
      });

      var sendError = () => {
        var req = new MockReq({method: 'POST', url: '/stream/'+resCreate._getJSON().stream+'/error'});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, '{ '), 5);
        setTimeout(req.write.bind(req, '"http_status":400, '), 10);
        setTimeout(req.write.bind(req, '"name":"GenericError", '), 15);
        setTimeout(req.write.bind(req, '"message":"this is an error" '), 20);
        setTimeout(req.write.bind(req, '}'), 25);
        setTimeout(req.end.bind(req), 30);
      }

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 400, "GenericError", "this is an error");
          done();
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, 'abc'), 35);
        setTimeout(req.write.bind(req, 'def'), 40);
        setTimeout(req.write.bind(req, 'ghi'), 45);
        setTimeout(req.write.bind(req, 'jkl'), 50);
        setTimeout(req.end.bind(req), 55);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should respond to connected destination with subsequent error from source client': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendDst();
        sendError();
      });

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 400, "GenericError", "this is an error");
          done();
        });
        server.handleRequest(req, res);
      }

      var sendError = () => {
        var req = new MockReq({method: 'POST', url: '/stream/'+resCreate._getJSON().stream+'/error'});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, '{ '), 5);
        setTimeout(req.write.bind(req, '"http_status":400, '), 10);
        setTimeout(req.write.bind(req, '"name":"GenericError", '), 15);
        setTimeout(req.write.bind(req, '"message":"this is an error" '), 20);
        setTimeout(req.write.bind(req, '}'), 25);
        setTimeout(req.end.bind(req), 30);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should respond to connected source with subsequent error from destination client': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendError();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assertErrorResponse(res, 400, "GenericError", "this is an error");
          done();
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, 'abc'), 5);
        setTimeout(req.write.bind(req, 'def'), 10);
        setTimeout(req.write.bind(req, 'ghi'), 15);
        setTimeout(req.write.bind(req, 'jkl'), 20);
        setTimeout(req.end.bind(req), 25);
      }

      var sendError = () => {
        var req = new MockReq({method: 'POST', url: '/stream/'+resCreate._getJSON().stream+'/error'});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, '{ '), 30);
        setTimeout(req.write.bind(req, '"http_status":400, '), 35);
        setTimeout(req.write.bind(req, '"name":"GenericError", '), 40);
        setTimeout(req.write.bind(req, '"message":"this is an error" '), 45);
        setTimeout(req.write.bind(req, '}'), 50);
        setTimeout(req.end.bind(req), 55);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 409 if client tries to report error after connecting': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
        sendError();
      });
      let dones = 0;

      var checkDone = () => {
        dones++;
        if (dones == 2) done();
      };

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, 'abc'), 5);
        setTimeout(req.write.bind(req, 'def'), 10);
        setTimeout(req.write.bind(req, 'ghi'), 15);
        setTimeout(req.write.bind(req, 'jkl'), 20);
        setTimeout(req.end.bind(req), 25);
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => checkDone());
        server.handleRequest(req, res);
      }

      var sendError = () => {
        var req = new MockReq({method: 'POST', url: '/stream/'+resCreate._getJSON().stream+'/error'});
        req.end();
        var res = new MockRes(() => {
          assertErrorResponse(res, 409, "StreamStartedError", "The specified session has already started streaming");
          checkDone();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 400 if custom download header name is invalid': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.write('{ "download_headers": { "@{}[].<>": 1 } }');
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assertErrorResponse(resCreate, 400, "InvalidBodyError", "Not a valid HTTP header name: @{}[].<>");
        done();
      });

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 400 if custom download header value is invalid': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.write('{ "download_headers": { "aa": "\\b" } }');
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assertErrorResponse(resCreate, 400, "InvalidBodyError", "Not a valid HTTP header value: \"\b\"");
        done();
      });

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 400 if custom upload header name is invalid': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.write('{ "upload_headers": { "@{}[].<>": 1 } }');
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assertErrorResponse(resCreate, 400, "InvalidBodyError", "Not a valid HTTP header name: @{}[].<>");
        done();
      });

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 400 if custom upload header value is invalid': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.write('{ "upload_headers": { "aa": "\\b" } }');
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assertErrorResponse(resCreate, 400, "InvalidBodyError", "Not a valid HTTP header value: \"\b\"");
        done();
      });

      server.handleRequest(reqCreate, resCreate);
    },

    'should respond to GET with any provided download headers': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.write('{ "download_headers": { "aa": 1, "bb": 2 } }');
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);
        req.end();
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
          assert.equal(res.getHeader("aa"), 1);
          assert.equal(res.getHeader("bb"), 2);
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should respond to PUT with any provided upload headers': function(done) {
      var server = new StandaloneServer({});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.write('{ "upload_headers": { "aa": 1, "bb": 2 } }');
      reqCreate.end();
      var resCreate = new MockRes(() => {
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () => {
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
          assert.equal(res.getHeader("aa"), 1);
          assert.equal(res.getHeader("bb"), 2);
          done();
        });
        server.handleRequest(req, res);
        req.end();
      }

      var sendDst = () => {
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send list of current sessions': function(done) {
      var server = new StandaloneServer({});

      function list(cb) {
        var req = new MockReq({method: 'GET', url: '/stream'});
        req.end();
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 200);
          assert.equal(res.getHeader('content-type'), 'application/json');
          var body = res._getJSON();
          cb(body);
        });

        server.handleRequest(req, res);
      }

      function create(cb) {
        var req = new MockReq({method: 'POST', url: '/stream'});
        req.end();
        var res = new MockRes(() => {
          assert.equal(res.statusCode, 201);
          assert.equal(res.getHeader('content-type'), 'application/json');
          assert(res._getJSON().stream);
          cb();
        });

        server.handleRequest(req, res);
      }

      list(function(body) {
        assert.equal(body.length, 0);
        create(function() {
          list(function(body) {
            assert.equal(body.length, 1);
            done();
          });
        });
      });
    },

  }
}
