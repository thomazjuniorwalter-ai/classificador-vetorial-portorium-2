"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";

export default function SemAcessoPage() {
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    await createClient().auth.signOut();
    window.location.replace("/login");
  }

  return (
    <main className="authShell">
      <section className="authCard">
        <img src="/grupo-portorium.png" alt="Grupo Portorium" />
        <p className="authEyebrow">ACESSO RESTRITO</p>
        <h1>E-mail ainda não autorizado</h1>
        <p className="authIntro">
          Sua identidade foi confirmada, mas este e-mail não consta na lista de
          usuários habilitados para o Classificador Vetorial.
        </p>
        <button type="button" onClick={signOut} disabled={leaving}>
          {leaving ? "Saindo…" : "Entrar com outro e-mail"}
        </button>
      </section>
    </main>
  );
}

