import * as fs from "fs"
import path from "path"

import Koa, { Context } from "koa"
import mount from "koa-mount"
import serve from "koa-static"

import { makeEpub } from "./epub.js" // https://github.com/TypeStrong/ts-node/issues/1777

const app = new Koa()

app.use(async (ctx: Context, next) => {
	try {
		// Ignore favicon requests
		if (ctx.path.includes("favicon")) return
		console.log("Processing", ctx.method, ctx.request.href)

		let query = ctx.request.query

		// If no URL was provided, fall through to static serving
		if (query.url === undefined) {
			console.log("No URL, falling through")
			await next()
			return
		}

		// If a query parameter only comes in once, Koa provides it as a string. But we always want string[] for ease of processing.
		let urls = Array.isArray(query.url) ? query.url : [query.url]
		let titles = Array.isArray(query.title) ? query.title : [query.title]

		// Queries come like { url: [ 'url1', 'url2' ], title: [ 'title1', 'title2' ] }
		// Re-pack them to article objects [{url: "url1", title: "title1"}, {url: "url2", title: "title2"}]
		let articles: { url: URL; title?: string }[] = []
		for (let i = 0; i < urls.length; i++) {
			if (!urls[i]) continue // Missing URLs get skipped
			articles[i] = { url: new URL(urls[i]), title: titles[i] }
		}

		console.log("Articles:", articles)

		let filePath = await makeEpub(articles, query.book_title as string | undefined)

		// Get file
		let file = fs.createReadStream(filePath)

		ctx.response.set("content-type", "application/epub+zip")
		ctx.response.set("content-disposition", `attachment; filename=${path.basename(filePath)}`)
		ctx.body = file
	} catch (err) {
		ctx.response.status = 500
		ctx.body = err
	}
})

app.use(mount("/", serve("./static")))

app.listen(3000)
