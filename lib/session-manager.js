const uuid = require('uuid/v4');
const EventEmitter = require('events');
const through = require('mississippi').through;
// const Promise = require('bluebird');


var SESSION_TTL = 60000;

class SessionManager {
  constructor(opts) {
    opts = opts || {};
    this._sessions = {};
    this.SESSION_TTL = opts.session_ttl || SESSION_TTL;
  }

  createSession() {
    var session = new Session({id: uuid(), ttl: this.SESSION_TTL});
    this._sessions[session.id] = session;
    session.once('deleted', session => delete this._sessions[session.id]);
    return session;
  }
  getSession(id) { return this._sessions[id]; }
}


// Events:
//   * timeout: When the session times out due to or both sides failing to connect
//   * deleted: When the session is deleted after finishing successfully or failing
//   * error: Typical error scenarios TBD
//   * source: When a source has connected. Should use `once` to subscribe. Should be subscribed before calling `setDestination`
//   * destination: When a reeiver has connected. Should use `once` to subscribe. Should be subscribed before calling `setSource`
//   * end: When a transfer has successfully ended
class Session extends EventEmitter {
  constructor(opts) {
    super();
    this.id = opts.id;
    this.state = 'CREATED';
    this.deleted = false;
    this._src = undefined;
    this._dst = undefined;
    this._piped = false;
    this.bytes_transferred = 0;
    this._timeout = setTimeout(this._onTimeout.bind(this), opts.ttl);
  }

  registerSource(source) {
    if(this._src) throw new Error('Source already registered');
    this._src = source;
    this._src.on('error', this._onSourceError.bind(this));
    this._src.on('close', this._onSourceClose.bind(this));
    this._attemptStreamStart();
    return this;
  }

  registerDestination(destination) {
    if(this._dst) throw new Error('Destination already registered');
    this._dst = destination;
    this._dst.on('error', this._onDestinationError.bind(this));
    this._dst.on('close', this._onDestinationClose.bind(this));
    this._attemptStreamStart();
    return this;
  }

  _attemptStreamStart() {
    if(!this._src && !this._dst) return;
    else if(this._src && !this._dst) this.state = 'SRC_CONNECTED';
    else if(this._dst && !this._src) this.state = 'DST_CONNECTED';
    else if(this._src && this._dst) {
      this.state = 'STREAMING';
      clearTimeout(this._timeout);
      this.emit('streaming', this);

      this._tstream = through((chunk, enc, next) => {
        this.bytes_transferred += chunk.length;  // TODO: is this is a problem if is a buffer?
        next(null, chunk);
      });

      this._dst.on('finish', this._onDestinationFinish.bind(this));
      this._src.pipe(this._tstream).pipe(this._dst);
      this._piped = true;
    }
  }

  _onTimeout() {
    var state = 'TIMEOUT';
    if(!this._src) state += '_NO_SRC';
    if(!this._dst) state += '_NO_DST';
    this.state = state;
    this.emit('timeout', this);
    this.delete();
  }
  _onSourceError(err) {
    this.state = 'SRC_ERROR';
    this._unpipe();
    this.emit('error', new Error('Source error: '+err.message));
    this.delete();
  }
  _onDestinationError(err) {
    this.state = 'DST_ERROR';
    this._unpipe();
    this.emit('error', new Error('Destination error: '+err.message));
    this.delete();
  }
  _onSourceClose(err) {
    if(['SRC_ENDED', 'COMPLETED'].indexOf(this.state) !== -1) return;
    this.state = 'SRC_DISCONNECTED';
    this._unpipe();
    this.emit('error', new Error('Source disconnected before end'));
    this.delete();
  }
  _onDestinationClose(err) {
    this.state = 'DST_DISCONNECTED';
    this._unpipe();
    this.emit('error', new Error('Destination disconnected before end'));
    this.delete();
  }
  _onDestinationError(err) {
    this.state = 'DST_ERROR';
    this._unpipe();
    this.emit('error', new Error('Destination error: '+err.message));
    this.delete();
  }
  _onDestinationFinish() {
    this.state = 'FINISHED';
    this._unpipe();
    this.emit('finished', this);
    this.delete();
  }
  _unpipe() {
    if(this._piped) {
      this._src.unpipe(this._tstream);
      this._tstream.unpipe(this._dst);
      this._piped = false;
    };
    return this;
  }
  delete() {
    this.deleted = true;
    this.emit('deleted', this);
    this._unpipe();

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
