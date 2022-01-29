let nodepub = require('nodepub');
import Mercury from '@postlight/mercury-parser';
import sanitizeHtml from 'sanitize-html';
import { decode } from 'html-entities';
import * as fs from 'fs'
import * as canvas from 'canvas'

const args: string[] = process.argv;

async function main(args: string[]) {
    let id = Math.random().toString().substr(2, 8);

    let urlString: string;
    urlString = args[2];
    if (!urlString) {
        console.error("Give me a URL, please");
        process.exit();
    }

    let url = new URL(urlString);

    console.info("Parsing web page "+url.toString());

    let page = await Mercury.parse(url.toString());

    // Sanitize HTML. Removes forbidden tags and cleans up some bad syntax like improperly closed tags.
    let content = sanitizeHtml(page.content as string, {
        // disallowedTagsMode: "escape", // show removed tags
        // Epub allow list, except "script"
        allowedTags: ["a", "abbr", "acronym", "address", "applet", "b", "bdo", "big", "blockquote", "br", "cite", "code", "del", "dfn", "div", "dl", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe", "img", "ins", "kbd", "map", "noscript", "ns:svg", "object", "ol", "p", "pre", "q", "samp", /*"script",*/ "small", "span", "strong", "sub", "sup", "table", "tt", "ul", "var"],
    });

    // Decode HTML entities
    let description = decode(page.excerpt);

    // Generate cover image
    console.info("Generating cover image");
    await createCoverImage(`/tmp/cover_${id}.png`, page.title || page.url);
    console.info("Wrote cover image");

    // Metadata for the epub file
    let meta = {
        // Required
        id: id,
        cover: `/tmp/cover_${id}.png`,
        title: page.title,
        author: page.author || "unknown author",

        // Optional
        description: description,
        showContents: false,
        source: url.toString(),

        // published: '2000-12-31', // Not required, but validator complains if unset
        // language: 'en', // Not required, but validator complains if unset

        // series: 'My Series',
        // publisher: 'My Fake Publisher',
        
        // contents: 'Table of Contents',
        // images: ['../test/hat.png']
      };
    
    let book = nodepub.document(meta);

    console.info("Creating E-Book");
    console.info("Meta: ", meta);

    console.debug("Content: ", content);

    book.addSection(page.title, content, false, false);
    
    // Turn into (somewhat) friendly file name
    let pageName = url.pathname.toString() + url.searchParams.toString();
    let fileName = pageName
        .replace(/[^a-z0-9\.]/gi, '_') // turn non-letters into underscores
        .toLowerCase()
        .replace(/^_+|_+$/g, ''); // strip underscores from beginning and end

    console.info("Writing E-Book to " + fileName);
    await book.writeEPUB('./', fileName);

    console.info("Done :-)");
}

async function createCoverImage(path: string, title: string) {
    return new Promise<void>(resolve => {
        const coverImage = canvas.createCanvas(600, 800);
        const ctx = coverImage.getContext('2d');

        let drawTitle = (title: string, fontSize: number) => {
            // Clear
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, coverImage.width, coverImage.height);
            ctx.fillStyle = 'black';

            ctx.font = fontSize + 'px sans-serif'

            let sideMargin = 50;
            let topMargin = 200;
            let bottomMargin = 100;

            let x = sideMargin;
            let y = topMargin; // Starting height

            let lastLine = '';
            let newLine = '';

            title.split(' ').forEach(async (word, i) => {
                newLine = lastLine + word + " ";

                if (ctx.measureText(newLine).width + x*2 < coverImage.width) {
                    lastLine = newLine;
                } else {
                    // break line and write last one
                    ctx.fillText(lastLine, x, y);

                    // Continue on next line
                    y += fontSize;
                    
                    // Clear next line (except last word)
                    lastLine = word + " ";
                }
            });
            // Write last line
            ctx.fillText(lastLine, x, y);

            // Did we exceed the canvas' height?
            if(y+bottomMargin > coverImage.height) {

                // Let's try again
                drawTitle(title, fontSize-20);
            }
        }

        drawTitle(title, 160)

        // Save image
        coverImage.createPNGStream();

        const out = fs.createWriteStream(path)
        const stream = coverImage.createPNGStream();
        out.on('finish', () =>  resolve())

        stream.pipe(out)
    });
}

main(args);
