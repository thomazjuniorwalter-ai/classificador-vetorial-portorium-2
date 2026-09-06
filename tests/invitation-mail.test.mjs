import test from "node:test";
import assert from "node:assert/strict";
import { createInvitationMailer, INVITATION_SENDER, InvitationMailError } from "../app/lib/invitation-mail.mjs";

const config = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientSecret: "synthetic-test-secret",
  appOrigin: "https://rag.example.test",
  product: "rag",
};
const invitation = { recipient: " Convidado@example.test ", token: "a".repeat(43) };
function mockTransport(responses) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error("Unexpected request");
      return response;
    },
  };
}
function authResponse() {
  return new Response(JSON.stringify({ access_token: "synthetic-access-token", token_type: "Bearer" }), { status: 200 });
}

for (const product of ["rag", "classificador"]) {
  test("sender and destination are fixed for " + product, async () => {
    const mock = mockTransport([authResponse(), new Response(null, { status: 202 })]);
    const mailer = createInvitationMailer({ ...config, product }, mock.fetch);
    assert.equal(mock.calls.length, 0);
    assert.deepEqual(await mailer.sendInvitation({ ...invitation, from: "attacker@example.test" }), { status: "accepted" });
    assert.equal(mock.calls.length, 2);
    const [auth, send] = mock.calls;
    assert.equal(auth.url, "https://login.microsoftonline.com/" + config.tenantId + "/oauth2/v2.0/token");
    assert.equal(new URLSearchParams(auth.options.body).get("scope"), "https://graph.microsoft.com/.default");
    assert.equal(send.url, "https://graph.microsoft.com/v1.0/users/thomaz%40portorium.net/sendMail");
    const data = JSON.parse(send.options.body);
    assert.equal(data.message.from.emailAddress.address, INVITATION_SENDER);
    assert.deepEqual(data.message.toRecipients, [{ emailAddress: { address: "convidado@example.test" } }]);
    assert.equal(data.saveToSentItems, true);
    assert.equal(data.message.ccRecipients, undefined);
    assert.equal(data.message.bccRecipients, undefined);
    assert.equal(data.message.attachments, undefined);
    assert.ok(data.message.body.content.includes(config.appOrigin + "/aceitar-convite#token=" + invitation.token));
    assert.ok(!data.message.body.content.includes(config.clientSecret));
    assert.ok(!data.message.body.content.includes("synthetic-access-token"));
    assert.equal(send.options.redirect, "error");
    assert.equal(send.options.cache, "no-store");
    assert.ok(send.options.signal instanceof AbortSignal);
  });
}

for (const patch of [
  { tenantId: "common" }, { clientId: "" }, { clientSecret: "" },
  { appOrigin: "http://example.test" }, { appOrigin: "https://user:pass@example.test" },
  { appOrigin: "https://example.test/path" }, { appOrigin: "https://example.test?next=evil" },
  { product: "__proto__" }, { product: "other" },
]) {
  test("invalid configuration fails closed: " + JSON.stringify(patch), () => {
    const mock = mockTransport([]);
    assert.throws(() => createInvitationMailer({ ...config, ...patch }, mock.fetch), InvitationMailError);
    assert.equal(mock.calls.length, 0);
  });
}

for (const patch of [
  { recipient: "user@example.test\r\nBcc: other@example.test" },
  { recipient: "a@example.test,b@example.test" },
  { recipient: "not-an-address" }, { recipient: "" },
  { token: "https://evil.test" }, { token: "short" },
  { token: "a".repeat(42) + "/" },
]) {
  test("invalid invitation never contacts Microsoft: " + JSON.stringify(patch), async () => {
    const mock = mockTransport([]);
    const mailer = createInvitationMailer(config, mock.fetch);
    await assert.rejects(mailer.sendInvitation({ ...invitation, ...patch }), InvitationMailError);
    assert.equal(mock.calls.length, 0);
  });
}

for (const status of [400, 401, 403, 429, 500]) {
  test("authentication " + status + " cannot send mail", async () => {
    const mock = mockTransport([new Response("private provider details", { status })]);
    const mailer = createInvitationMailer(config, mock.fetch);
    await assert.rejects(mailer.sendInvitation(invitation), (error) => {
      assert.equal(error.code, "authentication_rejected");
      assert.ok(!error.message.includes("private provider details"));
      return true;
    });
    assert.equal(mock.calls.length, 1);
  });
}

test("malformed token response fails closed", async () => {
  const mock = mockTransport([new Response("not-json", { status: 200 })]);
  await assert.rejects(createInvitationMailer(config, mock.fetch).sendInvitation(invitation),
    { code: "authentication_invalid_response" });
  assert.equal(mock.calls.length, 1);
});

test("missing access token fails closed", async () => {
  const mock = mockTransport([new Response("{}", { status: 200 })]);
  await assert.rejects(createInvitationMailer(config, mock.fetch).sendInvitation(invitation),
    { code: "authentication_invalid_response" });
});

for (const status of [200, 400, 401, 403, 429, 500]) {
  test("mail response " + status + " is not reported as accepted", async () => {
    const mock = mockTransport([authResponse(), new Response("private details", { status })]);
    await assert.rejects(createInvitationMailer(config, mock.fetch).sendInvitation(invitation),
      { code: "send_rejected" });
    assert.equal(mock.calls.length, 2);
  });
}

test("ambiguous failure is not retried and leaks no secrets", async () => {
  const mock = mockTransport([authResponse(), new Error("private secret and token")]);
  await assert.rejects(createInvitationMailer(config, mock.fetch).sendInvitation(invitation), (error) => {
    assert.equal(error.code, "send_unconfirmed");
    assert.ok(!error.message.includes("private secret"));
    return true;
  });
  assert.equal(mock.calls.length, 2);
});
