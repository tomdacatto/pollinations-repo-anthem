#!/usr/bin/env node
// Checks an anthem folder and writes its page. No dependencies; node pack.mjs <anthem-folder>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const norm = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Reads the brief: title, fields and the quotes with the file each came from. */
export function parseBrief(markdown) {
    const lines = markdown.split(/\r?\n/);
    const title =
        lines
            .find((l) => l.startsWith("# "))
            ?.slice(2)
            .trim() ?? "";
    const field = (name) =>
        lines
            .find((l) => l.toLowerCase().startsWith(`${name}:`))
            ?.slice(name.length + 1)
            .trim() ?? "";
    const quotes = lines
        .map((l) => l.match(/^>\s*"(.+)"\s*\((.+)\)\s*$/))
        .filter(Boolean)
        .map((m) => ({ text: m[1], file: m[2].trim() }));
    return {
        title,
        mood: field("mood"),
        tempo: field("tempo"),
        instruments: field("instruments"),
        cover: field("cover"),
        quotes,
    };
}

/** What is wrong with the brief, as sentences; an empty list means it is fine. */
export function checkBrief(brief, root) {
    const problems = [];
    for (const key of ["title", "mood", "cover"]) if (!brief[key]) problems.push(`The brief has no ${key}.`);
    if (brief.quotes.length < 2 || brief.quotes.length > 4) problems.push("The brief needs 2 to 4 quotes.");
    const base = path.resolve(root);
    for (const q of brief.quotes) {
        const file = path.resolve(base, q.file);
        if (!file.startsWith(base + path.sep)) problems.push(`"${q.file}" is outside the repository.`);
        else if (!fs.existsSync(file)) problems.push(`The file ${q.file} does not exist.`);
        else if (!norm(fs.readFileSync(file, "utf8")).includes(norm(q.text)))
            problems.push(`The words "${q.text}" are not in ${q.file}.`);
    }
    return problems;
}

// Layer III bitrates in kbit/s by frame-header index: MPEG-1 (44.1 and 48 kHz) and MPEG-2 or 2.5 (22 and 24 kHz).
const BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/** Length of a constant-bitrate mp3 in seconds, from its first frame; null if it is not an mp3. */
export function mp3Seconds(buffer) {
    let at = 0;
    if (buffer.subarray(0, 3).toString() === "ID3")
        at = 10 + ((buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9]);
    for (let i = at; i < Math.min(buffer.length - 4, at + 4096); i++) {
        if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe6) !== 0xe2) continue; // frame sync and layer III
        const version = (buffer[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5, 1 = reserved
        const kbps = version === 1 ? 0 : BITRATES[version === 3 ? 1 : 2][buffer[i + 2] >> 4];
        if (!kbps) continue;
        return ((buffer.length - i) * 8) / (kbps * 1000);
    }
    return null;
}

/** Kind and size of a png or jpeg picture, or null. Image models return either, whatever the file name says. */
export function imageInfo(buffer) {
    const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(magic))
        return { kind: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    for (let i = 2; i + 9 < buffer.length; ) {
        if (buffer[i] !== 0xff) return null;
        const marker = buffer[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
            return { kind: "jpg", height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
        i += 2 + buffer.readUInt16BE(i + 2);
    }
    return null;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** One self-contained page for the folder. */
export function page(brief, seconds, cover = "cover.png") {
    const quotes = brief.quotes.map((q) => `<li><q>${esc(q.text)}</q> <code>${esc(q.file)}</code></li>`).join("");
    return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(brief.title)}</title>
<style>body{font:16px/1.5 system-ui;max-width:34rem;margin:2rem auto;padding:0 1rem}img{width:100%;border-radius:12px}audio{width:100%}code{color:#666}</style>
<h1>${esc(brief.title)}</h1>
<img src="${cover}" alt="${esc(brief.cover)}">
<audio controls src="anthem.mp3"></audio>
<p>${[brief.mood, brief.tempo, brief.instruments].filter(Boolean).map(esc).join(", ")}. About ${Math.round(seconds)} seconds.</p>
<h2>Why it sounds like this</h2>
<ul>${quotes}</ul>
`;
}

/** Checks the folder and, when it passes, writes index.html next to the files. */
export function pack(folder, root = path.dirname(path.resolve(folder))) {
    const read = (name) => {
        const file = path.join(folder, name);
        return fs.existsSync(file) ? fs.readFileSync(file) : null;
    };
    const brief = read("brief.md");
    if (!brief) return { problems: ["anthem/brief.md is missing."] };
    const parsed = parseBrief(brief.toString("utf8"));
    const problems = checkBrief(parsed, root);
    const mp3 = read("anthem.mp3");
    const seconds = mp3 && mp3Seconds(mp3);
    if (!mp3) problems.push("anthem.mp3 is missing.");
    else if (seconds === null) problems.push("anthem.mp3 is not an mp3 file.");
    else if (seconds < 10 || seconds > 60)
        problems.push(`The song is about ${Math.round(seconds)} seconds; it must be 10 to 60.`);
    const picture = read("cover.png") ?? read("cover.jpg"); // a checked folder has the real extension
    const size = picture && imageInfo(picture);
    if (!picture) problems.push("cover.png is missing.");
    else if (!size) problems.push("cover.png is not a png or jpeg picture.");
    if (problems.length) return { problems };
    const cover = `cover.${size.kind}`;
    if (cover !== "cover.png" && read("cover.png"))
        fs.renameSync(path.join(folder, "cover.png"), path.join(folder, cover)); // the name follows the real format
    fs.writeFileSync(path.join(folder, "index.html"), page(parsed, seconds, cover));
    return { problems: [], title: parsed.title, seconds, size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const folder = process.argv[2];
    if (!folder) {
        console.error("Usage: node pack.mjs <anthem-folder>");
        process.exit(2);
    }
    const result = pack(folder);
    if (result.problems.length) {
        for (const p of result.problems) console.error(`- ${p}`);
        process.exit(1);
    }
    console.log(
        `ok: "${result.title}", about ${Math.round(result.seconds)} s, cover ${result.size.width}x${result.size.height}, page ${path.join(folder, "index.html")}`,
    );
}
