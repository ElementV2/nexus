import { redirect } from "next/navigation";

// The app is local-LAN by design — no landing, no auth: go straight
// to the dashboard.
export default function HomePage() {
  redirect("/dashboard");
}
