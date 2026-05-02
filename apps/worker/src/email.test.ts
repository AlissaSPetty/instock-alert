import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    emails: { send: (...args: unknown[]) => mockSend(...args) },
  })),
}));

describe("sendInventoryAlertEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns skipped and does not call Resend when notifications are disabled", async () => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("EMAIL_NOTIFICATIONS_ENABLED", "false");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");

    const { sendInventoryAlertEmail } = await import("./email");
    const result = await sendInventoryAlertEmail("user@test.com", "Hello");

    expect(result).toEqual({ kind: "skipped" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends via Resend and returns sent when enabled", async () => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("EMAIL_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("RESEND_FROM_EMAIL", "Pricechecker <alerts@example.com>");
    mockSend.mockResolvedValue({ data: { id: "em_1" }, error: null });

    const { sendInventoryAlertEmail } = await import("./email");
    const result = await sendInventoryAlertEmail("shopper@example.com", "Item in stock: https://a.com/p/1");

    expect(result).toEqual({ kind: "sent", providerId: "em_1" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Pricechecker <alerts@example.com>",
        to: ["shopper@example.com"],
        subject: "Pricechecker: item may be in stock",
      }),
    );
  });

  it("returns failed when Resend returns an error", async () => {
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("EMAIL_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("RESEND_FROM_EMAIL", "alerts@example.com");
    mockSend.mockResolvedValue({ data: null, error: { message: "rate_limit_exceeded" } });

    const { sendInventoryAlertEmail } = await import("./email");
    const result = await sendInventoryAlertEmail("user@test.com", "msg");

    expect(result).toEqual({ kind: "failed", errorMessage: "rate_limit_exceeded" });
  });
});
