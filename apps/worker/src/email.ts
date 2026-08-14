export interface EmailSender {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export class CloudflareEmailSender implements EmailSender {
  constructor(
    private readonly binding: SendEmail,
    private readonly fromEmail: string,
  ) {}

  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    try {
      await this.binding.send({
        to: msg.to,
        from: { email: this.fromEmail, name: "Digipology" },
        subject: msg.subject,
        text: msg.text,
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : "E_EMAIL_SERVICE_UNAVAILABLE";
      console.error(JSON.stringify({
        level: "error",
        message: "magic-link email delivery failed",
        code,
      }));
    }
  }
}

export class DevelopmentEmailSender implements EmailSender {
  async send(_msg: { to: string; subject: string; text: string }): Promise<void> {
    // The token-bearing link is available through the dev-only retrieval route.
    // Keeping it out of console output preserves the global no-token-log rule.
    console.info(JSON.stringify({
      level: "info",
      message: "development magic link available",
      retrievalPath: "/api/dev/last-magic-link",
    }));
  }
}
