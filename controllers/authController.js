import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";

const signToken = (admin) =>
  jwt.sign({ id: admin._id, email: admin.email }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const admin = await Admin.findOne({ email: email.toLowerCase() });
  if (!admin) return res.status(401).json({ message: "Invalid email or password" });

  const valid = await admin.comparePassword(password);
  if (!valid) return res.status(401).json({ message: "Invalid email or password" });

  const token = signToken(admin);
  res.json({ token, admin: { email: admin.email, name: admin.name } });
};

// Used by the frontend on load to check if a saved token is still valid.
// export const me = async (req, res) => {
//   const admin = await Admin.findById(req.admin.id).select("-passwordHash");
//   if (!admin) return res.status(404).json({ message: "Admin not found" });
//   res.json({ email: admin.email, name: admin.name });
// };
export const me = async (req, res) => {
  const admin = await Admin.findById(req.admin.id).select("-passwordHash");
  if (!admin) return res.status(404).json({ message: "Admin not found" });
  
  res.set("Cache-Control", "no-store");
  res.json({ email: admin.email, name: admin.name });
};