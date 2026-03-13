"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const app_1 = __importDefault(require("./app"));
const db_1 = require("./db");
const konsier_1 = require("./konsier");
const PORT = Number(process.env.PORT) || 3000;
async function startServer() {
    await (0, db_1.testDbConnection)();
    await (0, db_1.initializeSchema)();
    const konsier = (0, konsier_1.setupKonsier)(app_1.default);
    app_1.default.listen(PORT, async () => {
        console.log(`Server is running on http://localhost:${PORT}`);
        if (!konsier.enabled || !konsier.sync) {
            return;
        }
        try {
            await konsier.sync();
            console.log(`Konsier synced successfully. Webhook path: ${konsier.webhookPath ?? '/konsier'}`);
        }
        catch (error) {
            console.error('Konsier sync failed', error);
        }
    });
}
startServer().catch((error) => {
    console.error('Failed to start server', error);
    process.exit(1);
});
//# sourceMappingURL=server.js.map