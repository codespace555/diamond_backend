import dotenvFlow from "dotenv";
dotenvFlow.config();

const _environment = {
  DIRECT_URL: process.env.DIRECT_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: process.env.PORT || 8080,
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_SECRET: process.env.JWT_SECRET,
  ODDS_API_URL: process.env.ODDS_API_URL || "https://api.the-odds-api.com/v4",
  ODDS_API_KEY: process.env.ODDS_API_KEY || "",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || "10"),
  BASE_URL: process.env.BASE_URL || "http://localhost:3000",
  FRONTEND_URL: process.env.FRONTEND_URL || "*",
};

// Validate required environment variables
const requiredEnvVars = [
  "DATABASE_URL",
  "PORT",
  "NODE_ENV",
  "JWT_SECRET",
] as const;

const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName],
);

if (missingEnvVars.length > 0) {
  console.error(
    "❌ Missing required environment variables:",
    missingEnvVars.join(", "),
  );
  console.error(
    "Please check your .env file and ensure all required variables are set.",
  );
  process.exit(1);
}

export const myEnvironment = Object.freeze(_environment);
