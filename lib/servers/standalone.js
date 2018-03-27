const SessionManager = require('../session-manager');
const NOOP_LOGGER = require('../noop-logger');

const STREAM_GENERATOR_URL_REGEX = /^\/stream\/?$/;
const STREAM_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/?$/;
const SESSION_TTL = 60000;

// per RFC 7230 Section 3.2.6
const HEADER_KEY_REGEX = /^[\w!#$%&|~‘’^\*\+\-\.]+$/;
// per RFC 7230 Section 3.2 and RFC 5234 Appendix B.1
const HEADER_VAL_REGEX = /^[\u0021-\u007E \t]*$/;

const STREAM_ERRORS = {
  'SRC_ERROR': JSON.stringify({name: 'StreamSourceError', message: 'Stream source raised an error'}),
  'DST_ERROR': JSON.stringify({name: 'StreamDestinationError', message: 'Stream destination raised an error'}),
  'SRC_DISCONNECTED': JSON.stringify({name: 'StreamSourceError', message: 'Stream source closed unexpectedly'}),
  'DST_DISCONNECTED': JSON.stringify({name: 'StreamDestinationError', message: 'Stream destination closed unexpectedly'}),
  '_DEFAULT': JSON.stringify({name: 'StreamError', message: 'Stream raised an error'})
};

class StandaloneServer {
  constructor(opts) {
    opts = opts || {};
    this.session_ttl = opts.session_ttl || SESSION_TTL;
    this.logger = opts.logger || NOOP_LOGGER;
    this._manager = new SessionManager({session_ttl: this.session_ttl, logger: this.logger});
  }

  handleRequest(req, res) {
    this.logger.trace(req.method+' '+req.url);

    // POST /session
    if(this._isCreate(req.method, req.url)) {
      var content = "";
      req.setEncoding("utf8");
      req.on('data', data => { content += data });

      req.once('end', () => {
        try { var body = this._parseCreateContent(content) }
        catch(err) { return this._replyBadRequest(res, err.message) }

        var sess = this._manager.createSession(body.download_headers, body.upload_headers);
        this.logger.info('session '+sess.id+' created');

        res.statusCode = 201;
        res.setHeader('content-type', 'application/json');
        return res.end('{"stream":"'+sess.id+'"}');
      });
    }

    // PUT /session/{id}
    else if(this._isSrc(req.method, req.url)) {
      var sess = this._manager.getSession(this._getStreamId(req.url));
      if(!sess) return this._replyNotFound(res);

      try { sess.registerSource(req) }
      catch(err) { return this._replyForbidden(res); }

      res.setHeader('connection', 'close');

      // map upload_headers object key/values to actual response header/values
      for (var header in sess.upload_headers) {
        this.logger.info('setting provided upload header: '+header);
        res.setHeader(header, sess.upload_headers[header]);
      }

      sess.on('timeout', sess => this._replyGatewayTimeout(res));
      sess.on('streaming', sess => res.statusCode = 200);
      sess.on('error', err => this._onSessionError('src', sess, err, req, res));
      sess.on('finished', sess => res.end());
    }

    // GET /session/{id}
    else if(this._isDst(req.method, req.url)) {
      var sess = this._manager.getSession(this._getStreamId(req.url));
      if(!sess) return this._replyNotFound(res);

      try { sess.registerDestination(res) }
      catch(err) { return this._replyForbidden(res); }

      res.setHeader('connection', 'close');

      // map download_headers object key/values to actual response header/values
      for (var header in sess.download_headers) {
        this.logger.info('setting provided download header: '+header);
        res.setHeader(header, sess.download_headers[header]);
      }

      sess.on('streaming', sess => res.statusCode = 200);
      sess.on('timeout', sess => this._replyGatewayTimeout(res));
      sess.on('error', err => this._onSessionError('dst', sess, err, req, res));
      sess.on('finished', sess => res.end());
    }

    // 404
    else return this._replyNotFound(res);
  }

  _isCreate(method, url) { return method === 'POST' && url.search(STREAM_GENERATOR_URL_REGEX) !== -1; }
  _isSrc(method, url) { return method === 'PUT' && url.search(STREAM_URL_REGEX) !== -1; }
  _isDst(method, url) { return method === 'GET' && url.search(STREAM_URL_REGEX) !== -1; }
  _getStreamId(url) { return url.match(STREAM_URL_REGEX)[1]; }

  _parseCreateContent(content) {
    var body = { download_headers:[], upload_headers:[] };
    if (!content) return body;

    try { body = JSON.parse(content) || body }
    catch(err) { throw new Error(`Invalid JSON: ${err.message}`) }

    for (var header_set of [body.download_headers, body.upload_headers]) {
      for (var header in header_set) {
        if (header.search(HEADER_KEY_REGEX) === -1) {
          throw new Error(`Not a valid HTTP header name: ${header}`);
        }
        if (String(header_set[header]).search(HEADER_VAL_REGEX) === -1) {
          throw new Error(`Not a valid HTTP header value: "${header_set[header]}"`);
        }
      }
    }

    return body;
  }

  _replyNotFound(res, msg) {
    res.statusCode = 404;
    return res.end(msg);
  }
  _replyForbidden(res, msg) {
    res.statusCode = 403;
    return res.end(msg);
  }
  _replyBadRequest(res, msg) {
    res.statusCode = 400;
    return res.end(msg);
  }
  _replyGatewayTimeout(res, msg) {
    res.statusCode = 504;
    return res.end(msg);
  }

  _onSessionError(side, sess, err, req, res) {
    var outErr = STREAM_ERRORS[sess.state];
    if(!outErr) outErr = STREAM_ERRORS['_DEFAULT'];
    if(side === 'src') {
      if(sess.state === 'SRC_DISCONNECTED') return;
      res.write(outErr);
      res.end();
    }
    else {
      if(sess.state === 'DST_DISCONNECTED') return;
      res.write('\n\n'+outErr);
      res.end();
    }
  }
}

module.exports = StandaloneServer;
