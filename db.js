import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const connectionConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'sighos',
    };

if (!process.env.DATABASE_URL && (process.env.DB_SSL === 'true' || process.env.RAILWAY_ENVIRONMENT)) {
  connectionConfig.ssl = { rejectUnauthorized: false };
}

export const pool = new Pool(connectionConfig);

pool.on('error', (error) => {
  console.error('[db] Unexpected PostgreSQL pool error:', error);
});

export const query = (text, params = []) => pool.query(text, params);

export const testConnection = async () => {
  await query('SELECT 1');
};

export const closePool = async () => {
  await pool.end();
};
