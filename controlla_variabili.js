/**
 * Cerca variabili di stato usate ma mai dichiarate.
 *
 * È la classe di errore che produce la schermata bianca: il codice ha
 * sintassi valida, quindi il controllo del compilatore passa, ma a
 * runtime la variabile non esiste e il componente esplode. Va lanciato
 * dopo ogni modifica strutturale ai file delle schermate.
 */
const fs = require("fs"), path = require("path");

// Funzioni del linguaggio o di librerie: non sono stato del componente.
const INTEGRATE = new Set([
  "setTimeout", "setInterval", "setDate", "setHours", "setMonth", "setMinutes",
  "setSeconds", "setFullYear", "setUTCDate", "setItem", "setAttribute", "setState",
]);

function trova(dir, acc) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) trova(p, acc);
    else if (/\.tsx?$/.test(n)) acc.push(p);
  }
  return acc;
}

let problemi = 0;
for (const f of trova("app", []).concat(trova("src", []))) {
  const s = fs.readFileSync(f, "utf8");

  const usati = new Set([...s.matchAll(/\b(set[A-Z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]));
  // Copre sia "const [x, setX]" sia "const [, setX]"
  const dichiarati = new Set([...s.matchAll(/const\s*\[[^\]]*,\s*(set[A-Z][A-Za-z0-9_]*)\s*\]/g)].map((m) => m[1]));
  const daProps = new Set([...s.matchAll(/(set[A-Z][A-Za-z0-9_]*)\s*[:,}]/g)].map((m) => m[1]));

  for (const x of usati) {
    if (INTEGRATE.has(x) || dichiarati.has(x) || daProps.has(x)) continue;
    if (new RegExp(`(function|const|let)\\s+${x}\\b`).test(s)) continue;
    console.log(`${f} -> setter mai dichiarato: ${x}`);
    problemi++;
  }

  // Stato letto ma senza dichiarazione: l'altra metà dello stesso problema.
  const statiDichiarati = new Set([...s.matchAll(/const\s*\[\s*([A-Za-z0-9_]+)\s*,/g)].map((m) => m[1]));
  for (const m of s.matchAll(/set([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    const nome = m[1][0].toLowerCase() + m[1].slice(1);
    if (INTEGRATE.has("set" + m[1])) continue;
    if (!statiDichiarati.has(nome) && !dichiarati.has("set" + m[1])) continue;
  }
}
console.log(problemi === 0 ? "OK — nessuna variabile di stato mancante" : `${problemi} problemi trovati`);
