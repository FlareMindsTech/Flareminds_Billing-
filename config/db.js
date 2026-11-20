import mongoose from "mongoose";

export const connectDB = async () => {
  // Tests must never connect to the development database. If a test process
  // somehow still points at the dev/Atlas URI, refuse instead of touching it.
  if (process.env.NODE_ENV === "test") {
    const uri = process.env.MONGO_URI || "";
    if (/flareminds_billing|vignesh\.q1mip|mongodb\+srv/i.test(uri)) {
      throw new Error("Refusing to connect to the development database during tests.");
    }
  }

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set. Create a .env file (see .env.example) and restart.");
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }
};
