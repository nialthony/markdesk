import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublisherSnapshot } from "./snapshot.js";

const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(serviceDirectory, "../../..");
const sourceUrl = process.env.PRESTOCKS_API_URL ?? "https://prestocks.com/api/prestocks";
const timeoutMs = Number.parseInt(process.env.PRESTOCKS_TIMEOUT_MS ?? "5000", 10);
const mode = process.env.MARKDESK_SOURCE === "snapshot" ? "snapshot" : "live";
const configuredOutput = process.env.MARKDESK_OUTPUT_PATH ?? "var/marks.json";
const outputPath = isAbsolute(configuredOutput)
  ? configuredOutput
  : resolve(repositoryRoot, configuredOutput);

async function loadUpstream(): Promise<unknown> {
  if (mode === "snapshot") {
    const fixturePath = resolve(repositoryRoot, "fixtures/prestocks.snapshot.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { assets?: unknown };
    if (!fixture.assets) throw new Error("snapshot fixture is missing assets");
    return fixture.assets;
  }

  const response = await fetch(sourceUrl, {
    headers: { accept: "application/json", "user-agent": "markdesk-publisher/0.1" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`PreStocks API returned HTTP ${response.status}`);
  return response.json();
}

async function main(): Promise<void> {
  const generatedAt = new Date();
  const upstream = await loadUpstream();
  const snapshot = createPublisherSnapshot(upstream, { generatedAt, mode, sourceUrl });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });

  console.log(
    JSON.stringify(
      {
        status: "written",
        outputPath,
        mode,
        assets: snapshot.assets.length,
        generatedAt: snapshot.generatedAt,
        signed: snapshot.signed,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "failed", message }, null, 2));
  process.exitCode = 1;
});
