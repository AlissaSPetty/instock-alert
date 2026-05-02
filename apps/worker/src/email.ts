import { Resend } from "resend";
import { config } from "./config";

export type SendInventoryEmailResult =
  | { kind: "sent"; providerId: string }
  | { kind: "failed"; errorMessage: string }
  | { kind: "skipped" };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sends an inventory alert via Resend when EMAIL_NOTIFICATIONS_ENABLED and credentials are set.
 * Returns `skipped` when email sending is disabled or not configured (caller should record `logged`).
 */
export async function sendInventoryAlertEmail(to: string, plainMessage: string): Promise<SendInventoryEmailResult> {
  if (!config.EMAIL_NOTIFICATIONS_ENABLED) {
    return { kind: "skipped" };
  }

  if (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL) {
    return { kind: "skipped" };
  }

  const resend = new Resend(config.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: config.RESEND_FROM_EMAIL,
    to: [to],
    subject: "Pricechecker: item may be in stock",
    html: `<p>${escapeHtml(plainMessage)}</p>`,
  });

  if (error) {
    return { kind: "failed", errorMessage: error.message };
  }

  if (!data?.id) {
    return { kind: "failed", errorMessage: "Resend returned no email id." };
  }

  return { kind: "sent", providerId: data.id };
}
