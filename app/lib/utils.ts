import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Generate a random URL-safe ID (uses Web Crypto, works on Workers) */
export function generateId(length = 21): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Thai month names */
const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function getThaiMonth(month: number): string {
  return THAI_MONTHS[month - 1] ?? "";
}

/** Get month name by locale */
export function getMonthName(month: number, locale: "th" | "en" = "th"): string {
  if (locale === "en") return EN_MONTHS[month - 1] ?? "";
  return THAI_MONTHS[month - 1] ?? "";
}

/** Format unix timestamp to locale date string */
export function formatDate(unix: number, locale: "th" | "en" = "th"): string {
  return new Date(unix * 1000).toLocaleDateString(
    locale === "en" ? "en-US" : "th-TH",
    { year: "numeric", month: "long", day: "numeric" }
  );
}

/** Relative time ("2 hours ago" / "2 ชั่วโมงที่แล้ว") */
export function formatRelativeTime(unix: number, locale: "th" | "en" = "th"): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (locale === "en") {
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return formatDate(unix, "en");
  }
  if (diff < 60) return "เมื่อสักครู่";
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return formatDate(unix, "th");
}
