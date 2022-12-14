import * as fs from "fs"
import { tmpdir } from "os"
import path from "path/posix"

import Mercury from "@postlight/mercury-parser"
import canvas from "canvas"
import * as nodepub from "nodepub"
import sanitizeHtml from "sanitize-html"
import { decode } from "html-entities"
import * as cheerio from "cheerio"
import fetch from "node-fetch"

async function parsePage(url: URL) {
	// Parse page using Mercury
	let page = await Mercury.parse(url.toString())

	// Sanitize HTML. Removes forbidden tags and cleans up some bad syntax like improperly closed tags.
	let content = sanitizeHtml(page.content as string, {
		// disallowedTagsMode: "escape", // show removed tags
		// Epub allow list, except "script"
		allowedTags: [
			"a",
			"abbr",
			"acronym",
			"address",
			"applet",
			"b",
			"bdo",
			"big",
			"blockquote",
			"br",
			"cite",
			"code",
			"del",
			"dfn",
			"div",
			"dl",
			"em",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"hr",
			"i",
			"iframe",
			"img",
			"ins",
			"kbd",
			"map",
			"noscript",
			"ns:svg",
			"object",
			"ol",
			"p",
			"pre",
			"q",
			"samp",
			/*"script",*/ "small",
			"span",
			"strong",
			"sub",
			"sup",
			"table",
			"tt",
			"ul",
			"var",
		],
	})

	// Decode HTML entities
	let description = decode(page.excerpt)

	return { content, description, page }
}

async function makeEpubSection({ url, title }: { url: URL; title?: string }, tmpDir: string) {
	await fs.promises.mkdir(tmpDir, { recursive: true })

	console.info("Parsing web page " + url.toString())

	let { content, description, page } = await parsePage(url)

	// List of image paths
	let images = Array<string>()

	console.info("Getting images")
	;[content, images] = await fetchAndReplaceImages(content, tmpDir)
	console.info("Got all images")

	let sectionTitle = title || page.title || url.toString()

	return { title: sectionTitle, description, content, page, images, url }
}

export async function makeEpub(articles: { url: URL; title?: string }[], customBookTitle?: string) {
	let id = Math.random().toString().substr(2, 8)

	let tmpDir = tmpdir() + `/epub/${id}/`
	// console.log("tmpDir:", tmpDir); // Not /tmp, quite cryptic and random on macOS
	await fs.promises.mkdir(tmpDir, { recursive: true })

	let sections = await Promise.all(articles.map((article) => makeEpubSection(article, tmpDir)))
	let firstSection = sections[0]
	let bookTitle = customBookTitle || firstSection.page.title || firstSection.page.url

	console.info("Generating cover image")
	await createCoverImage(tmpDir + "cover.png", bookTitle)
	console.info("Wrote cover image")

	let images = sections.flatMap((section) => section.images)

	// Metadata for the epub file
	let meta = {
		// Required
		id: id,
		cover: tmpDir + "cover.png",
		title: bookTitle,
		author: firstSection.page.author || firstSection.page.domain,

		// Optional
		description: firstSection.description,
		showContents: false, // There is only one section
		source: firstSection.page.url.toString(),
		images: images, // List of image file paths that will be included

		published: firstSection.page.date_published || "", // Not required, but validator complains if unset
		// language: 'en', // Not required, but validator complains if unset

		series: firstSection.page.domain,
		publisher: firstSection.page.domain,
	}
	console.info("Creating E-Book")

	let book = nodepub.document(meta)
	sections.forEach((section) => book.addSection(section.title, section.content, false))

	// Turn into (somewhat) friendly file name
	let pageName = firstSection.url.pathname.toString() + firstSection.url.searchParams.toString()
	let fileName = pageName
		.replace(/[^a-z0-9\.]/gi, "_") // turn non-letters into underscores
		.toLowerCase()
		.replace(/^_+|_+$/g, "") // strip underscores from beginning and end

	console.info("Writing E-Book to " + fileName)
	await book.writeEPUB("./", fileName)

	console.info(`Writing file to ${tmpDir}/${fileName}.epub`)
	await book.writeEPUB(tmpDir, fileName)

	let filePath = tmpDir + fileName + ".epub"
	return filePath
}

async function createCoverImage(path: string, title: string) {
	return new Promise<void>((resolve) => {
		const coverImage = canvas.createCanvas(600, 800)
		const ctx = coverImage.getContext("2d")

		let drawTitle = (title: string, fontSize: number) => {
			// Clear
			ctx.fillStyle = "white"
			ctx.fillRect(0, 0, coverImage.width, coverImage.height)
			ctx.fillStyle = "black"

			ctx.font = fontSize + "px sans-serif"

			let sideMargin = 50
			let topMargin = 200
			let bottomMargin = 100

			let x = sideMargin
			let y = topMargin // Starting height

			let lastLine = ""
			let newLine = ""

			for (let word of title.split(" ")) {
				while (ctx.measureText(word).width + sideMargin * 2 > coverImage.width) {
					// Single word is too wide, we have to go smaller
					drawTitle(title, fontSize - 20)
					return
				}

				newLine = lastLine + word + " "

				if (ctx.measureText(newLine).width + x * 2 < coverImage.width) {
					lastLine = newLine
				} else {
					// break line and write last one
					ctx.fillText(lastLine, x, y)

					// Continue on next line
					y += fontSize

					// Clear next line (except last word)
					lastLine = word + " "
				}
			}
			// Write last line
			ctx.fillText(lastLine, x, y)

			// Did we exceed the canvas' height?
			if (y + bottomMargin > coverImage.height) {
				// Let's try again
				drawTitle(title, fontSize - 20)
			}
		}

		drawTitle(title, 160)

		// Save image
		coverImage.createPNGStream()

		const out = fs.createWriteStream(path)
		const stream = coverImage.createPNGStream()
		out.on("finish", () => resolve())

		stream.pipe(out)
	})
}

/** Download images from the web, place them in the temp folder and replace references in the HTML. returns the new content and the list of images */
async function fetchAndReplaceImages(oldContent: string, tmpPath: string): Promise<[string, Array<string>]> {
	return new Promise<[string, Array<string>]>(async (resolve, reject) => {
		const html = cheerio.load(oldContent, { xml: true })
		const root = html.root()

		let imgElements = Array<cheerio.Element>()
		html("img").map((_, img) => imgElements.push(img))

		// Create list for files to be downloaded
		// Original URL, new path, image element
		let downloadList = Array<[string, string, cheerio.Element]>()
		imgElements.forEach((img) => {
			let originalUrl = img.attribs["src"]

			// iBooks wants any image file extension to render.
			// Doesn't *have to* match the actual file type, but a mismatch causes a warning.
			let ext = path.parse(originalUrl).ext || "png"
			let newName = Math.random().toString().substr(2, 8) + "." + ext

			downloadList.push([originalUrl, newName, img])
		})

		let fetchPromises = Array<Promise<void>>()
		downloadList.forEach(([originalUrl, newName, element]) => {
			fetchPromises.push(
				new Promise(async (resolve, reject) => {
					// Get file
					let response = await fetch(originalUrl)

					// Write file
					await fs.promises.writeFile(tmpPath + newName, response.body || "failed")

					// Replace reference ("../images/" is a hard coded path nodepub copies files to)
					element.attribs["src"] = "../images/" + newName

					// If there's no alt tag, add an empty one (avoids warning)
					if (!element.attribs["alt"]) {
						element.attribs["alt"] = ""
					}

					// Resolve promise
					if (response.body) {
						resolve()
					} else {
						reject(new Error("Request failed"))
					}
				})
			)
		})

		let images = Array<string>()
		downloadList.forEach(([originalUrl, newName, element]) => {
			images.push(tmpPath + newName)
		})

		// Download all images
		await Promise.all(fetchPromises)

		// Write modified content
		let newContent = root.html()
		if (newContent) {
			resolve([newContent, images])
		} else {
			reject(new Error("Re-rendering failed :("))
		}
	})
}
