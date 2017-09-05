const uuid = require('uuid/v4');
const EventEmitter = require('events');
const Promise = require('bluebird');


var SESSION_TIMEOUT = 60000;

class MemorySessionAdapter {
  constructor() {
    this._sessions = {};
    this.SESSION_TIMEOUT = SESSION_TIMEOUT;
  }

  start() { return Promise.resolve(this); }
  stop() { return Promise.resolve(this); }
  createSession() {
    var session = new Session(this, uuid());
    this._sessions[session.id] = session;
    session.once('deleted', session => delete this._sessions[session.id]);
    return Promise.resolve(session);
  }
  getSession(id) { return Promise.resolve(this._sessions[id]); }
}


// Events:
//   * timeout: When the session times out due to or both sides failing to connect
//   * deleted: When the session is deleted after finishing successfully or failing
//   * error: Typical error scenarios TBD
//   * sender: When a sender has connected. Should use `once` to subscribe. Should be subscribed before calling `setReceiver`
//   * receiver: When a reeiver has connected. Should use `once` to subscribe. Should be subscribed before calling `setSender`
//   * end: When a transfer has successfully ended
class Session extends EventEmitter {
  constructor(adapter, opts) {
    this.id = opts.id;
    this._sender = undefined;
    this._receiver = undefined;
    this._timeout = setTimeout(this._onTimeout.bind(this), opts.ttl);
  }

  setSender(sender) {
    if(this._sender) return Promise.reject(new Error('Sender already set'));
    this._sender = sender;
    this.emit('sender', sender, this);

    // if other side is already known, re-emit because this side likely wasn't yet listening
    if(this._receiver) this.emit('receiver', this._receiver);

    return Promise.resolve(this);
  }
  getSender() { return Promise.resolve(this._sender); }
  setReceiver(receiver) {
    if(this._receiver) return Promise.reject(new Error('Receiver already set'));
    this._receiver = receiver;
    this.emit('receiver', receiver, this);

    // if other side is already known, re-emit because this side likely wasn't yet listening
    if(this._sender) this.emit('sender', this._sender);

    return Promise.resolve(this);
  }
  getReceiver() { return Promise.resolve(this._receiver); }
  end() {
    this.emit('end', this);
    this.delete();

    return Promise.resolve(this);
  }

  _onTimeout() {
    this.emit('timeout', this);
    this.delete();
  }
  delete() {
    this.emit('deleted', this);

    // forget everything
    this.removeAllListeners();
    delete this._sender;
    delete this._receiver;

    return Promise.resolve(this);
  }
}


// Exports
module.exports = MemorySessionAdapter;
module.exports.Session = Session;
