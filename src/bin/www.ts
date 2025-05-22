#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localAppPath = path.join(__dirname, '../lib/app.js');
const coreAppPath = 'endurance-core/dist/lib/app.js';

fs.existsSync(localAppPath) ? await import(localAppPath) : await import(coreAppPath);