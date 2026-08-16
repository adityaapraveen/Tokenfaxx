import fs from "node:fs";
const file = new URL("../dist/index.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");
if (!source.startsWith("#!/usr/bin/env node"))
  fs.writeFileSync(file, `#!/usr/bin/env node\n${source}`, { mode: 0o755 });
fs.chmodSync(file, 0o755);
