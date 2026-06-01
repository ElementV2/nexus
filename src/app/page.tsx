import { redirect } from "next/navigation";

// The app is local-LAN by design — no landing, no auth: go straight
// to the deck (the always-present surface; the dashboard hub was removed).
export default function HomePage() {
  redirect("/streamdeck");
}
