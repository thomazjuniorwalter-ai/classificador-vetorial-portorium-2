"use client";

import { FormEvent, useState } from "react";
import { createClient } from "../lib/supabase/client";

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
    const { error: requestError } = await createClient().auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: true },
    });
    setLoading(false);

    if (requestError) {
      setError(
        /rate|seconds|limit/i.test(requestError.message)
          ? "Aguarde um pouco antes de solicitar outro código."
          : "Não foi possível enviar o código. Tente novamente."
      );
      return;
    }

    setEmail(normalizedEmail);
    setCodeSent(true);
    setMessage("Código enviado. Verifique também a pasta de lixo eletrônico.");
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
        <small className="authNotice">
          O código é pessoal, temporário e não deve ser encaminhado.
        </small>
      </section>
    </main>
  );
}

