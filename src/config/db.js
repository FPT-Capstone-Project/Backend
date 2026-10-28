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
  console.error('Lỗi không mong đợi trong nhóm kết nối PostgreSQL:', error);
});

module.exports = pool;
