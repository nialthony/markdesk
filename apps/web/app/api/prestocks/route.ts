import { getMarketCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = await getMarketCatalog();
  return Response.json(catalog, {
    headers: {
      "cache-control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
