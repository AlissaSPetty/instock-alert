import type { CreateTrackingRequest, InspectUrlRequest, InspectUrlResult, ProfileSettings } from "@pricechecker/shared";
import { supabase } from "./supabase";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("You must be logged in.");
  }

  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export function preflightTracking(body: CreateTrackingRequest) {
  return apiPost("/track/preflight", body);
}

export function createTracking(body: CreateTrackingRequest) {
  return apiPost("/track", body);
}

export function inspectUrl(body: InspectUrlRequest) {
  return apiPost<InspectUrlResult>("/track/inspect-url", body);
}

export function getSettings() {
  return apiGet<{ profile: ProfileSettings }>("/settings");
}

export function updateSettings(body: ProfileSettings) {
  return apiPatch<{ profile: ProfileSettings }>("/settings", body);
}
