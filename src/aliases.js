const fs = require("fs");
const path = require("path");

const ALIASES_FILE = path.join(process.env.WA_AUTH_FOLDER || ".wa_auth", "aliases.json");

let aliases = {};

function load() {
  try {
    if (fs.existsSync(ALIASES_FILE)) {
      aliases = JSON.parse(fs.readFileSync(ALIASES_FILE, "utf8"));
    }
  } catch (e) {
    console.warn("Could not load aliases:", e.message);
  }
}

function save() {
  try {
    const dir = path.dirname(ALIASES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ALIASES_FILE, JSON.stringify(aliases, null, 2));
  } catch (e) {
    console.warn("Could not save aliases:", e.message);
  }
}

function resolve(name) {
  return aliases[name] || name;
}

function set(from, to) {
  aliases[from] = to;
  save();
}

function remove(from) {
  delete aliases[from];
  save();
}

function getAll() {
  return { ...aliases };
}

load();

module.exports = { resolve, set, remove, getAll };
