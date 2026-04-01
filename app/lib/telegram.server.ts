import type { DB } from "~/lib/db.server";

type TelegramNotification = {
  title: string;
  body: string | null;
  link: string | null;
};

function toAbsoluteUrl(appUrl: string, link: string | null): string | null {
  if (!link) return null;
  if (link.startsWith("http://") || link.startsWith("https://")) return link;
  return `${appUrl.replace(/\/$/, "")}${link.startsWith("/") ? "" : "/"}${link}`;
}

async function getLatestChatId(token: string): Promise<number | null> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?limit=10&timeout=0`
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ok?: boolean;
    result?: Array<{ message?: { chat?: { id?: number } } }>;
  };
  if (!data.ok || !data.result?.length) return null;

  for (let i = data.result.length - 1; i >= 0; i--) {
    const chatId = data.result[i]?.message?.chat?.id;
    if (typeof chatId === "number") return chatId;
  }
  return null;
}

export async function sendTelegramNotification(params: {
  db: DB;
  appUrl: string;
  notification: TelegramNotification;
}): Promise<void> {
  const { db, appUrl, notification } = params;
  const token = await db.getAppSetting("telegram_bot_token");
  if (!token) return;

  try {
    const chatId = await getLatestChatId(token);
    if (!chatId) return;

    const absoluteLink = toAbsoluteUrl(appUrl, notification.link);
    const lines = [
      `🔔 ${notification.title}`,
      notification.body || "",
      absoluteLink ? `\n${absoluteLink}` : "",
    ].filter(Boolean);

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // Do not block app notifications when Telegram fails.
  }
}
