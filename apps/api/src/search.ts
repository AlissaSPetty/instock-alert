import type { SearchSuggestion } from "@pricechecker/shared";
import { config } from "./config.js";

interface SerpApiOrganicResult {
  title?: string;
  link?: string;
  displayed_link?: string;
  snippet?: string;
}

interface SerpApiSearchResponse {
  organic_results?: SerpApiOrganicResult[];
}

export async function searchSuggestions(query: string): Promise<SearchSuggestion[]> {
  if (!config.SERPAPI_API_KEY) {
    return [];
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("api_key", config.SERPAPI_API_KEY);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "5");

  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as SerpApiSearchResponse;

  return (data.organic_results ?? [])
    .filter((item): item is Required<Pick<SerpApiOrganicResult, "title" | "link">> & SerpApiOrganicResult =>
      Boolean(item.title && item.link),
    )
    .map((item) => ({
      title: item.title,
      url: item.link,
      ...(item.displayed_link ? { displayLink: item.displayed_link } : {}),
      ...(item.snippet ? { snippet: item.snippet } : {}),
    }));
}
