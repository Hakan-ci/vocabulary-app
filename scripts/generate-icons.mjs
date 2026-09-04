// Adapt the existing Kelime book mark; no external artwork or runtime dependency.
import sharp from 'sharp'
import {readFile,mkdir} from 'node:fs/promises'
const artwork=await readFile(new URL('../public/favicon.svg',import.meta.url))
const directory=new URL('../public/icons/',import.meta.url)
await mkdir(directory,{recursive:true})
for(const [name,size] of [['pwa-192',192],['pwa-512',512],['apple-touch-icon',180]])await sharp(artwork).resize(size,size).png().toFile(new URL(`${name}.png`,directory).pathname.replace(/^\/(\w:)/,'$1'))
// Maskable foreground lies inside the central safe circle (radius 40% of width).
await sharp({create:{width:512,height:512,channels:4,background:'#2f5944'}}).composite([{input:await sharp(artwork).resize(320,320).png().toBuffer(),gravity:'centre'}]).png().toFile(new URL('maskable-512.png',directory).pathname.replace(/^\/(\w:)/,'$1'))
