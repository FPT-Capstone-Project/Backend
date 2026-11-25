const { randomBytes } = require('node:crypto');

function createQrToken() {
  return randomBytes(32).toString('hex');
}

module.exports = createQrToken;
