// Server-side transport only. The caller must authenticate Walter, persist a
// single-use invitation and enforce rate limits before invoking this module.
export const INVITATION_SENDER = "thomaz@portorium.net";
const PRODUCTS = Object.freeze({
  rag: "RAG Aduaneiro Portorium",
  classificador: "Classificador Vetorial Portorium",
});
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export class InvitationMailError extends Error {
  constructor(code) {
    super("Não foi possível confirmar o envio do convite pelo Microsoft 365.");
    this.name = "InvitationMailError";
    this.code = code;
  }
}

function configurationError() {
  throw new InvitationMailError("configuration");
}

function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { configurationError(); }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") configurationError();
  return url.origin;
}

/**
 * Creates a transport without contacting Microsoft or reading credentials.
 * Construct on demand on the server, never in a browser or at build time.
 * No generic mail, sender override, attachment, CC or BCC API is exposed.
 */
export function createInvitationMailer(config, fetchImpl = globalThis.fetch) {
  if (typeof window !== "undefined") configurationError();
  const { tenantId, clientId, clientSecret, appOrigin, product } = config;
  if (!GUID.test(tenantId || "") || !GUID.test(clientId || "") ||
      typeof clientSecret !== "string" || !clientSecret.trim() ||
      !Object.hasOwn(PRODUCTS, product) || typeof fetchImpl !== "function") configurationError();
  const origin = validateOrigin(appOrigin);
  const tokenEndpoint = "https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/token";
  const mailEndpoint = "https://graph.microsoft.com/v1.0/users/" +
    encodeURIComponent(INVITATION_SENDER) + "/sendMail";

  // Deliberately no automatic retry: an ambiguous response may already have sent
  // the email. The invitation service must track the attempt and handle resends.
  async function request(url, options, errorCode) {
    try {
      return await fetchImpl(url, {
        ...options,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      // Never expose provider bodies, tokens, recipient addresses or invite URLs.
      throw new InvitationMailError(errorCode);
    }
  }

  return Object.freeze({
    async sendInvitation({ recipient, token }) {
      const email = typeof recipient === "string" ? recipient.trim().toLowerCase() : "";
      if (email.length > 254 || !EMAIL.test(email) ||
          email.split("@")[0].length > 64 || email.includes("..")) {
        throw new InvitationMailError("invalid_recipient");
      }
      // 32 random bytes, base64url encoded by the invitation service.
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new InvitationMailError("invalid_invitation");
      }
      // Fragment avoids sending the invitation token in URL request logs.
      // The acceptance page must POST it to the server and clear the fragment.
      const inviteUrl = origin + "/aceitar-convite#token=" + token;
      const auth = await request(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }).toString(),
      }, "authentication_unavailable");
      if (!auth.ok) throw new InvitationMailError("authentication_rejected");
      let credentials;
      try { credentials = await auth.json(); }
      catch { throw new InvitationMailError("authentication_invalid_response"); }
      if (typeof credentials.access_token !== "string" ||
          !credentials.access_token || /[\r\n]/.test(credentials.access_token) ||
          String(credentials.token_type).toLowerCase() !== "bearer") {
        throw new InvitationMailError("authentication_invalid_response");
      }
      const body = {
        message: {
          subject: "Convite de acesso — " + PRODUCTS[product],
          from: { emailAddress: { address: INVITATION_SENDER } },
          replyTo: [{ emailAddress: { address: INVITATION_SENDER } }],
          toRecipients: [{ emailAddress: { address: email } }],
          body: {
            contentType: "Text",
            content: [
              "Walter convidou você para acessar o " + PRODUCTS[product] + ".",
              "",
              "Use o link abaixo para definir sua senha individual:",
              inviteUrl,
              "",
              "O link é pessoal, de uso único e sujeito ao prazo informado na página de ativação.",
              "Não compartilhe o link nem sua senha.",
              "Se você não esperava este convite, responda a este e-mail.",
              "",
              "Portorium",
            ].join("\n"),
          },
        },
        saveToSentItems: true,
      };
      const sent = await request(mailEndpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + credentials.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }, "send_unconfirmed");
      if (sent.status !== 202) throw new InvitationMailError("send_rejected");
      // Graph 202 acknowledges acceptance, not inbox delivery.
      return { status: "accepted" };
    },
  });
}

/** Lazy server entry point; importing this module has no side effects. */
export function invitationMailerFromEnvironment(env = process.env) {
  return createInvitationMailer({
    tenantId: env.PORTORIUM_MS_TENANT_ID,
    clientId: env.PORTORIUM_MS_CLIENT_ID,
    clientSecret: env.PORTORIUM_MS_CLIENT_SECRET,
    appOrigin: env.PORTORIUM_APP_URL,
    product: env.PORTORIUM_PRODUCT,
  });
}
