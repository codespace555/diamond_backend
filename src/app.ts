import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { errorHandler, notFoundHandler } from "./middlewares";
import routes from "@/routes"
const app: Application = express();

// Security middlewares
app.use(helmet());
app.use(
  cors({
    origin: ["http://localhost:5173", "https://gilded-faloodeh-e29733.netlify.app"],
    optionsSuccessStatus: 200,
    credentials: true,
    maxAge: 86400,
  }),
);
app.disable("x-powered-by");


// Body parsers && cookie
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));
app.use(cookieParser());

// Compression && Logging
app.use(compression());

// Static files
app.use(express.static("public"));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
app.use("/api", routes);

// Error handler (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;