// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const { FileStore } = require("metro-cache");

const config = getDefaultConfig(__dirname);

// Cache stabile su disco (stessa scelta di BandFit): riduce i tempi di
// rebuild di Metro tra web e nativo condividendo lo stesso store.
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, ".metro-cache");
config.cacheStores = [new FileStore({ root: path.join(root, "cache") })];

config.maxWorkers = 2;

module.exports = config;
