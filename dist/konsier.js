"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupKonsier = setupKonsier;
const konsier_1 = require("konsier");
const express_1 = require("konsier/express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("./db"));
const getMenu = konsier_1.Konsier.tool({
    name: 'get_menu',
    description: 'Returns restaurant menu items. Optionally filter by category.',
    input: zod_1.z.object({
        category: zod_1.z.string().optional(),
    }),
    handler: async (input) => {
        const values = [];
        const where = input.category
            ? (() => {
                values.push(input.category);
                return 'WHERE category = $1';
            })()
            : '';
        const result = await db_1.default.query(`SELECT id, name, description, category, price, is_available
       FROM menu_items
       ${where}
       ORDER BY id ASC`, values);
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
const createOrder = konsier_1.Konsier.tool({
    name: 'create_order',
    description: 'Creates a customer order from menu item IDs and quantities.',
    input: zod_1.z.object({
        customerName: zod_1.z.string().optional(),
        customer_name: zod_1.z.string().optional(),
        items: zod_1.z.array(zod_1.z.object({
            menuItemId: zod_1.z.number().int().positive(),
            quantity: zod_1.z.number().int().positive(),
        })).min(1),
    }),
    handler: async (input, ctx) => {
        const providedName = (input.customerName ?? input.customer_name ?? '').trim();
        const contextName = (ctx.user.displayName ?? ctx.user.externalId ?? '').trim();
        const customerName = providedName || contextName || `Customer ${ctx.user.id.slice(0, 8)}`;
        const client = await db_1.default.connect();
        try {
            await client.query('BEGIN');
            const orderResult = await client.query(`INSERT INTO orders (customer_name)
         VALUES ($1)
         RETURNING id, customer_name, total_amount, status, created_at`, [customerName]);
            const order = orderResult.rows[0];
            let totalAmount = 0;
            for (const item of input.items) {
                const menuResult = await client.query(`SELECT id, name, description, category, price, is_available
           FROM menu_items
           WHERE id = $1`, [item.menuItemId]);
                if (menuResult.rowCount === 0) {
                    throw new Error(`Menu item ${item.menuItemId} not found`);
                }
                const menuItem = menuResult.rows[0];
                if (!menuItem.is_available) {
                    throw new Error(`Menu item ${item.menuItemId} is not available`);
                }
                const unitPrice = Number(menuItem.price);
                totalAmount += unitPrice * item.quantity;
                await client.query(`INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price)
           VALUES ($1, $2, $3, $4)`, [order.id, item.menuItemId, item.quantity, unitPrice]);
            }
            const updatedOrder = await client.query(`UPDATE orders
         SET total_amount = $1
         WHERE id = $2
         RETURNING id, customer_name, total_amount, status, created_at`, [totalAmount, order.id]);
            await client.query('COMMIT');
            const savedOrder = updatedOrder.rows[0];
            return {
                orderId: savedOrder.id,
                customerName: savedOrder.customer_name,
                totalAmount: Number(savedOrder.total_amount),
                status: savedOrder.status,
                createdAt: savedOrder.created_at.toISOString(),
            };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    },
});
const trackOrder = konsier_1.Konsier.tool({
    name: 'track_order',
    description: 'Returns the status and total for a restaurant order.',
    input: zod_1.z.object({
        orderId: zod_1.z.number().int().positive(),
    }),
    handler: async (input) => {
        const result = await db_1.default.query(`SELECT id, customer_name, total_amount, status, created_at
       FROM orders
       WHERE id = $1`, [input.orderId]);
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
function setupKonsier(app) {
    const apiKey = process.env.KONSIER_API_KEY;
    const endpointUrl = process.env.KONSIER_ENDPOINT_URL;
    if (!apiKey || !endpointUrl) {
        console.warn('Konsier is disabled. Set KONSIER_API_KEY and KONSIER_ENDPOINT_URL to enable Telegram/WhatsApp integration.');
        return { enabled: false };
    }
    const konsier = new konsier_1.Konsier({
        apiKey,
        endpointUrl,
        agents: {
            restaurant_assistant: {
                name: 'Restaurant Assistant',
                description: 'Handles menu questions and creates/tracks food orders.',
                systemPrompt: 'You are a helpful restaurant assistant. Help users browse menu items, place orders, and track order status.',
                tools: [getMenu, createOrder, trackOrder],
            },
        },
    });
    (0, express_1.serveKonsier)(app, konsier);
    return {
        enabled: true,
        webhookPath: konsier.webhookPath(),
        sync: () => konsier.sync(),
    };
}
//# sourceMappingURL=konsier.js.map