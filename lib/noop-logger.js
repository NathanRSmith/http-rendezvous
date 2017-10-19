const NOOP_LOGGER = {
  error: msg => true,
  warn: msg => true,
  info: msg => true,
  debug: msg => true,
  trace: msg => true,
  child: () => NOOP_LOGGER
};

module.exports = NOOP_LOGGER;
