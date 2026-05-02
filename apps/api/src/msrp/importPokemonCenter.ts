import { readFile } from "node:fs/promises";
import {
  POKEMON_CENTER_TCG_URL,
  extractPokemonCenterCatalogMsrpPrices,
  scrapePokemonCenterTcgMsrpPrices,
  type MsrpPriceCandidate,
} from "./pokemonCenter";
import { supabaseService } from "../supabase";

const input = process.argv[2] ?? POKEMON_CENTER_TCG_URL;
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const rows = await loadRows(input);
  if (rows.length === 0) {
    throw new Error("No MSRP prices were found.");
  }

  if (dryRun) {
    console.log(`Parsed ${rows.length} MSRP prices from ${input}.`);
    console.log(JSON.stringify(rows[0], null, 2));
    return;
  }

  const { error } = await supabaseService.from("msrp_prices").upsert(
    rows.map(toDatabaseRow),
    { onConflict: "source_site,normalized_name" },
  );

  if (error) {
    throw error;
  }

  console.log(`Imported ${rows.length} MSRP prices from ${input}.`);
}

async function loadRows(inputPathOrUrl: string) {
  if (/^https?:\/\//i.test(inputPathOrUrl)) {
    return scrapePokemonCenterTcgMsrpPrices(inputPathOrUrl);
  }

  const raw = await readFile(inputPathOrUrl, "utf8");
  return extractPokemonCenterCatalogMsrpPrices(parsePokemonCenterExport(raw));
}

function parsePokemonCenterExport(raw: string): unknown {
  const trimmed = raw.trim().replace(/;$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayEnd = endOfLeadingJsonArray(trimmed);
    if (arrayEnd !== null) {
      return JSON.parse(trimmed.slice(0, arrayEnd + 1));
    }

    throw new Error("Unable to parse Pokemon Center export JSON.");
  }
}

function endOfLeadingJsonArray(value: string): number | null {
  if (!value.startsWith("[")) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function toDatabaseRow(row: MsrpPriceCandidate) {
  return {
    source_site: row.sourceSite,
    source_url: row.sourceUrl,
    product_name: row.productName,
    normalized_name: row.normalizedName,
    price: row.price,
    currency: row.currency,
    product_url: row.productUrl,
    image_url: row.imageUrl,
    release_date: row.releaseDate,
    type: row.type,
    scraped_at: row.scrapedAt,
    updated_at: new Date().toISOString(),
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
