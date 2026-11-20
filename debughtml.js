import "dotenv/config";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
// reuse? Instead, just parse a saved html file if exists.
const fs = await import("node:fs");
const html = fs.readFileSync(process.argv[2], "utf8");
console.log("hasIGST", /IGST/.test(html));
console.log("hasCGST", /CGST/.test(html));
console.log("hasSGST", /SGST/.test(html));
const idx = html.indexOf("GST");
console.log(html.slice(Math.max(0, idx-200), idx+400));
