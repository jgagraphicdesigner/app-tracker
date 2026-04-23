import { getUserProfile } from "./firebase.js";

// ── EmailJS ─────────────────────────────────────────────────────────────────
// Setup: create account at emailjs.com → add Gmail service → create template
// Template variables: {{to_name}}, {{to_email}}, {{subject}}, {{message}}, {{app_url}}
const EMAILJS_SERVICE_ID  = "YOUR_EMAILJS_SERVICE_ID";   // e.g. service_abc123
const EMAILJS_TEMPLATE_ID = "YOUR_EMAILJS_TEMPLATE_ID";  // e.g. template_xyz456
const EMAILJS_PUBLIC_KEY  = "YOUR_EMAILJS_PUBLIC_KEY";   // e.g. abcDEF123456

const APP_URL = "https://jgagraphicdesigner.github.io/app-tracker/pages/dashboard.html";

let emailjsLoaded = false;

async function loadEmailJS() {
  if (emailjsLoaded || typeof window === "undefined") return;
  return new Promise(resolve => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    s.onload = () => {
      window.emailjs.init(EMAILJS_PUBLIC_KEY);
      emailjsLoaded = true;
      resolve();
    };
    document.head.appendChild(s);
  });
}

async function sendEmail(toUser, subject, message) {
  try {
    const profile = await getUserProfile(toUser);
    if (!profile.email) return;
    await loadEmailJS();
    if (EMAILJS_SERVICE_ID === "YOUR_EMAILJS_SERVICE_ID") {
      console.log(`[EmailJS not configured] Would email ${profile.email}: ${subject}`);
      return;
    }
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_name:  profile.displayName || toUser,
      to_email: profile.email,
      subject,
      message,
      app_url:  APP_URL
    });
    console.log(`Email sent to ${profile.email}`);
  } catch (err) {
    console.error("EmailJS error:", err);
  }
}

// ── WhatsApp via CallMeBot ───────────────────────────────────────────────────
// Free service — no account needed beyond the one-time activation per user
// Each user activates independently and saves their own API key in their profile
async function sendWhatsApp(toUser, message) {
  try {
    const profile = await getUserProfile(toUser);
    if (!profile.whatsapp || !profile.waKey) return;

    const phone   = profile.whatsapp.replace(/[^0-9]/g, "");
    const encoded = encodeURIComponent(message);
    const url     = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${profile.waKey}`;

    const res = await fetch(url, { mode: "no-cors" });
    console.log(`WhatsApp sent to ${profile.whatsapp}`);
  } catch (err) {
    console.error("WhatsApp error:", err);
  }
}

// ── Main dispatcher ──────────────────────────────────────────────────────────
export async function notifyUser(toUser, { title, message, projectName, fromUser, type }) {
  const typeLabel = type === "mention"   ? "🏷 Mention"
    : type === "dm"        ? "💬 Direct message"
    : type === "stage"     ? "📋 Task assigned"
    : type === "new_task"  ? "🆕 New task"
    : type === "published" ? "✅ Task published"
    : "🔔 Notification";
  const subject = `${typeLabel}: ${title}`;
  const body    = `${message}\n\nProject: ${projectName || "—"}\nCheck it here: ${APP_URL}`;
  const waMsg   = `${typeLabel}\n${title}\n${message ? message.slice(0,100) : ""}\n${APP_URL}`;

  await Promise.all([
    sendEmail(toUser, subject, body),
    sendWhatsApp(toUser, waMsg)
  ]);
}
