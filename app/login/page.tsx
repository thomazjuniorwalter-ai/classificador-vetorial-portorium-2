"use client";

import { FormEvent, useState } from "react";
import { createClient, passkeysEnabled } from "../lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      setError("Informe um e-mail válido.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { error: requestError } = await createClient().auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true },
      });

      if (requestError) {
        console.error("[auth] Falha ao solicitar código", {
          code: requestError.code,
          message: requestError.message,
          status: requestError.status,
        });

        if (/rate|seconds|limit/i.test(requestError.message)) {
          setError("Aguarde um pouco antes de solicitar outro código.");
          return;
        }

        const reference = [
          requestError.code,
          requestError.status ? `HTTP ${requestError.status}` : "",
        ]
          .filter(Boolean)
          .join(" · ");

        setError(
          `Falha no serviço de e-mail: ${requestError.message}${
            reference ? ` (${reference})` : ""
          }`
        );
        return;
      }

      setEmail(normalizedEmail);
      setCodeSent(true);
      setMessage("Código enviado. Verifique também a pasta de lixo eletrônico.");
    } catch (cause) {
      console.error("[auth] Falha de comunicação ao solicitar código", cause);
      setError(
        `Falha de comunicação com o serviço de login: ${
          cause instanceof Error ? cause.message : "erro não identificado"
        }`
      );
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) {
      setError("Digite o código de 6 números recebido por e-mail.");
      return;
    }

    setLoading(true);
    setError("");
    const { error: verificationError } = await createClient().auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (verificationError) {
      setLoading(false);
      setError("Código inválido ou expirado. Solicite um novo código.");
      return;
    }

    window.location.replace("/");
  }


  async function signInWithPasskey() {
    if (!passkeysEnabled) return;
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      setError("Este navegador não oferece chaves de acesso. Utilize o código por e-mail.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { error: passkeyError } = await createClient().auth.signInWithPasskey();
      if (passkeyError) {
        setError("Não foi possível entrar com a chave de acesso. Utilize o código por e-mail ou tente novamente.");
        return;
      }
      window.location.replace("/");
    } catch {
      setError("A autenticação biométrica não foi concluída. Utilize o código por e-mail.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="authShell">
      <section className="authCard">
        <img src="/grupo-portorium.png" alt="Grupo Portorium" />
        <p className="authEyebrow">ACESSO INDIVIDUAL E PROTEGIDO</p>
        <h1>Classificador Vetorial</h1>
        <p className="authIntro">
          Entre com o e-mail autorizado. Não é necessário criar ou memorizar
          uma senha.
        </p>

        {!codeSent ? (
          <form onSubmit={requestCode}>
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nome@empresa.com.br"
              disabled={loading}
              required
              autoFocus
            />
            <button disabled={loading}>
              {loading ? "Enviando…" : "Receber código por e-mail"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            <label htmlFor="code">Código recebido por e-mail</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="000000"
              disabled={loading}
              required
              autoFocus
            />
            <button disabled={loading}>
              {loading ? "Verificando…" : "Entrar"}
            </button>
            <button
              className="authSecondary"
              type="button"
              onClick={() => {
                setCodeSent(false);
                setCode("");
                setError("");
                setMessage("");
              }}
              disabled={loading}
            >
              Usar outro e-mail
            </button>
          </form>
        )}

        {message && <p className="authMessage">{message}</p>}
        {error && <p className="authError" role="alert">{error}</p>}
        {passkeysEnabled && !codeSent && (
          <button type="button" className="authSecondary" onClick={signInWithPasskey} disabled={loading}>
            Entrar com Face ID ou chave de acesso
          </button>
        )}
        <small className="authNotice">
          O código é pessoal, temporário e não deve ser encaminhado.
        </small>
      </section>
    </main>
  );
}
