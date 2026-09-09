import { createClient } from "./supabase/server";

export type Portal = "classificador" | "rag";

export type PortalAccess =
  | { status: "unauthenticated" }
  | { status: "unauthorized"; email: string }
  | {
      status: "authorized";
      email: string;
      displayName: string;
    };

export async function getPortalAccess(
  portal: Portal
): Promise<PortalAccess> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) return { status: "unauthenticated" };

  const email = user.email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("authorized_users")
    .select(
      "email, display_name, active, can_access_classificador, can_access_rag"
    )
    .eq("email", email)
    .maybeSingle();

  if (error || !data?.active) return { status: "unauthorized", email };

  const allowed =
    portal === "classificador"
      ? data.can_access_classificador
      : data.can_access_rag;

  if (!allowed) return { status: "unauthorized", email };

  return {
    status: "authorized",
    email,
    displayName:
      data.display_name?.trim() ||
      String(user.user_metadata?.full_name || "").trim() ||
      email,
  };
}

export function portalAccessResponse(access: PortalAccess) {
  if (access.status === "unauthenticated") {
    return Response.json(
      { error: "Sua sessão expirou. Entre novamente para continuar." },
      { status: 401 }
    );
  }

  return Response.json(
    { error: "Este e-mail não possui acesso a este aplicativo." },
    { status: 403 }
  );
}

