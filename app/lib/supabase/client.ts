import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./config";

// Só exibe a opção após habilitação e validação do provedor de autenticação.
export const passkeysEnabled = process.env.NEXT_PUBLIC_PASSKEYS_ENABLED === "true";

export function createClient() {
  return createBrowserClient(supabaseUrl, supabasePublishableKey, {
    auth: { experimental: { passkey: true } },
  });
}

