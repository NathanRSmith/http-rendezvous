const uuid = require('uuid/v4');
const EventEmitter = require('events');
const through = require('mississippi').through;

const NOOP_LOGGER = require('./noop-logger');
const SESSION_TTL = 60000;

class SessionManager {
  constructor(opts) {
    opts = opts || {};
    this._sessions = {};
    this.logger = opts.logger || NOOP_LOGGER;
    this.SESSION_TTL = opts.session_ttl || SESSION_TTL;
  }

  toJSON() {
    return Object.keys(this._sessions).map(v => this._sessions[v].toJSON());
  }

  createSession(download_headers, upload_headers) {
    var session = new Session({id: uuid(), ttl: this.SESSION_TTL, logger: this.logger, download_headers: download_headers, upload_headers: upload_headers});
    this._sessions[session.id] = session;
    session.once('deactivated', session => {
      setTimeout(() => {
        delete this._sessions[session.id];
      }, this.SESSION_TTL)
    });
    return session;
  }
  getSession(id) { return this._sessions[id]; }
}

class Session extends EventEmitter {
  constructor(opts) {
    super();
    this.id = opts.id;
    this.state = 'CREATED';
    this.created_at = new Date().toISOString();
    this.active = true;
    this.logger = opts.logger ? opts.logger.child({session: this.id}) : NOOP_LOGGER;
    this._src = undefined;
    this._dst = undefined;
    this._piped = false;
    this.download_headers = opts.download_headers;
    this.upload_headers = opts.upload_headers;
    this.bytes_transferred = 0;
    this._timeout = setTimeout(this._onTimeout.bind(this), opts.ttl);
  }

  toJSON() {
    return {
      id: this.id,
      created_at: this.created_at,
      deactivated_at: this.deactivated_at,
      state: this.state,
      active: this.active,
      error: this.error,
      download_headers: this.download_headers,
      upload_headers: this.upload_headers,
      bytes_transferred: this.bytes_transferred
    };
  }

  registerSource(source) {
    if(this._src) throw new Error('Source already registered');
    this.logger.debug('source registered');

    this._src = source;
    this._src.on('error', this._onSourceError.bind(this));
    this._src.on('close', this._onSourceClose.bind(this));
    this._attemptStreamStart();
    return this;
  }

  registerDestination(destination) {
    if(this._dst) throw new Error('Destination already registered');
    this.logger.debug('destination registered');

    this._dst = destination;
    this._dst.on('error', this._onDestinationError.bind(this));
    this._dst.on('close', this._onDestinationClose.bind(this));
    this._attemptStreamStart();
    return this;
  }

  registerClientError(err) {
    this.client_error = err;
    this.state = 'CLIENT_ERROR';
    this.emit('client_error', this);
    this.deactivate();
  }

  _attemptStreamStart() {
    if(!this._src && !this._dst) return;
    else if(this._src && !this._dst) this.state = 'SRC_CONNECTED';
    else if(this._dst && !this._src) this.state = 'DST_CONNECTED';
    else if(this._src && this._dst) {
      this.state = 'STREAMING';
      clearTimeout(this._timeout);
      this.emit('streaming', this);
      this.logger.debug('streaming');

      this._tstream = through((chunk, enc, next) => {
        this.bytes_transferred += chunk.length;  // TODO: is this is a problem if is a buffer?
        next(null, chunk);
      });

      this._dst.on('finish', this._onDestinationFinish.bind(this));
      this._src.pipe(this._tstream).pipe(this._dst);
      // this._src.pipe(this._dst);
      this._piped = true;
    }
  }

  _onTimeout() {
    var state = 'TIMEOUT';
    if(!this._src) state += '_NO_SRC';
    if(!this._dst) state += '_NO_DST';
    this.state = state;
    this.emit('timeout', this);
    this.logger.debug('timed out '+this.state);
    this.deactivate();
  }
  _onSourceError(err) {
    this.state = 'SRC_ERROR';
    this._unpipe();
    this.emit('error', new Error('Source error: '+err.message));
    this.logger.debug('source error');
    this.deactivate();
  }
  _onDestinationError(err) {
    this.state = 'DST_ERROR';
    this._unpipe();
    this.emit('error', new Error('Destination error: '+err.message));
    this.logger.debug('destination error');
    this.deactivate();
  }
  _onSourceClose(err) {
    if(this.state === 'FINISHED' || !this.active) return;
    this.state = 'SRC_DISCONNECTED';
    this._unpipe();
    this.emit('error', new Error('Source disconnected before end'));
    this.logger.debug('source closed');
    this.deactivate();
  }
  _onDestinationClose(err) {
    if(this.state === 'FINISHED' || !this.active) return;
    this.state = 'DST_DISCONNECTED';
    this._unpipe();
    this.emit('error', new Error('Destination disconnected before end'));
    this.logger.debug('destination closed');
    this.deactivate();
  }
  _onDestinationFinish() {
    if(!this.active) return;
    this.state = 'FINISHED';
    this._unpipe();
    this.emit('finished', this);
    this.logger.debug('finished');
    this.deactivate();
  }
  _unpipe() {
    if(this._piped) {
      this._src.unpipe(this._tstream);
      this._tstream.unpipe(this._dst);
      // this._src.unpipe(this._dst);
      this._piped = false;
    };
    return this;
  }
  deactivate() {
    this.active = false;
    this.deactivated_at = new Date().toISOString();
    this.emit('deactivated', this);
    this._unpipe();
    this.logger.debug('deactivated with final state '+this.state+' with '+this.bytes_transferred+' bytes transferred');

    // forget everything
    this.removeAllListeners();
    clearTimeout(this._timeout);
    delete this._src;
    delete this._dst;
    return this;
  }
}


// Exports
module.exports = SessionManager;
module.exports.Session = Session;
