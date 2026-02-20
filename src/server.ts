import http from "http";
import app from "./app";
import { myEnvironment } from "@/configs";
import { SocketService } from "./services/socket.service";

const PORT = myEnvironment.PORT || 8080;

const server = http.createServer(app);

/* ---------------------- SOCKET.IO ------------------ */
const socketService = new SocketService(server);
global.socketService = socketService;

/* -------------------- START SERVER -------------------- */
const startServer = async () => {
  try {
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port: ${myEnvironment.PORT}`);
      console.log(
        `📑 Health check: http://localhost:${myEnvironment.PORT}/health`,
      );
    });
  } catch (error) {
    console.log("❌ Failed to start server", error);
    process.exit(1);
  }
};

startServer();

/* -------------------- GRACEFUL SHUTDOWN -------------------- */
let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n🛑 ${signal} received. Starting graceful shutdown...`);

  try {
    // 1. Stop accepting new requests
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log("✅ HTTP server closed");
        resolve();
      });
    });

    console.log("👋 Shutdown complete. Exiting process.");
    process.exit(0);
  } catch (error) {
    console.log("❌ Error during shutdown", error);
    process.exit(1);
  }
};

/* -------------------- SIGNAL HANDLERS -------------------- */
process.on("SIGINT", shutdown); // Ctrl + C
process.on("SIGTERM", shutdown); // Docker / K8s
