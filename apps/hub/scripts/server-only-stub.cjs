/*
 * Lets the Hubpedia hub-topic scripts import lib/server modules outside Next.
 * "server-only" is a build-time marker with no runtime content, and the package
 * is not installed for plain Node. This maps it to an empty module for the
 * script process only; the Worker and Next builds still use the real marker.
 */
const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (request === "server-only") return require.resolve("./server-only-stub.cjs");
  return original.call(this, request, ...rest);
};
