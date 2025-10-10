import fs from 'node:fs/promises';
import path from 'node:path';

(async () => {
  try {
    console.log('Seed: start (gradient)');
    const sharp = (await import('sharp')).default; // lazy import to avoid CJS/ESM issues
    const out = path.join('storage/originals', 'seed.png');
    await fs.mkdir(path.dirname(out), { recursive: true });

    const width = 1024, height = 1024;
    const buf = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        buf[i + 0] = x % 256;          // R: horizontal gradient
        buf[i + 1] = y % 256;          // G: vertical gradient
        buf[i + 2] = (x ^ y) % 256;    // B: XOR pattern
      }
    }

    await sharp(buf, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(out);

    console.log('Seed: written gradient to', out);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
})();