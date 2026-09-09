import { redirect } from "next/navigation";
import ClassificadorApp from "./app-client";
import { getPortalAccess } from "./lib/auth";

export default async function Home() {
  const access = await getPortalAccess("classificador");

  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "authorized") redirect("/sem-acesso");

  return (
    <ClassificadorApp
      user={{ displayName: access.displayName, email: access.email }}
    />
  );
}

