import { redirect } from "next/navigation";

// P1: there is no password any more, so "forgot" is the same e-mailed 6-digit code as every other sign-in. One door: /login.
export default function ForgotPasswordPage() {
  redirect("/login");
}
