import { Pool } from 'pg';

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
});

export async function testDbConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('Connected to the PostgreSQL database!');
  } finally {
    client.release();
  }
}

export async function initializeSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      category VARCHAR(100) NOT NULL,
      price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
      is_available BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name VARCHAR(150) NOT NULL,
      total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0)
    );
  `);
}

export default pool;