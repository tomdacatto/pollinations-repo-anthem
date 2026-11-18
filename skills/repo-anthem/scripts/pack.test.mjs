import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkBrief, imageInfo, mp3Seconds, pack, page, parseBrief } from "./pack.mjs";

const BRIEF = `# Night Build
mood: calm, focused
tempo: 92 bpm
instruments: soft piano, sub bass
cover: a lit window in a dark office tower
> "Pay with your own Pollen" (README.md)
> "fix the   typo" (notes/log.txt)
`;

// 128 kbit/s MPEG-1 layer 3 frame header, then silence: 16000 bytes per second.
const mp3 = (seconds) => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(seconds * 16000 - 4)]);
// The same, as MPEG-2 layer III at 160 kbit/s (what the speech models return): 20000 bytes per second.
const mp3v2 = (seconds) => Buffer.concat([Buffer.from([0xff, 0xf3, 0xe4, 0xc0]), Buffer.alloc(seconds * 20000 - 4)]);
const png = (w, h) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
};

function project(extra = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anthem-"));
    fs.mkdirSync(path.join(root, "notes"));
    fs.mkdirSync(path.join(root, "anthem"));
    fs.writeFileSync(path.join(root, "README.md"), "A tiny app.\nPay with your own Pollen, always.\n");
    fs.writeFileSync(path.join(root, "notes", "log.txt"), "fix the typo\n");
    const files = { "brief.md": BRIEF, "anthem.mp3": mp3(30), "cover.png": png(1024, 1024), ...extra };
    for (const [name, data] of Object.entries(files))
        if (data !== null) fs.writeFileSync(path.join(root, "anthem", name), data);
    return root;
}

test("the brief is read: title, fields and quotes with their files", () => {
    const brief = parseBrief(BRIEF);
    assert.equal(brief.title, "Night Build");
    assert.equal(brief.tempo, "92 bpm");
    assert.deepEqual(brief.quotes, [
        { text: "Pay with your own Pollen", file: "README.md" },
        { text: "fix the   typo", file: "notes/log.txt" },
    ]);
});

test("a quote must be in the file it names, ignoring case and spacing", () => {
    const root = project();
    assert.deepEqual(checkBrief(parseBrief(BRIEF), root), []);
    const wrong = parseBrief(BRIEF.replace("Pay with your own Pollen", "Pay with your own Honey"));
    assert.match(checkBrief(wrong, root)[0], /not in README\.md/);
    const away = parseBrief(BRIEF.replace("README.md", "../secret.txt"));
    assert.match(checkBrief(away, root)[0], /outside the repository/);
    assert.match(checkBrief(parseBrief("# T\n"), root).join(" "), /no mood/);
});

test("mp3 length comes from the first frame and the size, and other files are refused", () => {
    assert.equal(Math.round(mp3Seconds(mp3(30))), 30);
    const withTag = Buffer.concat([Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0004abcd"), mp3(20)]);
    assert.equal(Math.round(mp3Seconds(withTag)), 20);
    assert.equal(Math.round(mp3Seconds(mp3v2(15))), 15);
    assert.equal(mp3Seconds(Buffer.from("<html>not audio</html>")), null);
});

const jpg = (w, h) => {
    const sof = Buffer.alloc(19);
    sof.writeUInt16BE(17, 0); // segment length
    sof.writeUInt16BE(h, 3);
    sof.writeUInt16BE(w, 5);
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0]), sof]);
};

test("picture kind and size are read from the header, png or jpeg", () => {
    assert.deepEqual(imageInfo(png(1024, 768)), { kind: "png", width: 1024, height: 768 });
    assert.deepEqual(imageInfo(jpg(1024, 512)), { kind: "jpg", width: 1024, height: 512 });
    assert.equal(imageInfo(Buffer.from("GIF89a...........................")), null);
});

test("a jpeg saved as cover.png is renamed to its real format and the page follows", () => {
    const root = project({ "cover.png": jpg(1024, 1024) });
    const result = pack(path.join(root, "anthem"));
    assert.deepEqual(result.problems, []);
    assert.equal(fs.existsSync(path.join(root, "anthem", "cover.jpg")), true);
    assert.deepEqual(pack(path.join(root, "anthem")).problems, []); // running it again is fine
    assert.match(fs.readFileSync(path.join(root, "anthem", "index.html"), "utf8"), /src="cover\.jpg"/);
});

test("a good folder passes and gets a page with the quotes", () => {
    const root = project();
    const result = pack(path.join(root, "anthem"));
    assert.deepEqual(result.problems, []);
    assert.equal(Math.round(result.seconds), 30);
    const html = fs.readFileSync(path.join(root, "anthem", "index.html"), "utf8");
    assert.match(html, /<audio controls src="anthem.mp3">/);
    assert.match(html, /Pay with your own Pollen/);
});

test("a bad folder says what is wrong and writes no page", () => {
    const root = project({ "anthem.mp3": mp3(3), "cover.png": Buffer.from("not a png at all............") });
    const { problems } = pack(path.join(root, "anthem"));
    assert.match(problems.join(" "), /about 3 seconds/);
    assert.match(problems.join(" "), /not a png or jpeg/);
    assert.equal(fs.existsSync(path.join(root, "anthem", "index.html")), false);
    assert.match(pack(path.join(root, "nothing")).problems[0], /brief\.md is missing/);
});

test("the page escapes the words it shows", () => {
    const html = page({ ...parseBrief(BRIEF), title: "<b>x</b>" }, 30);
    assert.ok(!html.includes("<b>x</b>"));
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});
