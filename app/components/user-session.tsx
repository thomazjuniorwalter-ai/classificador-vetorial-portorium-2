"use client";

import { useState } from "react";
import { createClient, passkeysEnabled } from "../lib/supabase/client";

export default function UserSession({
  user,
}: {
  user: { displayName: string; email: string };
}) {
  const [leaving, setLeaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState("");

  async function signOut() {
    setLeaving(true);
    await createClient().auth.signOut();
    window.location.replace("/login");
  }


  async function registerPasskey() {
    if (!passkeysEnabled) return;
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      setPasskeyMessage("Este navegador não oferece chaves de acesso.");
      return;
    }
    setRegistering(true);
    setPasskeyMessage("");
    try {
      const { error } = await createClient().auth.registerPasskey();
      setPasskeyMessage(error
        ? "Não foi possível cadastrar a chave de acesso. Continue usando o código por e-mail."
        : "Chave de acesso cadastrada. Na próxima entrada, utilize Face ID ou a chave de acesso.");
    } catch {
      setPasskeyMessage("Cadastro não concluído. O acesso por e-mail continua disponível.");
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="sessionUser">
      <span>
        <strong>{user.displayName}</strong>
        <small>{user.email}</small>
      </span>
      {passkeysEnabled && (
        <span>
          <button type="button" onClick={registerPasskey} disabled={registering || leaving}>
            {registering ? "Configurando…" : "Ativar Face ID / chave de acesso"}
          </button>
          {passkeyMessage && <small role="status">{passkeyMessage}</small>}
        </span>
      )}
      <button type="button" onClick={signOut} disabled={leaving}>
        {leaving ? "Saindo…" : "Sair"}
      </button>
    </div>
  );
}

