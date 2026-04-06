const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "polls.json");

function ensureDataFile() {
  const dir = path.dirname(FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, "[]", "utf8");
  }
}

function load() {
  ensureDataFile();

  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (err) {
    console.error("Fehler beim Laden der polls.json:", err);
    return [];
  }
}

function save(data) {
  ensureDataFile();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

module.exports = {
  load,
  save,
  FILE
};