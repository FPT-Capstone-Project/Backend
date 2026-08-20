const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool(
  env.databaseUrl
    ? { connectionString: env.databaseUrl, ssl: { rejectUnauthorized: false } }
    : {
        host: env.dbHost,
        port: env.dbPort,
        database: env.dbName,
        user: env.dbUser,
        password: env.dbPassword,
      },
);

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

module.exports = pool;
