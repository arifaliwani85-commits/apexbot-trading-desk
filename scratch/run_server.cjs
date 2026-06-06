const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '../server_output.log');
// Truncate previous log
fs.writeFileSync(logPath, '');

console.log("Starting server.cjs wrapper...");
const child = spawn('node', [path.join(__dirname, '../server.cjs')], {
  cwd: path.join(__dirname, '..'),
  env: process.env
});

child.stdout.on('data', (data) => {
  const str = data.toString();
  process.stdout.write(str);
  fs.appendFileSync(logPath, str);
});

child.stderr.on('data', (data) => {
  const str = data.toString();
  process.stderr.write(str);
  fs.appendFileSync(logPath, str);
});

child.on('close', (code) => {
  const msg = `\n[WRAPPER] Server process exited with code ${code}\n`;
  console.log(msg);
  fs.appendFileSync(logPath, msg);
});
