// Vercel serverless entrypoint: export the Express app (no app.listen).
const mod = require("../dist/index.js");
module.exports = mod.default || mod;
