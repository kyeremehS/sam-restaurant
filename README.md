# sam-restaurant

Restaurant backend built with Express, TypeScript, PostgreSQL, and Konsier.

## Features

- REST API for menu and orders
- PostgreSQL schema auto-initialization on startup
- Seed script for sample data
- Konsier integration for conversational channels (Telegram, WhatsApp, Slack, etc.)

## Tech Stack

- Node.js + TypeScript
- Express 5
- PostgreSQL (`pg`)
- Konsier SDK

## Prerequisites

- Node.js 20+
- PostgreSQL running locally or remotely
- npm

## 1) Install Dependencies

```bash
npm install
```

## 2) Configure Environment Variables

Create a `.env` file in the project root and add:

```env
# Server
PORT=3000

# PostgreSQL
DB_USER=postgres
DB_HOST=localhost
DB_DATABASE=restaurant_db
DB_PASSWORD=your_password
DB_PORT=5432

# Konsier (optional, only needed for channel integrations)
KONSIER_API_KEY=your_konsier_api_key
KONSIER_ENDPOINT_URL=https://your-public-domain.com/konsier
```

Notes:

- If `KONSIER_API_KEY` and `KONSIER_ENDPOINT_URL` are missing, the API still runs, but Konsier is disabled.
- `KONSIER_ENDPOINT_URL` must be publicly reachable for webhook delivery. You can use tools like `ngrok` for local development.

## 3) Run in Development

```bash
npm run dev
```

This starts the server with `nodemon` and `ts-node`.

On startup the app:

1. checks DB connection
2. creates required tables if they do not exist
3. starts Express server
4. syncs Konsier agent config (only if Konsier env vars are set)

## 4) Build and Run in Production Mode

Build:

```bash
npm run build
```

Run compiled output:

```bash
npm start
```

## 5) Seed Sample Data (Optional but Recommended)

Populate menu and sample orders:

```bash
npx ts-node src/seed.ts
```

Important: the seed script truncates and recreates sample data in:

- `menu_items`
- `orders`
- `order_items`

## Available Scripts

- `npm run dev` - Run development server
- `npm run build` - Compile TypeScript to `dist`
- `npm run typecheck` - Run TypeScript check without emitting files
- `npm start` - Run compiled server from `dist/server.js`

## REST API Endpoints

### Health

- `GET /health`

### Menu

- `GET /api/menu`
- `POST /api/menu`

Sample `POST /api/menu` body:

```json
{
	"name": "Waakye",
	"description": "Rice and beans with sides",
	"category": "Main",
	"price": 40,
	"isAvailable": true
}
```

### Orders

- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders`
- `PATCH /api/orders/:id/status`

Sample `POST /api/orders` body:

```json
{
	"customerName": "Samuel K",
	"items": [
		{ "menuItemId": 1, "quantity": 1 },
		{ "menuItemId": 5, "quantity": 2 }
	]
}
```

Sample `PATCH /api/orders/:id/status` body:

```json
{
	"status": "preparing"
}
```

Allowed statuses:

- `pending`
- `preparing`
- `ready`
- `completed`
- `cancelled`

## Konsier Setup (Optional)

If you want AI agent access through Telegram/WhatsApp/Slack/etc:

1. Set `KONSIER_API_KEY` and `KONSIER_ENDPOINT_URL` in `.env`
2. Expose your app publicly (deploy or use a tunnel in development)
3. Start the app
4. In Konsier dashboard, link your agent and connect channels

## Troubleshooting

- DB connection fails:
	- verify PostgreSQL is running
	- verify DB credentials in `.env`
- Konsier not syncing:
	- ensure both Konsier env vars are present
	- ensure endpoint URL is public and points to your app
- Empty menu/orders:
	- run the seed command to populate sample data