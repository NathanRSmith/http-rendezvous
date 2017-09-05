var yargs = require('yargs')
  .option('port', {description: 'port to listen on', type: 'integer', default: 9999})
  .help('h')
  .alias('h','help');
var argv = yargs.argv;

var logger = {
  error: msg => console.log(new Date().toISOString(), msg),
  warn: msg => console.log(new Date().toISOString(), msg),
  info: msg => console.log(new Date().toISOString(), msg),
  debug: msg => console.log(new Date().toISOString(), msg),
  trace: msg => console.log(new Date().toISOString(), msg),
};

var Rendezvous = require('./');
var rendezvous = new Rendezvous({port: argv.port, logger: logger, stream_timeout: 60000});

rendezvous.start();
