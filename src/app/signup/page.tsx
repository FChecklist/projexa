import { redirect } from "next/navigation";

// P1: one door. A new e-mail is created the first time it asks for a code on /login (signInWithOtp shouldCreateUser).
export default function SignupPage() {
  redirect("/login");
}
