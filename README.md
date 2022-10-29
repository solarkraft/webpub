# webpub

Takes one or multiple URLs (as GET form data) and makes epub files for them, de-cluttered using [Mercury Parser](https://github.com/postlight/parser) and embedding pictures. 

Offers a form to input URLs. 

## Running

Spin it up using `pnpm install && pnpm run start` and visit http://localhost:3000/. 

## Readiness

There are bugs left. Some web pages can't be parsed by Mercury Parser, for some the image fetching fails (the latter is likely more common). 
