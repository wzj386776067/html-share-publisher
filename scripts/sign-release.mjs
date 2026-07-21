#!/usr/bin/env node
import { createPrivateKey, sign } from 'node:crypto';
import fs from 'node:fs';

const [archivePath, privateKeyPath] = process.argv.slice(2);
if (!archivePath || !privateKeyPath) {
  throw new Error('Usage: sign-release.mjs <archive> <private-key.pem>');
}
const archive = fs.readFileSync(archivePath);
const privateKey = createPrivateKey(fs.readFileSync(privateKeyPath));
fs.writeFileSync(`${archivePath}.sig`, sign(null, archive, privateKey));
