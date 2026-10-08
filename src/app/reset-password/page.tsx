import { redirect } from "next/navigation";

// P1: there is no password to reset. Old reset e-mail links and bookmarks land on /login, which shows one plain sentence.
export default function ResetPasswordPage() {
  redirect("/login?notice=no-password");
}
