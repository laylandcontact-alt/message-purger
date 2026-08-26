import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;
const distDir = `${root}/build/dist`;
const pluginDir = `${root}/plugins/message-purger`;
const zipPath = `${distDir}/message-purger.zip`;

await mkdir(distDir, { recursive: true });
await rm(zipPath, { force: true });
await rm(`${root}/docs/message-purger.zip`, { force: true });
execFileSync(
    "zip",
    [
        "-j",
        zipPath,
        `${pluginDir}/manifest.json`,
        `${pluginDir}/build/js/index.js`,
    ],
    { stdio: "inherit" },
);

const baseUrl =
    process.env.PLUGIN_REPOSITORY_URL ??
    "https://laylandcontact-alt.github.io/message-purger";
execFileSync(
    "npx",
    [
        "tsx",
        "node_modules/@revenge-mod/plugin-cli/src/main.ts",
        "generate-index",
        "--dist",
        "build/dist",
        "--base-url",
        baseUrl,
        "--out",
        "docs/index.json",
    ],
    { cwd: root, stdio: "inherit" },
);

const zip = await readFile(zipPath);
await copyFile(zipPath, `${root}/docs/message-purger.zip`);
console.log(`Packaged ${zipPath}`);
console.log(`SHA-256: ${createHash("sha256").update(zip).digest("hex")}`);

const legacyDir = `${root}/compat/message-purger`;
const legacyOutputDir = `${root}/docs/builds/message-purger`;
await mkdir(legacyOutputDir, { recursive: true });
await copyFile(`${root}/compat/repo.json`, `${root}/docs/repo.json`);
await copyFile(`${legacyDir}/index.js`, `${legacyOutputDir}/index.js`);
const legacyScript = await readFile(`${legacyDir}/index.js`, "utf8");
const legacyManifest = JSON.parse(
    await readFile(`${legacyDir}/manifest.json`, "utf8"),
);
legacyManifest.hash = createHash("sha256").update(legacyScript).digest("hex");
await writeFile(
    `${legacyOutputDir}/manifest.json`,
    `${JSON.stringify(legacyManifest, null, 2)}\n`,
);
console.log("Generated legacy installer compatibility files in docs/builds/message-purger");
