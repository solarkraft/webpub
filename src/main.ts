import * as fs from "fs";

import Koa, { Context } from "koa";
import koaBody from "koa-body";

import { makeEpub } from "./epub.js"; // https://github.com/TypeStrong/ts-node/issues/1777

// Token, destination directory
let directories = new Map<string, string>([
	["a", "/tmp/"],
	["b", "/data/reading/Web"],
]);

const app = new Koa();
app.use(koaBody({ includeUnparsed: true }));

app.use(async (ctx: Context) => {
	const path = ctx.path;
	console.log(ctx.method, path);

	// We're DIYing the router because the built-in one makes it hard to get content behind a /
	if (path.startsWith("/epub")) {
		let url: URL;
		try {
			let urlString = path.replace("/epub/", "");

			// Nothing provided and GET
			if (!urlString) {
				return;
			}

			url = new URL(urlString); // Error kinda expeced

			if (url.protocol != "https:" && url.protocol != "http:") {
				throw new Error(
					"Sorry friend, this protocol isn't supported: " +
						url.protocol
				);
			}
		} catch (error) {
			console.error(error);
			ctx.status = 400;
			ctx.body = error;
			return;
		}

		let epubPath = await makeEpub(url);
		let epubName = epubPath.split("/").pop();

		let epub = await fs.promises.readFile(epubPath);

		ctx.set("content-type", "application/epub+zip");
		ctx.set("content-disposition", `attachment; filename="${epubName}"`);

		ctx.body = epub;
	} else if (path.startsWith("/save")) {
		let token: string;

		try {
			// /save/<token>/<url to save>
			token = path.replace(/\/save\//, "").split("/")[0]; // Error kinda expeced

			ctx.body = token;

			let directory = directories.get(token);
			if (!directory) {
				throw new Error("Invalid token " + token);
			}

			// Authenticated
			console.info(
				"Authenticated.",
				"Token:",
				token,
				"Directory:",
				directory
			);

			// Get URL // Remove token
			let urlString = path
				.replace(/\/save\//, "")
				.replace(token + "/", "");

			// Welcome page if no URL given
			if (!urlString) {
				ctx.body = `Welcome. Append this URL with an article's to save it to your associated directory ${directory}`;
			}

			let url = new URL(urlString);

			// Make and save epub
			let epubPath = await makeEpub(url);
			let epubName = epubPath.split("/").pop();

			let newPath = directory + "/" + epubName;

			console.info("Copying" + epubPath + " to " + newPath);
			await fs.promises.copyFile(epubPath, newPath);

			// Success message
			ctx.body = `Saved article ${urlString} to ${newPath}`;
		} catch (error) {
			console.error(error);
			ctx.status = 400;
			ctx.body = error;
			return;
		}
	}
});

app.listen(3000);