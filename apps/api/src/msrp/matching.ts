export interface MsrpPriceRow {
  product_name?: string | null;
  normalized_name?: string | null;
  type?: string | null;
  price: number | string;
  currency?: string | null;
}

export interface MsrpPriceMatch {
  productName: string | null;
  normalizedName: string | null;
  type: string | null;
  price: number;
  currency: string | null;
  score: number;
}

const MATCH_THRESHOLD = 62;

export function findClosestMsrpPrice(itemName: string, rows: MsrpPriceRow[]): MsrpPriceMatch | null {
  const itemTokens = tokensForMatch(expandKnownAbbreviations(itemName));
  if (itemTokens.length === 0) {
    return null;
  }

  let best: MsrpPriceMatch | null = null;

  for (const row of rows) {
    const price = numericPrice(row.price);
    if (price === null) {
      continue;
    }

    const typeScore = scoreCandidate(itemTokens, row.type, 18);
    const productScore = Math.max(
      scoreCandidate(itemTokens, row.product_name, 0),
      scoreCandidate(itemTokens, row.normalized_name, 0),
    );
    const score = Math.max(typeScore, productScore);

    if (score < MATCH_THRESHOLD || (best && score <= best.score)) {
      continue;
    }

    best = {
      productName: row.product_name ?? null,
      normalizedName: row.normalized_name ?? null,
      type: row.type ?? null,
      price,
      currency: row.currency ?? null,
      score,
    };
  }

  return best;
}

function scoreCandidate(itemTokens: string[], candidate: string | null | undefined, typeBonus: number): number {
  const candidateTokens = tokensForMatch(expandKnownAbbreviations(candidate ?? ""));
  if (candidateTokens.length === 0) {
    return 0;
  }

  const overlap = candidateTokens.filter((token) => itemTokens.includes(token)).length;
  if (overlap === 0) {
    return 0;
  }

  const coverage = overlap / candidateTokens.length;
  const itemCoverage = overlap / itemTokens.length;
  const sequenceBonus = containsTokenSequence(itemTokens, candidateTokens) ? 24 : 0;
  const completeMatchBonus = coverage === 1 ? 20 : 0;
  const lengthBonus = Math.min(candidateTokens.length, 5) * 2;

  return coverage * 48 + itemCoverage * 16 + sequenceBonus + completeMatchBonus + lengthBonus + typeBonus;
}

function containsTokenSequence(tokens: string[], sequence: string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) {
    return false;
  }

  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      return true;
    }
  }

  return false;
}

function tokensForMatch(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .map(stemToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function expandKnownAbbreviations(value: string): string {
  return value.replace(/\betb\b/gi, "elite trainer box");
}

function stemToken(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function numericPrice(value: number | string): number | null {
  const price = typeof value === "number" ? value : Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

const STOP_WORDS = new Set([
  "and",
  "card",
  "cards",
  "of",
  "pokemon",
  "premium",
  "promo",
  "tcg",
  "the",
  "with",
]);
