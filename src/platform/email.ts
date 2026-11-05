import { Resend } from "resend";

export type Email = {
  to: string;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
};

export type EmailResult = { provider: "resend" | "local"; status: "sent" | "logged" };

export interface Mailer {
  send(email: Email): Promise<EmailResult>;
}

export class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send({ to, subject, text, attachments }: Email): Promise<EmailResult> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject,
      text,
      attachments,
    });
    if (error) throw new Error(`Email failed: ${error.message}`);
    return { provider: "resend", status: "sent" };
  }
}

/** Sends nothing. The app's outbox still shows the message, marked as not sent. */
export class LocalMailer implements Mailer {
  readonly sent: Email[] = [];

  async send(email: Email): Promise<EmailResult> {
    this.sent.push(email);
    return { provider: "local", status: "logged" };
  }
}
