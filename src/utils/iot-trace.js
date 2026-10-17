// Only pass validated identifiers and timing/state metadata, never credentials or payloads.
function trace(logger, event, fields = {}) {
  logger.info(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

module.exports = trace;
