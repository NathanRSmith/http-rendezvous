var http = require('http');
var uuid = require('uuid/v4');

var STREAM_GENERATOR_URL_REGEX = /^\/stream\/?$/;
var STREAM_URL_REGEX = /^\/stream\/([a-zA-Z0-9-_]+)\/?$/;
var STREAM_TIMEOUT = 60000;

var Fence = module.exports = function(opts) {
  this.opts = opts || {};
  this.logger = this.opts.logger;
  this.server = http.createServer(this._onRequest.bind(this));
  this._streams = {};
}
Fence.prototype.start = function(port) { this.server.listen(port || this.opts.port); return this; }
Fence.prototype.stop = function() { this.server.close(); return this; }
Fence.prototype.log = function(level, msg) {
  if(this.logger && this.logger[level]) {
    this.logger[level](msg);
  }
  return this;
}
Fence.prototype._onRequest = function(req, rep) {
  this.log('debug', req.method+' '+req.url);
  // handler for stream generator
  if(req.method === 'POST' && req.url.search(STREAM_GENERATOR_URL_REGEX) !== -1) {
    var id = uuid();
    this._streams[id] = {
      timer: setTimeout(this.deleteStream.bind(this, id), this.opts.stream_timeout || STREAM_TIMEOUT)
    };
    this.log('debug', 'stream "'+id+'" created');

    rep.statusCode = 201;
    rep.setHeader('content-type', 'application/json');
    return rep.end('{"stream":"'+id+'"}');
  }
  // handler for stream hookups
  else if(['PUT','GET'].indexOf(req.method) !== -1 && req.url.search(STREAM_URL_REGEX) !== -1) {
    var id = req.url.match(STREAM_URL_REGEX)[1];
    var stream = this._streams[id];
    if(!stream) return reply404(rep);
    if(req.method === 'GET' && stream.dst) return reply403(rep);
    if(req.method === 'PUT' && stream.src) return reply403(rep);
    if(req.method === 'GET') {
      stream.dst = {req: req, rep: rep};
    }
    else if(req.method === 'PUT') {
      stream.src = {req: req, rep: rep};
    }

    // hook up if both present
    if(stream.src && stream.dst) {
      var src = stream.src;
      var dst = stream.dst;

      // TODO: handle closed connections
      src.rep.statusCode = 200;
      dst.rep.statusCode = 200;

      src.req.pipe(dst.rep);
      clearTimeout(stream.timer)

      src.req.on('end', this.deleteStream.bind(this, id));
      src.req.on('close', this.deleteStream.bind(this, id));
      dst.req.on('close', this.deleteStream.bind(this, id));

      return;
    }
  }
  // unknown url
  else {
    return reply404(rep);
  }
}

Fence.prototype.deleteStream = function(id) {
  this.log('debug','delete "'+id+'"');
  if(this._streams[id].src) reply504(this._streams[id].src.rep);
  if(this._streams[id].dst) reply504(this._streams[id].dst.rep);
  delete this._streams[id];
  return this;
}

function reply404(rep, msg) {
  rep.statusCode = 404;
  return rep.end(msg);
}
function reply403(rep, msg) {
  rep.statusCode = 403;
  return rep.end(msg);
}
function reply504(rep, msg) {
  rep.statusCode = 504;
  return rep.end(msg);
}
