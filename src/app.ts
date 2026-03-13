import express, { Application, Request, Response } from 'express';
import pool from './db';

type MenuItemRow = {
  id: number;
  name: string;
  description: string | null;
  category: string;
  price: string;
  is_available: boolean;
};

type OrderRow = {
  id: number;
  customer_name: string;
  total_amount: string;
  status: string;
  created_at: Date;
};

type OrderItemRow = {
  id: number;
  order_id: number;
  menu_item_id: number;
  quantity: number;
  unit_price: string;
};

const app: Application = express();

app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'Restaurant API is running',
    endpoints: [
      'GET /health',
      'GET /api/menu',
      'POST /api/menu',
      'GET /api/orders',
      'GET /api/orders/:id',
      'POST /api/orders',
      'PATCH /api/orders/:id/status',
    ],
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/menu', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query<MenuItemRow>(
      `SELECT id, name, description, category, price, is_available
       FROM menu_items
       ORDER BY id ASC`
    );

    const menu = result.rows.map((item) => ({
      ...item,
      price: Number(item.price),
    }));

    res.json(menu);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch menu items', details: String(error) });
  }
});

app.post('/api/menu', async (req: Request, res: Response) => {
  const { name, description, category, price, isAvailable } = req.body as {
    name?: string;
    description?: string;
    category?: string;
    price?: number;
    isAvailable?: boolean;
  };

  if (!name || !category || price === undefined || Number.isNaN(Number(price))) {
    res.status(400).json({ error: 'name, category and numeric price are required' });
    return;
  }

  try {
    const result = await pool.query<MenuItemRow>(
      `INSERT INTO menu_items (name, description, category, price, is_available)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, category, price, is_available`,
      [name, description ?? null, category, Number(price), isAvailable ?? true]
    );

    const item = result.rows[0];
    res.status(201).json({ ...item, price: Number(item.price) });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to create menu item', details: String(error) });
  }
});

app.get('/api/orders', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query<OrderRow>(
      `SELECT id, customer_name, total_amount, status, created_at
       FROM orders
       ORDER BY id DESC`
    );

    const orders = result.rows.map((order) => ({
      id: order.id,
      customerName: order.customer_name,
      totalAmount: Number(order.total_amount),
      status: order.status,
      createdAt: order.created_at,
    }));

    res.json(orders);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch orders', details: String(error) });
  }
});

app.get('/api/orders/:id', async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (Number.isNaN(orderId)) {
    res.status(400).json({ error: 'Invalid order id' });
    return;
  }

  try {
    const orderResult = await pool.query<OrderRow>(
      `SELECT id, customer_name, total_amount, status, created_at
       FROM orders
       WHERE id = $1`,
      [orderId]
    );

    if (orderResult.rowCount === 0) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const itemsResult = await pool.query<OrderItemRow>(
      `SELECT id, order_id, menu_item_id, quantity, unit_price
       FROM order_items
       WHERE order_id = $1
       ORDER BY id ASC`,
      [orderId]
    );

    const order = orderResult.rows[0];

    res.json({
      id: order.id,
      customerName: order.customer_name,
      totalAmount: Number(order.total_amount),
      status: order.status,
      createdAt: order.created_at,
      items: itemsResult.rows.map((item) => ({
        id: item.id,
        menuItemId: item.menu_item_id,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
      })),
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch order', details: String(error) });
  }
});

app.post('/api/orders', async (req: Request, res: Response) => {
  const { customerName, items } = req.body as {
    customerName?: string;
    items?: Array<{ menuItemId: number; quantity: number }>;
  };

  if (!customerName || !items || items.length === 0) {
    res.status(400).json({ error: 'customerName and at least one item are required' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query<OrderRow>(
      `INSERT INTO orders (customer_name)
       VALUES ($1)
       RETURNING id, customer_name, total_amount, status, created_at`,
      [customerName]
    );

    const createdOrder = orderResult.rows[0];
    let totalAmount = 0;

    for (const item of items) {
      if (!item.menuItemId || !item.quantity || item.quantity <= 0) {
        throw new Error('Each item must include valid menuItemId and quantity > 0');
      }

      const menuResult = await client.query<MenuItemRow>(
        `SELECT id, name, description, category, price, is_available
         FROM menu_items
         WHERE id = $1`,
        [item.menuItemId]
      );

      if (menuResult.rowCount === 0) {
        throw new Error(`Menu item ${item.menuItemId} not found`);
      }

      const menuItem = menuResult.rows[0];
      if (!menuItem.is_available) {
        throw new Error(`Menu item ${item.menuItemId} is not available`);
      }

      const unitPrice = Number(menuItem.price);
      totalAmount += unitPrice * item.quantity;

      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [createdOrder.id, item.menuItemId, item.quantity, unitPrice]
      );
    }

    const updatedOrderResult = await client.query<OrderRow>(
      `UPDATE orders
       SET total_amount = $1
       WHERE id = $2
       RETURNING id, customer_name, total_amount, status, created_at`,
      [totalAmount, createdOrder.id]
    );

    await client.query('COMMIT');

    const order = updatedOrderResult.rows[0];
    res.status(201).json({
      id: order.id,
      customerName: order.customer_name,
      totalAmount: Number(order.total_amount),
      status: order.status,
      createdAt: order.created_at,
    });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: 'Failed to create order', details: String(error) });
  } finally {
    client.release();
  }
});

app.patch('/api/orders/:id/status', async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const { status } = req.body as { status?: string };

  const allowedStatuses = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
  if (Number.isNaN(orderId) || !status || !allowedStatuses.includes(status)) {
    res.status(400).json({ error: 'Valid order id and status are required' });
    return;
  }

  try {
    const result = await pool.query<OrderRow>(
      `UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING id, customer_name, total_amount, status, created_at`,
      [status, orderId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const order = result.rows[0];
    res.json({
      id: order.id,
      customerName: order.customer_name,
      totalAmount: Number(order.total_amount),
      status: order.status,
      createdAt: order.created_at,
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to update order status', details: String(error) });
  }
});

export default app;
