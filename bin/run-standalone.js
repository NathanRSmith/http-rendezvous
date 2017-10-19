const yargs = require('yargs')
  .option('port', {description: 'port to listen on', type: 'integer', default: 9999})
  .option('log-level', {
    description: 'Logger level',
    type: 'string',
    choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
    default: 'debug'
  })
  .help('h')
  .alias('h','help');
const argv = yargs.argv;
const http = require('http');
const Bunyan = require('bunyan');
const Rendezvous = require('../lib/servers/standalone');

const logger = Bunyan.createLogger({
  name: 'rendezvous-standalone',
  level: argv['log-level']
});

const rendezvous = new Rendezvous({logger: logger});
const server = http.createServer(rendezvous.handleRequest.bind(rendezvous));
server.listen(argv.port);
logger.info('listening on port '+argv.port);


function stop(signal) {
  server.close();
  logger.info('server stopped');
}
process.on('SIGTERM', stop.bind(null, 'SIGTERM'));
process.on('SIGINT', stop.bind(null, 'SIGINT'));
