const SessionManager = require('../session-manager');
const NOOP_LOGGER = require('../noop-logger');

const STREAM_GENERATOR_URL_REGEX = /^\/stream\/?$/;
const STREAM_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/?$/;
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
        catch(err) { return this._reply403(res) }

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
      if(!sess) return this._reply404(res);

      try { sess.registerSource(req) }
      catch(err) { return this._reply403(res); }

      res.setHeader('connection', 'close');

      // map upload_headers object key/values to actual response header/values
      for (var header in sess.upload_headers) {
        this.logger.info('setting provided upload header: '+header);
        res.setHeader(header, sess.upload_headers[header]);
      }

      sess.on('timeout', sess => this._reply504(res));
      sess.on('streaming', sess => res.statusCode = 200);
      sess.on('error', err => this._onSessionError('src', sess, err, req, res));
      sess.on('finished', sess => res.end());
    }

    // GET /session/{id}
    else if(this._isDst(req.method, req.url)) {
      var sess = this._manager.getSession(this._getStreamId(req.url));
      if(!sess) return this._reply404(res);

      try { sess.registerDestination(res) }
      catch(err) { return this._reply403(res); }

      res.setHeader('connection', 'close');

      // map download_headers object key/values to actual response header/values
      for (var header in sess.download_headers) {
        this.logger.info('setting provided download header: '+header);
        res.setHeader(header, sess.download_headers[header]);
      }

      sess.on('streaming', sess => res.statusCode = 200);
      sess.on('timeout', sess => this._reply504(res));
      sess.on('error', err => this._onSessionError('dst', sess, err, req, res));
      sess.on('finished', sess => res.end());
    }

    // 404
    else return this._reply404(res);
  }

  _isCreate(method, url) { return method === 'POST' && url.search(STREAM_GENERATOR_URL_REGEX) !== -1; }
  _isSrc(method, url) { return method === 'PUT' && url.search(STREAM_URL_REGEX) !== -1; }
  _isDst(method, url) { return method === 'GET' && url.search(STREAM_URL_REGEX) !== -1; }
  _getStreamId(url) { return url.match(STREAM_URL_REGEX)[1]; }

  _reply404(res, msg) {
    res.statusCode = 404;
    return res.end(msg);
  }
  _reply403(res, msg) {
    res.statusCode = 403;
    return res.end(msg);
  }
  _reply504(res, msg) {
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
