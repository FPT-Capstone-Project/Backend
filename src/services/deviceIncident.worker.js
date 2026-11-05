const model = require('../models/deviceIncident.model');

function createWorker(repository = model, logger = console) {
  let timer, pending;
  function tick() {
    if (pending) return pending;
    pending = repository.scan()
      .catch(error => logger.error('Không thể kiểm tra sự cố thiết bị:', error))
      .finally(() => { pending = null; });
    return pending;
  }
  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(tick, 10000);
      timer.unref();
      void tick();
    },
    async stop() { clearInterval(timer); timer = null; await pending; },
  };
}
module.exports = { ...createWorker(), createWorker };
