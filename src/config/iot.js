function config(source = process.env) {
  const host = source.MQTT_HOST || '';
  const port = Number(source.MQTT_PORT || 8883);
  if (host && (!/^[A-Za-z0-9.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535
      || !source.MQTT_USERNAME || !source.MQTT_PASSWORD)) throw new Error('Invalid or incomplete MQTT configuration');
  return { host, port, username: source.MQTT_USERNAME, password: source.MQTT_PASSWORD,
    clientId: source.MQTT_CLIENT_ID || 'smartmush-backend' };
}

module.exports = config;
