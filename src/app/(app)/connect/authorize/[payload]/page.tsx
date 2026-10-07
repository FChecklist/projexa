import { ConnectAuthorizeClient } from "./ConnectAuthorizeClient";

// "Sign in with PROJEXA": the page an AI tool (ChatGPT, Claude, Gemini) sends a person to. Protected like every app page, so a person who is
// not signed in is sent to /login first and comes back here. The request travels in the path (see src/lib/connectors/consent.ts).
export default async function ConnectAuthorizePage({ params }: { params: Promise<{ payload: string }> }) {
  const { payload } = await params;
  return <ConnectAuthorizeClient payload={payload} />;
}
