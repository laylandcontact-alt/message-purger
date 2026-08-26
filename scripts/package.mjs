import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;
const distDir = `${root}/build/dist`;
const pluginDir = `${root}/plugins/message-purger`;
const zipPath = `${distDir}/message-purger.zip`;

await mkdir(distDir, { recursive: true });
await rm(zipPath, { force: true });
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
console.log(`Packaged ${zipPath}`);
console.log(`SHA-256: ${createHash("sha256").update(zip).digest("hex")}`);
