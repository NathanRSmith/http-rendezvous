'use strict';


const URL = require('url');
const SessionManager = require('../session-manager');
const NOOP_LOGGER = require('../noop-logger');

const STREAM_GENERATOR_URL_REGEX = /^\/stream\/?$/;
const STREAM_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/?$/;
const STREAM_URL_STATUS_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/status\/?$/;
const STREAM_ERROR_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/error\/?$/;
const PING_URL_REGEX = /^\/ping\/?$/;
const STREAMS_URL_REGEX = /^\/stream\/?$/;
const SESSION_TTL = 60000;

// per RFC 7230 Section 3.2.6
const HEADER_KEY_REGEX = /^[\w!#$%&|~‘’^\*\+\-\.]+$/;
// per RFC 7230 Section 3.2 and RFC 5234 Appendix B.1
const HEADER_VAL_REGEX = /^[\u0021-\u007E \t]*$/;

const HTTP_STATUS = {
  OK: 200,
  Created: 201,
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
  TooManyRequests: 429,
  InternalError: 500,
  BadGateway: 502,
  GatewayTimeout: 504
};

const SERVER_ERROR = {
  'BAD_BODY': (message) => ({name: 'InvalidBodyError', message}),
  'INTERNAL': (message) => ({name: 'InternalError', message}),
  'CONN_EXISTS': (side) => ({name: 'AlreadyConnectedError', message: 'A client has already connected to the '+side+' side of this stream'}),
  'SESS_NOT_FOUND': () => ({name: 'SessionNotFoundError', message: 'The specified session id does not exist'}),
  'BAD_ROUTE': () => ({name: 'BadRouteError', message: 'No endpoint exists for the specified method and/or route'}),
  'TIMEOUT': () => ({name: 'SessionTimeoutError', message: 'The specified session expired before both sides connected'}),
  'STARTED': () => ({name: 'StreamStartedError', message: 'The specified session has already started streaming'})
};

const STREAM_ERRORS = {
  'SRC_ERROR': {name: 'StreamSourceError', message: 'Stream source raised an error'},
  'DST_ERROR': {name: 'StreamDestinationError', message: 'Stream destination raised an error'},
  'SRC_DISCONNECTED': {name: 'StreamSourceError', message: 'Stream source closed unexpectedly'},
  'DST_DISCONNECTED': {name: 'StreamDestinationError', message: 'Stream destination closed unexpectedly'},
  '_DEFAULT': {name: 'StreamError', message: 'Stream raised an error'}
};

class StandaloneServer {
  constructor(opts) {
    opts = opts || {};
    this.session_ttl = opts.session_ttl || SESSION_TTL;
    this.logger = opts.logger || NOOP_LOGGER;
    this._manager = new SessionManager({session_ttl: this.session_ttl, logger: this.logger});
  }

  handleRequest(req, res) {
    var pathname = URL.parse(req.url).pathname;
    this.logger.trace(req.method+' '+pathname);

    // POST /stream
    if(this._isCreate(req.method, pathname)) {
      var content = "";
      req.setEncoding("utf8");
      req.on('data', data => { content += data });

      req.once('end', () => {
        try { var body = this._parseCreateContent(content) }
        catch(err) { return this._replyError(res, HTTP_STATUS.BadRequest, SERVER_ERROR.BAD_BODY(err.message)) }

        var sess = this._manager.createSession(body.download_headers, body.upload_headers);
        sess.logger.info('session '+sess.id+' created');

        res.statusCode = HTTP_STATUS.Created;
        res.setHeader('content-type', 'application/json');
        return res.end('{"stream":"'+sess.id+'"}');
      });
    }

    // PUT /stream/{id}
    else if(this._isSrc(req.method, pathname)) {
      req.setTimeout(6 * 60 * 60 * 1000);
      var sess = this._manager.getSession(this._getStreamId(pathname));
      if(!sess || !sess.active) return this._replyError(res, HTTP_STATUS.NotFound, SERVER_ERROR.SESS_NOT_FOUND());

      if (!!sess.client_error) {
        return this._onClientError(sess, res);
      }

      sess.on('streaming', sess => {
        res.setHeader('connection', 'close');
        // map upload_headers object key/values to actual response header/values
        for (var header in sess.upload_headers) {
          sess.logger.info('setting provided upload header: '+header);
          res.setHeader(header, sess.upload_headers[header]);
        }
        res.statusCode = HTTP_STATUS.OK;
      });
      sess.on('client_error', sess => this._onClientError(sess, res));
      sess.on('timeout', sess => this._replyError(res, HTTP_STATUS.GatewayTimeout, SERVER_ERROR.TIMEOUT()));
      sess.on('error', err => this._onSessionError('src', sess, err, req, res));
      sess.on('finished', sess => res.end());

      try { sess.registerSource(req) }
      catch(err) { return this._replyError(res, HTTP_STATUS.TooManyRequests, SERVER_ERROR.CONN_EXISTS("source")); }
    }
    // GET /stream/{id}/status
    else if(this._isStatus(req.method, pathname)) {
      let streamURL = pathname.slice(0, pathname.lastIndexOf('/'))
      let streamID = this._getStreamId(streamURL);
      var sess = this._manager.getSession(streamID);
      if(!sess) return this._replyError(res, HTTP_STATUS.NotFound, SERVER_ERROR.SESS_NOT_FOUND());
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(sess.toJSON()));
    }

    // GET /stream/{id}
    else if(this._isDst(req.method, pathname)) {
      req.setTimeout(6 * 60 * 60 * 1000);
      var sess = this._manager.getSession(this._getStreamId(pathname));
      if(!sess || !sess.active) return this._replyError(res, HTTP_STATUS.NotFound, SERVER_ERROR.SESS_NOT_FOUND());

      if (!!sess.client_error) {
        return this._onClientError(sess, res);
      }

      sess.on('streaming', sess => {
        // map download_headers object key/values to actual response header/values
        for (var header in sess.download_headers) {
          sess.logger.info('setting provided download header: '+header);
          res.setHeader(header, sess.download_headers[header]);
        }
        res.statusCode = HTTP_STATUS.OK;
        res.setHeader('connection', 'close');
      });
      sess.on('client_error', sess => this._onClientError(sess, res));
      sess.on('timeout', sess => this._replyError(res, HTTP_STATUS.GatewayTimeout, SERVER_ERROR.TIMEOUT()));
      sess.on('error', err => this._onSessionError('dst', sess, err, req, res));
      sess.on('finished', sess => res.end());

      try { sess.registerDestination(res) }
      catch(err) { return this._replyError(res, HTTP_STATUS.TooManyRequests, SERVER_ERROR.CONN_EXISTS("destination")); }
    }

    // POST /stream/{id}/error
    else if (this._isErr(req.method, pathname)) {
      let stream_id = pathname.match(STREAM_ERROR_URL_REGEX)[1];
      let sess = this._manager.getSession(stream_id);
      if(!sess) return this._replyError(res, HTTP_STATUS.NotFound, SERVER_ERROR.SESS_NOT_FOUND());
      if (sess._piped || !sess.active) return this._replyError(res, HTTP_STATUS.Conflict, SERVER_ERROR.STARTED());

      let content = "";
      req.setEncoding("utf8");
      req.on('data', data => { content += data });

      req.once('end', () => {
        try { var body = JSON.parse(content) }
        catch(err) { return this._replyError(res, HTTP_STATUS.BadRequest, SERVER_ERROR.BAD_BODY(err.message)) }

        sess.registerClientError(body);
        res.statusCode = HTTP_STATUS.OK;
        res.end();
      });
    }

    // GET /ping/
    else if (this._isPing(req.method, req.url)) {
      return this._replyPong(res, HTTP_STATUS.OK);
    }

    // GET /stream/
    else if (this._isStreams(req.method, req.url)) {
      try {
        res.statusCode = HTTP_STATUS.OK;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(this._manager.toJSON()));
      }
      catch(err) {
        this.logger.error(err);
        return this._replyError(res, HTTP_STATUS.InternalError, SERVER_ERROR.INTERNAL(err.message));
      }
    }

    // 404
    else return this._replyError(res, HTTP_STATUS.NotFound, SERVER_ERROR.BAD_ROUTE());
  }

  _isCreate(method, url) { return method === 'POST' && url.search(STREAM_GENERATOR_URL_REGEX) !== -1; }
  _isStreams(method, url) { return method === 'GET' && url.search(STREAMS_URL_REGEX) !== -1; }
  _isSrc(method, url) { return method === 'PUT' && url.search(STREAM_URL_REGEX) !== -1; }
  _isStatus(method, url) { return method === 'GET' && url.search(STREAM_URL_STATUS_REGEX) !== -1; }
  _isDst(method, url) { return method === 'GET' && url.search(STREAM_URL_REGEX) !== -1; }
  _isErr(method, url) { return method === 'POST' && url.search(STREAM_ERROR_URL_REGEX) !== -1;  }
  _isPing(method, url) { return method === 'GET' && url.search(PING_URL_REGEX) !== -1;  }
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

  _replyError(res, http_status, error) {
    var response_body = { name: "Error", message: "Encountered an error" };
    if (!!error) {
      if (error.name) response_body.name = error.name;
      if (error.message) response_body.message = error.message;
    }

    res.statusCode = http_status;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(response_body));
  }

  _replyPong(res, http_status) {
    res.statusCode = http_status;
    return res.end('pong');
  }

  _onClientError(sess, res) {
    var http_status = 400;
    var response_body = { name: "Error", message: "The other side encountered an unspecified error" };

    var error = sess.client_error;
    if (!!error) {
      if (error.http_status) http_status = error.http_status;
      if (error.name) response_body.name = error.name;
      if (error.message) response_body.message = error.message;
    }

    return this._replyError(res, http_status, response_body);
  }

  _onSessionError(side, sess, err, req, res) {
    var outErr = STREAM_ERRORS[sess.state] || STREAM_ERRORS['_DEFAULT'];
    sess.error = outErr;
    // don't bother trying to write error messages if already disconnected
    var SIDE = side.toUpperCase();
    if(sess.state === `${SIDE}_DISCONNECTED`) return;
    // don't try to set the status if the headers can't be changed
    // if they are already sent, we've probably already sent some content too,
    // so we add line breaks for readability

    if(res.headersSent) {
      res.end();
    }
    else { this._replyError(res, HTTP_STATUS.BadGateway, outErr); }
  }
}

module.exports = StandaloneServer;
