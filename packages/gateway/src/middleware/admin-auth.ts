import type { Request, Response, NextFunction } from "express";

export function createAdminAuth() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const adminKey = process.env.RT_ADMIN_KEY;
    if (!adminKey) {
      res.status(403).json({ error: "Admin API not configured" });
      return;
    }

    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== adminKey) {
      res.status(401).json({ error: "Invalid admin API key" });
      return;
    }

    next();
  };
}
