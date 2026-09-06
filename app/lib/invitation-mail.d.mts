export declare const INVITATION_SENDER: "thomaz@portorium.net";
export declare class InvitationMailError extends Error { readonly code: string; constructor(code: string); }
export type MailConfiguration = {
  tenantId: string; clientId: string; clientSecret: string;
  appOrigin: string; product: "rag" | "classificador";
};
export type InvitationMailer = {
  sendInvitation(input: { recipient: string; token: string }): Promise<{ status: "accepted" }>;
};
export declare function createInvitationMailer(config: MailConfiguration, fetchImpl?: typeof fetch): InvitationMailer;
export declare function invitationMailerFromEnvironment(env?: Record<string, string | undefined>): InvitationMailer;
