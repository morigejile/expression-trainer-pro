'use strict';

// Rasterize the existing brand master with Chromium; no logo geometry is redrawn.
const fs = require('node:fs');
const path = require('node:path');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const assets = path.resolve(__dirname, '../src/assets');

function encodeIcon(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  const images = frames.map(({size, rgba, png}, index) => {
    let image;
    if (size === 256) image = png;
    else {
      const maskStride = Math.ceil(size / 32) * 4;
      image = Buffer.alloc(40 + size * size * 4 + maskStride * size);
      image.writeUInt32LE(40); image.writeInt32LE(size, 4); image.writeInt32LE(size * 2, 8);
      image.writeUInt16LE(1, 12); image.writeUInt16LE(32, 14);
      image.writeUInt32LE(size * size * 4, 20);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const from = (y * size + x) * 4, row = size - y - 1, to = 40 + (row * size + x) * 4;
        image[to] = rgba[from + 2]; image[to + 1] = rgba[from + 1];
        image[to + 2] = rgba[from]; image[to + 3] = rgba[from + 3];
        if (!rgba[from + 3]) image[40 + size * size * 4 + row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
    return image;
  });
  return Buffer.concat([header, ...images]);
}

async function generate() {
  const {app, BrowserWindow} = require('electron');
  const dataDir = process.argv.find(arg => arg.startsWith('--data-dir='))?.slice(11);
  if (!dataDir || !path.isAbsolute(dataDir)) throw Error('Supply --data-dir=<absolute isolated directory>');
  fs.mkdirSync(dataDir, {recursive:true}); app.setPath('userData', dataDir);
  const master = fs.readFileSync(path.join(assets, 'brand-mark.svg'), 'utf8');
  const glyph = master.match(/<path\b[^>]*\/>/)[0].replace('stroke="#365b48"', 'stroke="#6B6150"');
  const svg = `<!-- Generated from brand-mark.svg by scripts/generate-app-icon.js -->\n<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 28 28"><title>表达训练</title><rect width="28" height="28" rx="5" fill="#FAF8F2"/>${glyph}</svg>\n`;
  await app.whenReady();
  const win = new BrowserWindow({show:false, webPreferences:{contextIsolation:true, nodeIntegration:false, backgroundThrottling:false}});
  await win.loadURL('data:text/html,<html><body></body></html>');
  const frames = await win.webContents.executeJavaScript(`(async()=>{
    const source=${JSON.stringify(svg)}, image=new Image();
    image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source);await image.decode();
    return ${JSON.stringify(sizes)}.map(size=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
      const context=canvas.getContext('2d');context.drawImage(image,0,0,size,size);
      return {size,rgba:Array.from(context.getImageData(0,0,size,size).data),png:canvas.toDataURL('image/png').split(',')[1]};});
  })()`);
  const buffers = frames.map(frame => ({size:frame.size, rgba:Buffer.from(frame.rgba), png:Buffer.from(frame.png, 'base64')}));
  fs.writeFileSync(path.join(assets, 'app-icon.svg'), svg);
  fs.writeFileSync(path.join(assets, 'app-icon.png'), buffers.at(-1).png);
  fs.writeFileSync(path.join(assets, 'app-icon.ico'), encodeIcon(buffers));
  console.log(`APP_ICON_OK ${sizes.join('/')}`); app.quit();
}

if (process.versions.electron || require.main === module) {
  if (process.versions.electron) generate().catch(error => {console.error(error);require('electron').app.exit(1);});
  else {
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {env, windowsHide:true, stdio:'inherit'});
    process.exitCode = result.status ?? 1;
  }
}
module.exports = {encodeIcon};
