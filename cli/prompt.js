// 终端交互小工具：普通提问、隐藏输入（输密钥时不显示）、选择题、确认。
import readline from 'node:readline';

export function ask(question, def) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question}${def ? `（默认 ${def}）` : ''}：`, (a) => {
      rl.close();
      resolve(a.trim() || def || '');
    });
  });
}

export function askSecret(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(`${question}（输入时不显示，粘贴后回车）：`);
    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin });
      rl.once('line', (l) => { rl.close(); process.stdout.write('\n'); resolve(l.trim()); });
      return;
    }
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
          process.stdout.write(` [已输入 ${buf.length} 个字符]\n`);
          resolve(buf.trim());
          return;
        }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

export async function choose(question, options) {
  console.log(`\n${question}`);
  options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
  for (;;) {
    const a = await ask('请输入序号');
    const n = Number(a);
    if (n >= 1 && n <= options.length) return options[n - 1].value;
    console.log('  序号不对，再试一次。');
  }
}

export async function confirm(question, def = false) {
  const a = (await ask(`${question} [${def ? 'Y/n' : 'y/N'}]`)).toLowerCase();
  if (!a) return def;
  return ['y', 'yes', '是', '好', '确认'].includes(a);
}

export const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

export function title(s) {
  console.log(`\n${c.bold('━━ ' + s + ' ━━')}`);
}
