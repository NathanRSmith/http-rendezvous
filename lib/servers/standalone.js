const SessionManager = require('../session-manager');
const NOOP_LOGGER = require('../noop-logger');

const STREAM_GENERATOR_URL_REGEX = /^\/stream\/?$/;
const STREAM_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/?$/;
const STREAM_ERROR_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/error\/?$/;
const SESSION_TTL = 60000;

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
        try { var body = content ? JSON.parse(content) : {} }
        catch(err) { return this._replyBadRequest(res) }
        if (!body) return this._replyBadRequest(res);

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

      if (!!sess.client_error) {
        return this._onClientError(sess, res);
      }

      sess.on('streaming', sess => {
        res.setHeader('connection', 'close');
        // map upload_headers object key/values to actual response header/values
        for (var header in sess.upload_headers) {
          this.logger.info('setting provided upload header: '+header);
          res.setHeader(header, sess.upload_headers[header]);
        }
        res.statusCode = 200;
      });
      sess.on('client_error', sess => this._onClientError(sess, res));
      sess.on('timeout', sess => this._replyGatewayTimeout(res));
      sess.on('error', err => this._onSessionError('src', sess, err, req, res));
      sess.on('finished', sess => res.end());

      try { sess.registerSource(req) }
      catch(err) { return this._replyForbidden(res); }
    }

    // GET /session/{id}
    else if(this._isDst(req.method, req.url)) {
      var sess = this._manager.getSession(this._getStreamId(req.url));
      if(!sess) return this._replyNotFound(res);

      if (!!sess.client_error) {
        return this._onClientError(sess, res);
      }

      sess.on('streaming', sess => {
        // map download_headers object key/values to actual response header/values
        for (var header in sess.download_headers) {
          this.logger.info('setting provided download header: '+header);
          res.setHeader(header, sess.download_headers[header]);
        }
        res.statusCode = 200;
        res.setHeader('connection', 'close');
      });
      sess.on('client_error', sess => this._onClientError(sess, res));
      sess.on('timeout', sess => this._replyGatewayTimeout(res));
      sess.on('error', err => this._onSessionError('dst', sess, err, req, res));
      sess.on('finished', sess => res.end());

      try { sess.registerDestination(res) }
      catch(err) { return this._replyForbidden(res); }
    }

    // POST /session/{id}/error
    else if (this._isErr(req.method, req.url)) {
      let stream_id = req.url.match(STREAM_ERROR_URL_REGEX)[1];
      let sess = this._manager.getSession(stream_id);
      if (sess._piped || sess.deleted) return this._replyConflict(res);

      let content = "";
      req.setEncoding("utf8");
      req.on('data', data => { content += data });

      req.once('end', () => {
        try { var body = JSON.parse(content) }
        catch(err) { return this._replyBadRequest(res) }
        if (!body || !body.error) return this._replyBadRequest(res);

        sess.registerClientError(error);
        res.statusCode = 200;
        res.end();
      });
    }

    // 404
    else return this._replyNotFound(res);
  }

  _isCreate(method, url) { return method === 'POST' && url.search(STREAM_GENERATOR_URL_REGEX) !== -1; }
  _isSrc(method, url) { return method === 'PUT' && url.search(STREAM_URL_REGEX) !== -1; }
  _isDst(method, url) { return method === 'GET' && url.search(STREAM_URL_REGEX) !== -1; }
  _isErr(method, url) { return method === 'POST' && url.search(STREAM_ERROR_URL_REGEX) !== -1;  }
  _getStreamId(url) { return url.match(STREAM_URL_REGEX)[1]; }

  _replyError(res, http_status, msg) {
    res.statusCode = http_status;
    return res.end(msg);
  }

  _replyConflict(res, msg) {
    return this._replyError(res, 409, msg);
  }
  _replyNotFound(res, msg) {
    return this._replyError(res, 404, msg);
  }
  _replyForbidden(res, msg) {
    return this._replyError(res, 403, msg);
  }
  _replyBadRequest(res, msg) {
    return this._replyError(res, 400, msg);
  }
  _replyGatewayTimeout(res, msg) {
    return this._replyError(res, 504, msg);
  }

  _onClientError(sess, res) {
    let err = sess.client_error;
    let response_body = JSON.stringify({ name: err.name, message: err.message });
    return this._replyError(res, err.http_status, response_body);
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
