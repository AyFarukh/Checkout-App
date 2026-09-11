import mongoose from "mongoose";

let connectionPromise;

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");

  connectionPromise = mongoose
    .connect(uri, {
      dbName: process.env.MONGODB_DB_NAME || "freetheroot_rewards",
      serverSelectionTimeoutMS: 5000,
    })
    .then(() => mongoose.connection)
    .catch((error) => {
      connectionPromise = undefined;
      throw error;
    });

  return connectionPromise;
}

export function databaseHealth() {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  return {
    readyState: mongoose.connection.readyState,
    status: states[mongoose.connection.readyState] || "unknown",
  };
}
