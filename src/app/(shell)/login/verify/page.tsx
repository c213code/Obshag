import { redirect } from "next/navigation";

/** The email-code step is gone (sign-in is email + password): old links and bookmarks land on /login. */
export default function VerifyPage() {
  redirect("/login");
}
