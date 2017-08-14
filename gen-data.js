var _ = require('lodash');
var yargs = require('yargs')
  .option('size', {description: 'port to listen on', type: 'integer', default: Math.pow(2, 30)})
  .help('h')
  .alias('h','help');
var argv = yargs.argv;

var miss = require('mississippi');

var count = 0;

miss.from((size, next) => {
  size = Math.min(size, argv.size - count);
  if(size <= 0) {
    next(null, null);
    exitSoon();
  }
  else {
    next(null, _.repeat('*', size));
  }
}).pipe(process.stdout);

function exitSoon() {
  setTimeout(process.exit, 10);
}
