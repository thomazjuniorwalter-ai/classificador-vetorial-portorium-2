import { redirect } from "next/navigation";
import candidates from "../data/cosit/candidates.json";
import approved from "../data/cosit/approved.json";
import ClassificadorApp from "./app-client";
import { getPortalAccess } from "./lib/auth";

export default async function Home() {
  const access = await getPortalAccess("classificador");

  if (access.status === "unauthenticated") redirect("/login");
  if (access.status !== "authorized") redirect("/sem-acesso");

  return (
    <ClassificadorApp
      user={{ displayName: access.displayName, email: access.email }}
      cosit={{
        abstracts: candidates.records.length,
        collectedAt: candidates.lastSuccessfulCollectionAt,
        eligibleFullTexts: approved.records.filter((r: { ingestionStatus?: string; integrity?: string }) => r.ingestionStatus === "ready" && r.integrity === "full").length,
        configured: !!process.env.OPENAI_COSIT_VECTOR_STORE_ID,
      }}
    />
  );
}

