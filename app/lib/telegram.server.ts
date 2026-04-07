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

async function sendToTelegramChat(
  token: string,
  chatId: number | string,
  notification: TelegramNotification,
  appUrl: string
): Promise<void> {
  const absoluteLink = toAbsoluteUrl(appUrl, notification.link);
  const lines = [
    `[Notification] ${notification.title}`,
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
    // Check if default group ID is set in settings
    const defaultGroupId = await db.getAppSetting("telegram_default_group_id");
    if (defaultGroupId) {
      await sendToTelegramChat(token, defaultGroupId, notification, appUrl);
    } else {
      // Fall back to latest chat
      const chatId = await getLatestChatId(token);
      if (chatId) {
        await sendToTelegramChat(token, chatId, notification, appUrl);
      }
    }
  } catch {
    // Do not block app notifications when Telegram fails.
  }
}

/**
 * Send Telegram notification to Co-Admin specific groups for a client.
 * If a Co-Admin is assigned to the client with a telegram_group_id,
 * the notification will be sent to that group.
 * Falls back to default Telegram behavior if no Co-Admin group is configured.
 */
export async function sendTelegramNotificationForClient(params: {
  db: DB;
  appUrl: string;
  notification: TelegramNotification;
  clientId: string;
}): Promise<void> {
  const { db, appUrl, notification, clientId } = params;
  const token = await db.getAppSetting("telegram_bot_token");
  if (!token) return;

  try {
    // Get Co-Admins assigned to this client with telegram groups
    const coAdmins = await db.listCoAdminsForClient(clientId);
    const coAdminsWithGroups = coAdmins.filter((ca) => ca.telegram_group_id);

    // Send to each Co-Admin's specific group
    for (const coAdmin of coAdminsWithGroups) {
      if (coAdmin.telegram_group_id) {
        try {
          await sendToTelegramChat(token, coAdmin.telegram_group_id, notification, appUrl);
        } catch {
          // Continue to next Co-Admin if one fails
        }
      }
    }

    // If no Co-Admin groups configured, fall back to default group ID or latest chat
    if (coAdminsWithGroups.length === 0) {
      const defaultGroupId = await db.getAppSetting("telegram_default_group_id");
      if (defaultGroupId) {
        // Use default group ID from settings
        await sendToTelegramChat(token, defaultGroupId, notification, appUrl);
      } else {
        // Fall back to latest chat
        const chatId = await getLatestChatId(token);
        if (chatId) {
          await sendToTelegramChat(token, chatId, notification, appUrl);
        }
      }
    }
  } catch {
    // Do not block app notifications when Telegram fails.
  }
}

/**
 * Send Telegram notification to a specific chat/group ID.
 * Used for testing or sending to a specific known group.
 */
export async function sendTelegramNotificationToGroup(params: {
  db: DB;
  appUrl: string;
  notification: TelegramNotification;
  telegramGroupId: string;
}): Promise<void> {
  const { db, appUrl, notification, telegramGroupId } = params;
  const token = await db.getAppSetting("telegram_bot_token");
  if (!token) return;

  try {
    await sendToTelegramChat(token, telegramGroupId, notification, appUrl);
  } catch {
    // Do not block app notifications when Telegram fails.
  }
}
