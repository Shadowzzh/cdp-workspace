import fs from "node:fs";
import path from "node:path";

export function atomicWriteFile(filePath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}`,
  );

  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", mode });
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

export function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
