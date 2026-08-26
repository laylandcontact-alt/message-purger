import { build } from "esbuild";
import { transformFile } from "@swc/core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

mkdirSync("docs", { recursive: true });

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

await build({
	entryPoints: [manifest.main],
	bundle: true,
	outfile: "docs/index.js",
	format: "iife",
	globalName: "$",
	banner: { js: "(()=>{" },
	footer: { js: "return $;})();" },
	minifySyntax: true,
	minifyWhitespace: true,
	plugins: [
		{
			name: "vendetta",
			setup(b) {
				b.onResolve({ filter: /^@vendetta\/?/ }, ({ path }) => ({
					path,
					namespace: "vendetta",
				}));
				b.onLoad({ filter: /.*/, namespace: "vendetta" }, ({ path }) => ({
					contents: `module.exports = ${path.slice(1).replace(/\//g, ".")}`,
					loader: "js",
				}));
			},
		},
		{
			name: "swc",
			setup(b) {
				b.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
					const result = await transformFile(args.path, {
						jsc: { externalHelpers: false },
						env: {
							targets: "fully supports es6",
							include: [
								"transform-block-scoping",
								"transform-classes",
								"transform-async-to-generator",
								"transform-async-generator-functions",
								"transform-named-capturing-groups-regex",
							],
							exclude: [
								"transform-parameters",
								"transform-template-literals",
								"transform-exponentiation-operator",
								"transform-nullish-coalescing-operator",
								"transform-object-rest-spread",
								"transform-optional-chaining",
								"transform-logical-assignment-operators",
							],
						},
					});
					return { contents: result.code, loader: "js" };
				});
			},
		},
	],
});

const hash = createHash("sha256")
.update(readFileSync("docs/index.js", "utf8"))
.digest("hex");

writeFileSync(
"docs/manifest.json",
JSON.stringify({ ...manifest, main: "index.js", hash }),
);

console.log("Build complete: docs/index.js + docs/manifest.json");
