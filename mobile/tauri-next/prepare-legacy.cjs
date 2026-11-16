"use strict";
// Keep a byte-for-byte visual baseline; do not modify the Capacitor source.
const fs = require("node:fs");
const path = require("node:path");
const source = path.resolve(__dirname, "../www");
const destination = path.resolve(__dirname, "public/legacy");
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true, force: true });
