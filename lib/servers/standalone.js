const SessionManager = require('../session-manager');
const NOOP_LOGGER = require('../noop-logger');

const STREAM_GENERATOR_URL_REGEX = /^\/stream\/?$/;
const STREAM_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/?$/;
const STREAM_ERROR_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/error\/?$/;
const SESSION_TTL = 60000;

const HTTP_STATUS = {
  OK: 200,
  Created: 201,
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
  TooManyRequests: 429,
  BadGateway: 502,
  GatewayTimeout: 504
};

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
        catch(err) { return this._replyError(res, HTTP_STATUS.BadRequest) }
        if (!body) return this._replyError(res, HTTP_STATUS.BadRequest);

        var sess = this._manager.createSession(body.download_headers, body.upload_headers);
        this.logger.info('session '+sess.id+' created');

        res.statusCode = HTTP_STATUS.Created;
        res.setHeader('content-type', 'application/json');
        return res.end('{"stream":"'+sess.id+'"}');
      });
    }

    // PUT /session/{id}
    else if(this._isSrc(req.method, req.url)) {
      var sess = this._manager.getSession(this._getStreamId(req.url));
      if(!sess) return this._replyError(res, HTTP_STATUS.NotFound);

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
        res.statusCode = HTTP_STATUS.OK;
      });
      sess.on('client_error', sess => this._onClientError(sess, res));
      sess.on('timeout', sess => this._replyError(res, HTTP_STATUS.GatewayTimeout));
      sess.on('error', err => this._onSessionError('src', sess, err, req, res));
      sess.on('finished', sess => res.end());

      try { sess.registerSource(req) }
      catch(err) { return this._replyError(res, HTTP_STATUS.TooManyRequests); }
    }

    // GET /session/{id}
    else if(this._isDst(req.method, req.url)) {
      var sess = this._manager.getSession(this._getStreamId(req.url));
      if(!sess) return this._replyError(res, HTTP_STATUS.NotFound);

      if (!!sess.client_error) {
        return this._onClientError(sess, res);
      }

      sess.on('streaming', sess => {
        // map download_headers object key/values to actual response header/values
        for (var header in sess.download_headers) {
          this.logger.info('setting provided download header: '+header);
          res.setHeader(header, sess.download_headers[header]);
        }
        res.statusCode = HTTP_STATUS.OK;
        res.setHeader('connection', 'close');
      });
      sess.on('client_error', sess => this._onClientError(sess, res));
      sess.on('timeout', sess => this._replyError(res, HTTP_STATUS.GatewayTimeout));
      sess.on('error', err => this._onSessionError('dst', sess, err, req, res));
      sess.on('finished', sess => res.end());

      try { sess.registerDestination(res) }
      catch(err) { return this._replyError(res, HTTP_STATUS.TooManyRequests); }
    }

    // POST /session/{id}/error
    else if (this._isErr(req.method, req.url)) {
      let stream_id = req.url.match(STREAM_ERROR_URL_REGEX)[1];
      let sess = this._manager.getSession(stream_id);
      if (sess._piped || sess.deleted) return this._replyError(res, HTTP_STATUS.Conflict);

      let content = "";
      req.setEncoding("utf8");
      req.on('data', data => { content += data });

      req.once('end', () => {
        try { var body = JSON.parse(content) }
        catch(err) { return this._replyError(res, HTTP_STATUS.BadRequest) }
        if (!body) return this._replyError(res, HTTP_STATUS.BadRequest);

        sess.registerClientError(body);
        res.statusCode = HTTP_STATUS.OK;
        res.end();
      });
    }

    // 404
    else return this._replyError(res, HTTP_STATUS.NotFound);
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

  _onClientError(sess, res) {
    var http_status = 400;
    var response_body = { name: "Error", message: "The other side encountered an unspecified error" };
    var err = sess.client_error;
    if (!!err) {
      if (err.http_status) http_status = err.http_status;
      if (err.name) response_body.name = err.name;
      if (err.message) response_body.message = err.message;
    }

    return this._replyError(res, http_status, JSON.stringify(response_body));
  }

  _onSessionError(side, sess, err, req, res) {
    var outErr = STREAM_ERRORS[sess.state] || STREAM_ERRORS['_DEFAULT'];
    // dst may already have content written so add line breaks for readability
    if (side === 'dst') outErr = '\n\n'+outErr;

    // don't bother trying to write error messages if already disconnected
    var SIDE = side.toUpperCase();
    if(sess.state === `${SIDE}_DISCONNECTED`) return;

    // don't try to set the status if the headers can't be changed
    if(res.headersSent) { res.end(outErr); }
    else { this._replyError(res, HTTP_STATUS.BadGateway, outErr); }
  }
}

module.exports = StandaloneServer;
