import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scanRoots = ["apps", "packages"];
const extensions = new Set([".ts",".tsx",".js",".jsx",".mjs"]);
const forbidden = [
  ["eval(", "dynamic eval"],
  ["new Function(", "dynamic Function"],
  ["dangerouslySetInnerHTML", "raw React HTML"],
  ["innerHTML", "raw DOM HTML"]
];
let failures = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules","dist","coverage"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name))) {
      const text = fs.readFileSync(full, "utf8");
      const relative=path.relative(root,full).split(path.sep).join("/");
      const vettedHtmlFiles=new Set(["apps/web/src/app/components/exam/MathText.tsx"]);
      for (const [needle, label] of forbidden) if (text.includes(needle) && !vettedHtmlFiles.has(relative) && !(relative.endsWith("RichTextEditor.tsx") && needle === "innerHTML")) failures.push(`${relative}: ${label}`);
      if (/https?:\/\/[^"'`\s]+(?:[?&](?:secret|token|api[_-]?key|webhook)=|:[^/@\s]+@)/i.test(text)) failures.push(`${relative}: possible hardcoded secret URL/token`);
    }
  }
}
for (const r of scanRoots) walk(path.join(root,r));
if (failures.length) {
  console.error("Lint/security scan failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Lint/security scan passed: no forbidden dynamic HTML/code or obvious hardcoded secret patterns found.");
