/**
 * Fuzzy customer name matching for resolving user-typed names to API customer records.
 * No external dependencies; uses normalization, token overlap, substring checks, and Levenshtein ratio.
 */

export type CustomerRow = {
  id: number;
  customer_name: string;
  country?: string | null;
  segment?: string | null;
  company_code?: string | null;
  agency_type?: string | null;
  number_of_users?: number | null;
  accounts_receivable?: number | null;
};

export type RankedCustomer = CustomerRow & {
  matchScore: number;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

function levenshteinRatio(a: string, b: string): number {
  if (!a.length && !b.length) {
    return 1;
  }
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length, 1);
}

function tokenJaccard(q: string, n: string): number {
  const tq = new Set(q.split(/\s+/).filter((t) => t.length > 1));
  const tn = new Set(n.split(/\s+/).filter((t) => t.length > 1));
  if (tq.size === 0 || tn.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of tq) {
    if (tn.has(t)) {
      inter++;
    }
  }
  const union = tq.size + tn.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Score in [0, 1]. Higher is a better match for resolving a user query to a customer display name.
 */
export function scoreNameMatch(query: string, customerName: string): number {
  const q = normalize(query);
  const n = normalize(customerName);
  if (!q || !n) {
    return 0;
  }
  if (n === q) {
    return 1;
  }

  let best = 0;

  if (n.includes(q)) {
    best = Math.max(best, 0.92 + 0.08 * (q.length / n.length));
  }
  if (q.includes(n) && n.length >= 3) {
    best = Math.max(best, 0.88);
  }

  const levFull = levenshteinRatio(q, n);
  best = Math.max(best, levFull * 0.95);

  const wordsQ = q.split(/\s+/).filter(Boolean);
  const wordsN = n.split(/\s+/).filter(Boolean);
  for (const wq of wordsQ) {
    if (wq.length < 2) {
      continue;
    }
    for (const wn of wordsN) {
      if (wn.includes(wq) || wq.includes(wn)) {
        best = Math.max(best, 0.85);
      }
      best = Math.max(best, levenshteinRatio(wq, wn) * 0.9);
    }
  }

  best = Math.max(best, tokenJaccard(q, n) * 0.9);

  const q3 = q.slice(0, Math.min(3, q.length));
  if (q3.length >= 2 && n.includes(q3)) {
    best = Math.max(best, 0.75);
  }

  return Math.min(1, best);
}

export function rankCustomersByQuery(query: string, customers: CustomerRow[]): RankedCustomer[] {
  return customers
    .map((c) => ({
      ...c,
      matchScore: scoreNameMatch(query, c.customer_name || "")
    }))
    .filter((c) => c.matchScore >= 0.12)
    .sort((a, b) => b.matchScore - a.matchScore);
}
