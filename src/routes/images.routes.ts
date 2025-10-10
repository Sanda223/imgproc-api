import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const r = Router();

r.get('/:id', async (req, res, next) => {
  try {
    const p = path.join('storage/outputs', `${req.params.id}.png`);
    const buf = await fs.readFile(p);
    const etag = '"' + createHash('sha1').update(buf).digest('hex') + '"';
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('png').send(buf);
  } catch (e) { next(e); }
});

export default r;
