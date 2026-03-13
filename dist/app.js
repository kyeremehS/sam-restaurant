"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = __importDefault(require("./db"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.get('/', (_req, res) => {
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
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});
app.get('/api/menu', async (_req, res) => {
    try {
        const result = await db_1.default.query(`SELECT id, name, description, category, price, is_available
       FROM menu_items
       ORDER BY id ASC`);
        const menu = result.rows.map((item) => ({
            ...item,
            price: Number(item.price),
        }));
        res.json(menu);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch menu items', details: String(error) });
    }
});
app.post('/api/menu', async (req, res) => {
    const { name, description, category, price, isAvailable } = req.body;
    if (!name || !category || price === undefined || Number.isNaN(Number(price))) {
        res.status(400).json({ error: 'name, category and numeric price are required' });
        return;
    }
    try {
        const result = await db_1.default.query(`INSERT INTO menu_items (name, description, category, price, is_available)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, category, price, is_available`, [name, description ?? null, category, Number(price), isAvailable ?? true]);
        const item = result.rows[0];
        res.status(201).json({ ...item, price: Number(item.price) });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create menu item', details: String(error) });
    }
});
app.get('/api/orders', async (_req, res) => {
    try {
        const result = await db_1.default.query(`SELECT id, customer_name, total_amount, status, created_at
       FROM orders
       ORDER BY id DESC`);
        const orders = result.rows.map((order) => ({
            id: order.id,
            customerName: order.customer_name,
            totalAmount: Number(order.total_amount),
            status: order.status,
            createdAt: order.created_at,
        }));
        res.json(orders);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch orders', details: String(error) });
    }
});
app.get('/api/orders/:id', async (req, res) => {
    const orderId = Number(req.params.id);
    if (Number.isNaN(orderId)) {
        res.status(400).json({ error: 'Invalid order id' });
        return;
    }
    try {
        const orderResult = await db_1.default.query(`SELECT id, customer_name, total_amount, status, created_at
       FROM orders
       WHERE id = $1`, [orderId]);
        if (orderResult.rowCount === 0) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }
        const itemsResult = await db_1.default.query(`SELECT id, order_id, menu_item_id, quantity, unit_price
       FROM order_items
       WHERE order_id = $1
       ORDER BY id ASC`, [orderId]);
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch order', details: String(error) });
    }
});
app.post('/api/orders', async (req, res) => {
    const { customerName, items } = req.body;
    if (!customerName || !items || items.length === 0) {
        res.status(400).json({ error: 'customerName and at least one item are required' });
        return;
    }
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        const orderResult = await client.query(`INSERT INTO orders (customer_name)
       VALUES ($1)
       RETURNING id, customer_name, total_amount, status, created_at`, [customerName]);
        const createdOrder = orderResult.rows[0];
        let totalAmount = 0;
        for (const item of items) {
            if (!item.menuItemId || !item.quantity || item.quantity <= 0) {
                throw new Error('Each item must include valid menuItemId and quantity > 0');
            }
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
         VALUES ($1, $2, $3, $4)`, [createdOrder.id, item.menuItemId, item.quantity, unitPrice]);
        }
        const updatedOrderResult = await client.query(`UPDATE orders
       SET total_amount = $1
       WHERE id = $2
       RETURNING id, customer_name, total_amount, status, created_at`, [totalAmount, createdOrder.id]);
        await client.query('COMMIT');
        const order = updatedOrderResult.rows[0];
        res.status(201).json({
            id: order.id,
            customerName: order.customer_name,
            totalAmount: Number(order.total_amount),
            status: order.status,
            createdAt: order.created_at,
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Failed to create order', details: String(error) });
    }
    finally {
        client.release();
    }
});
app.patch('/api/orders/:id/status', async (req, res) => {
    const orderId = Number(req.params.id);
    const { status } = req.body;
    const allowedStatuses = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
    if (Number.isNaN(orderId) || !status || !allowedStatuses.includes(status)) {
        res.status(400).json({ error: 'Valid order id and status are required' });
        return;
    }
    try {
        const result = await db_1.default.query(`UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING id, customer_name, total_amount, status, created_at`, [status, orderId]);
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update order status', details: String(error) });
    }
});
exports.default = app;
//# sourceMappingURL=app.js.map