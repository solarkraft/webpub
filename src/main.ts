let nodepub = require('nodepub');
import Mercury from '@postlight/mercury-parser';
import sanitizeHtml from 'sanitize-html';
import { decode } from 'html-entities';

const args: string[] = process.argv;

async function main(args: string[]) {
    let urlString: string;
    
    urlString = args[2];
    if (!urlString) {
        console.error("Give me a URL, please");
        process.exit();
    }

    let url = new URL(urlString);

    console.info("Parsing web page "+url.toString());

    let page = await Mercury.parse(url.toString())

    // Sanitize HTML. Removes forbidden tags and cleans up some bad syntax like improperly closed tags.
    let content = sanitizeHtml(page.content as string, {
        // disallowedTagsMode: "escape", // show removed tags
        // Epub allow list, except "script"
        allowedTags: ["a", "abbr", "acronym", "address", "applet", "b", "bdo", "big", "blockquote", "br", "cite", "code", "del", "dfn", "div", "dl", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe", "img", "ins", "kbd", "map", "noscript", "ns:svg", "object", "ol", "p", "pre", "q", "samp", /*"script",*/ "small", "span", "strong", "sub", "sup", "table", "tt", "ul", "var"],
    });

    // Decode HTML entities
    let description = decode(page.excerpt);

    // Metadata for the epub file
    let meta = {
        id: Math.random().toString().substr(2, 8), // Required. Maybe hash url?
        cover: 'test-cover.png', // Required (eh). TODO: Remove requirement or generate
        title: page.title, // Required
        author: page.author || "unknown author", // Required

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

    // Avoids having to add it as an extra section, which would be shown on a different page
    let contentWithExtras = '<h1>'+page.title+'</h1>' + content;

    // book.addSection("Preface", 
    //     '<h1>'+page.title+'</h1>'
    //     +'This epub file was generated from '+url
    // ,false, true);

    book.addSection(page.title, contentWithExtras, false, false);
    
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

main(args);
