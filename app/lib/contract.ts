/** Today's date in Bangkok as YYYY-MM-DD, the format contracts are stored in. */
export function bangkokToday(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * A contract has expired once its end date is in the past. No end date means
 * an open-ended contract. Expired clients drop out of report work and the
 * default client list.
 */
/** Our own and sister websites: looked after by the team, never treated as a paying client. */
export function isInternal(client: { kind?: string | null }): boolean {
  return client.kind === "internal";
}

/** Whether a client is expected to receive a monthly report. */
export function needsMonthlyReport(client: { kind?: string | null; contract_end: string | null }): boolean {
  return !isInternal(client) && !isContractExpired(client.contract_end);
}

export function isContractExpired(contractEnd: string | null | undefined): boolean {
  return !!contractEnd && contractEnd < bangkokToday();
}

/** Current Bangkok year and month (1-12). */
export function bangkokYearMonth(): { year: number; month: number } {
  const [y, m] = bangkokToday().split("-").map(Number);
  return { year: y, month: m };
}

/** A paying client whose support contract has ended (in-house sites never expire). */
export function clientSupportExpired(client: { kind?: string | null; contract_end: string | null }): boolean {
  return !isInternal(client) && isContractExpired(client.contract_end);
}
