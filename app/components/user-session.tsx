"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";

export default function UserSession({
  user,
}: {
  user: { displayName: string; email: string };
}) {
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    await createClient().auth.signOut();
    window.location.replace("/login");
  }

  return (
    <div className="sessionUser">
      <span>
        <strong>{user.displayName}</strong>
        <small>{user.email}</small>
      </span>
      <button type="button" onClick={signOut} disabled={leaving}>
        {leaving ? "Saindo…" : "Sair"}
      </button>
    </div>
  );
}

