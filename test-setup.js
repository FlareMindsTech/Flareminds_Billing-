// Test bootstrap: guarantee tests never touch the dev database.
//
// - Force NODE_ENV=test.
// - Require the target database name to end in "_test" (default billing_test).
// - Inject that database name into every MongoMemoryServer/MongoMemoryReplSet
//   so even in-memory instances use a *_test database.
// - Guard mongoose.connect so a test can never connect to a non-*_test db.
import mongoose from "mongoose";
import { MongoMemoryServer, MongoMemoryReplSet } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
const dbName = process.env.TEST_DB_NAME || "billing_test";
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run tests: database name "${dbName}" must end in "_test".`);
}
process.env.TEST_DB_NAME = dbName;

const origMemCreate = MongoMemoryServer.create.bind(MongoMemoryServer);
MongoMemoryServer.create = async (opts = {}) => {
  opts = opts || {};
  opts.instance = opts.instance || {};
  if (!opts.instance.dbName) opts.instance.dbName = dbName;
  return origMemCreate(opts);
};

const origReplCreate = MongoMemoryReplSet.create.bind(MongoMemoryReplSet);
MongoMemoryReplSet.create = async (opts = {}) => {
  opts = opts || {};
  opts.instance = opts.instance || {};
  if (!opts.instance.dbName) opts.instance.dbName = dbName;
  opts.replSet = opts.replSet || {};
  return origReplCreate(opts);
};

const origConnect = mongoose.connect.bind(mongoose);
mongoose.connect = async (uri, options) => {
  let target = String(uri || "");
  try {
    const url = new URL(target);
    const name = (url.pathname || "").replace(/^\//, "").split("/")[0] || "";
    if (!name) {
      url.pathname = "/" + dbName;
    }
    target = url.toString();
  } catch {
    // Fallback for non-URL strings
    const name = target.split("/").pop().split("?")[0] || "";
    if (!name) target = target.replace(/\/$/, "") + "/" + dbName;
  }
  const finalName = (() => {
    try { return (new URL(target).pathname || "").replace(/^\//, "").split("/")[0] || ""; }
    catch { return target.split("/").pop().split("?")[0] || ""; }
  })();
  if (!finalName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against non-test database "${finalName}".`);
  }
  return origConnect(target, options);
};

// Keep MONGO_URI pointed at a clearly test-only value for any code that reads it.
process.env.MONGO_URI = `mongodb://127.0.0.1:27017/${dbName}`;

export {};
