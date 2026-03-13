import type { Application } from 'express';
import { Konsier } from 'konsier';
import { serveKonsier } from 'konsier/express';
import { z } from 'zod';
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

type SetupResult = {
  enabled: boolean;
  webhookPath?: string;
  sync?: () => Promise<void>;
};

const getMenu = Konsier.tool({
  name: 'get_menu',
  description: 'Returns restaurant menu items. Optionally filter by category.',
  input: z.object({
    category: z.string().optional(),
  }),
  handler: async (input) => {
    const values: Array<string> = [];
    const where = input.category
      ? (() => {
          values.push(input.category);
          return 'WHERE category = $1';
        })()
      : '';

    const result = await pool.query<MenuItemRow>(
      `SELECT id, name, description, category, price, is_available
       FROM menu_items
       ${where}
       ORDER BY id ASC`,
      values
    );

    return {
      items: result.rows.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        price: Number(item.price),
        isAvailable: item.is_available,
      })),
    };
  },
});

const createOrder = Konsier.tool({
  name: 'create_order',
  description: 'Creates a customer order from menu item IDs and quantities.',
  input: z.object({
    customerName: z.string().optional(),
    customer_name: z.string().optional(),
    items: z.array(
      z.object({
        menuItemId: z.number().int().positive(),
        quantity: z.number().int().positive(),
      })
    ).min(1),
  }),
  handler: async (input, ctx) => {
    const providedName = (input.customerName ?? input.customer_name ?? '').trim();
    const contextName = (ctx.user.displayName ?? ctx.user.externalId ?? '').trim();
    const customerName = providedName || contextName || `Customer ${ctx.user.id.slice(0, 8)}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query<OrderRow>(
        `INSERT INTO orders (customer_name)
         VALUES ($1)
         RETURNING id, customer_name, total_amount, status, created_at`,
        [customerName]
      );

      const order = orderResult.rows[0];
      let totalAmount = 0;

      for (const item of input.items) {
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
          [order.id, item.menuItemId, item.quantity, unitPrice]
        );
      }

      const updatedOrder = await client.query<OrderRow>(
        `UPDATE orders
         SET total_amount = $1
         WHERE id = $2
         RETURNING id, customer_name, total_amount, status, created_at`,
        [totalAmount, order.id]
      );

      await client.query('COMMIT');

      const savedOrder = updatedOrder.rows[0];
      return {
        orderId: savedOrder.id,
        customerName: savedOrder.customer_name,
        totalAmount: Number(savedOrder.total_amount),
        status: savedOrder.status,
        createdAt: savedOrder.created_at.toISOString(),
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
});

const trackOrder = Konsier.tool({
  name: 'track_order',
  description: 'Returns the status and total for a restaurant order.',
  input: z.object({
    orderId: z.number().int().positive(),
  }),
  handler: async (input) => {
    const result = await pool.query<OrderRow>(
      `SELECT id, customer_name, total_amount, status, created_at
       FROM orders
       WHERE id = $1`,
      [input.orderId]
    );

    if (result.rowCount === 0) {
      return { found: false, message: 'Order not found', order: null };
    }

    const order = result.rows[0];
    return {
      found: true,
      message: null,
      order: {
        id: order.id,
        customerName: order.customer_name,
        totalAmount: Number(order.total_amount),
        status: order.status,
        createdAt: order.created_at.toISOString(),
      },
    };
  },
});

export function setupKonsier(app: Application): SetupResult {
  const apiKey = process.env.KONSIER_API_KEY;
  const endpointUrl = process.env.KONSIER_ENDPOINT_URL;

  if (!apiKey || !endpointUrl) {
    console.warn(
      'Konsier is disabled. Set KONSIER_API_KEY and KONSIER_ENDPOINT_URL to enable Telegram/WhatsApp integration.'
    );
    return { enabled: false };
  }

  const konsier = new Konsier({
    apiKey,
    endpointUrl,
    agents: {
      restaurant_assistant: {
        name: 'Restaurant Assistant',
        description: 'Handles menu questions and creates/tracks food orders.',
        systemPrompt:
          'You are a helpful restaurant assistant. Help users browse menu items, place orders, and track order status.',
        tools: [getMenu, createOrder, trackOrder],
      },
    },
  });

  serveKonsier(app, konsier);

  return {
    enabled: true,
    webhookPath: konsier.webhookPath(),
    sync: () => konsier.sync(),
  };
}
