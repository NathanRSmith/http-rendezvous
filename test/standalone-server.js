const _ = require('lodash');
const assert = require('assert');
const EventEmitter = require('events');
const miss = require('mississippi');
const MockReq = require('mock-req');
const MockRes = require('mock-res');

const StandaloneServer = require('../lib/servers/standalone');

module.exports = {
  'Standalone Server': {

    'should send 404 to unknown route': function(done) {
      var server = new StandaloneServer({});
      var req = new MockReq({url: '/fail'});
      var res = new MockRes(() =>{
        assert.equal(res.statusCode, 404);
        done();
      });

      server.handleRequest(req, res);
    },

    'should create a session at /stream': function(done) {
      var server = new StandaloneServer({});
      var req = new MockReq({method: 'POST', url: '/stream'});
      req.end();
      var res = new MockRes(() =>{
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
      var res = new MockRes(() =>{
        assert.equal(res.statusCode, 404);
        done();
      });

      server.handleRequest(req, res);
    },

    'should send 404 to destination request if session not found': function(done) {
      var server = new StandaloneServer({});
      var req = new MockReq({method: 'GET', url: '/stream/fail'});
      var res = new MockRes(() =>{
        assert.equal(res.statusCode, 404);
        done();
      });

      server.handleRequest(req, res);
    },

    'should send 404 to source request if session previously expired': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        setTimeout(sendSrc, 10);
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.statusCode, 404);
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
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        setTimeout(sendDst, 10);
      });

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.statusCode, 404);
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
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.statusCode, 504);
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
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendDst();
      });

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.statusCode, 504);
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 403 if source already connected': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc1();
        sendSrc2();
      });

      var sendSrc1 = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);
      }

      var sendSrc2 = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.statusCode, 403);
          server._cancel
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 403 if destination already connected': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendDst1();
        sendDst2();
      });

      var sendDst1 = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);
      }

      var sendDst2 = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.statusCode, 403);
          server._cancel
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should end stream if source error': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('src', res));
        server.handleRequest(req, res);

        req.write('abc');
        setTimeout(() =>req.emit('error', new Error('blahdeblah')), 5);
      }

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('dst', res));
        server.handleRequest(req, res);
      }

      var dones = 0;
      var onEnd = (side, res) => {
        if(side === 'src') {
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), '{"name":"StreamSourceError","message":"Stream source raised an error"}');
          dones++;
        }
        else if(side === 'dst') {
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), 'abc\n\n{"name":"StreamSourceError","message":"Stream source raised an error"}');
          dones++;
        }
        if(dones === 2) done();
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should end stream if destination error': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('src', res));
        server.handleRequest(req, res);

        req.write('abc');
      }

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>onEnd('dst', res));
        server.handleRequest(req, res);
        setTimeout(() =>res.emit('error', new Error('blahdeblah')), 5);
      }

      var dones = 0;
      var onEnd = (side, res) => {
        if(side === 'src') {
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), '{"name":"StreamDestinationError","message":"Stream destination raised an error"}');
          dones++;
        }
        else if(side === 'dst') {
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), 'abc\n\n{"name":"StreamDestinationError","message":"Stream destination raised an error"}');
          dones++;
        }
        if(dones === 2) done();
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should end stream if source closes unexpectedly': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);

        req.write('abc');
        setTimeout(() =>req.emit('close'), 5);
      }

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), 'abc\n\n{"name":"StreamSourceError","message":"Stream source closed unexpectedly"}');
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should end stream if destination closes unexpectedly': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.statusCode, 200);
          assert.equal(res._getString(), '{"name":"StreamDestinationError","message":"Stream destination closed unexpectedly"}');
          done();
        });
        server.handleRequest(req, res);

        req.write('abc');
      }

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);
        setTimeout(() =>res.emit('close'), 5);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 200 & stream if source then destination connects': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, 'abc'), 5);
        setTimeout(req.write.bind(req, 'def'), 10);
        setTimeout(req.write.bind(req, 'ghi'), 15);
        setTimeout(req.write.bind(req, 'jkl'), 20);
        setTimeout(req.end.bind(req), 21);
      }

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res._getString(), 'abcdefghijkl');
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should send 200 & stream if destination then source connects': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendDst();
        sendSrc();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);

        setTimeout(req.write.bind(req, 'abc'), 5);
        setTimeout(req.write.bind(req, 'def'), 10);
        setTimeout(req.write.bind(req, 'ghi'), 15);
        setTimeout(req.write.bind(req, 'jkl'), 20);
        setTimeout(req.end.bind(req), 21);
      }

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res._getString(), 'abcdefghijkl');
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should respond to GET with any provided download headers': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.write('{ "download_headers": { "aa": 1, "bb": 2 } }');
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);
        setTimeout(req.end.bind(req), 5);
      }

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() =>{
          assert.equal(res.getHeader("aa"), 1);
          assert.equal(res.getHeader("bb"), 2);
          done();
        });
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

    'should respond to PUT with any provided upload headers': function(done) {
      var server = new StandaloneServer({session_ttl: 5});
      var reqCreate = new MockReq({method: 'POST', url: '/stream'});
      reqCreate.write('{ "upload_headers": { "aa": 1, "bb": 2 } }');
      reqCreate.end();
      var resCreate = new MockRes(() =>{
        assert.equal(resCreate.statusCode, 201);
        sendSrc();
        sendDst();
      });

      var sendSrc = () =>{
        var req = new MockReq({method: 'PUT', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes(() => {
          assert.equal(res.getHeader("aa"), 1);
          assert.equal(res.getHeader("bb"), 2);
          done();
        });
        server.handleRequest(req, res);
        setTimeout(req.end.bind(req), 5);
      }

      var sendDst = () =>{
        var req = new MockReq({method: 'GET', url: '/stream/'+resCreate._getJSON().stream});
        var res = new MockRes();
        server.handleRequest(req, res);
      }

      server.handleRequest(reqCreate, resCreate);
    },

  }
}
