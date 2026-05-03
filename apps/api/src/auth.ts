import type { NextFunction, Request, Response } from "express";
import type { User } from "@supabase/supabase-js";
import { hasApprovedRole } from "@pricechecker/shared";
import { config } from "./config.js";
import { supabaseAnon } from "./supabase.js";

export interface AuthenticatedRequest extends Request {
  user: User;
  token: string;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  const { data, error } = await supabaseAnon.auth.getUser(token);

  if (error || !data.user) {
    res.status(401).json({ error: "Invalid session." });
    return;
  }

  (req as AuthenticatedRequest).user = data.user;
  (req as AuthenticatedRequest).token = token;
  next();
}

export function requireApproved(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;

  if (!hasApprovedRole(user.app_metadata, config.APPROVED_ROLE)) {
    res.status(403).json({ error: "Your account is pending approval." });
    return;
  }

  next();
}
