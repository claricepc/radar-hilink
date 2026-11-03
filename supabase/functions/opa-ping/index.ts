import postgres from "npm:postgres@3.4.4";
// Teste de acesso à API do OPA (só leitura de etiquetas). Token: segredo opa_token no cofre do Supabase.
// A API do OPA lê o filtro no corpo de um GET; o fetch não permite isso, então a requisição é montada à mão (HTTP/1.1 sobre TLS).
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
async function getComCorpo(url: string, auth: string, corpo: unknown): Promise<{ status: number; texto: string }> {
  const u = new URL(url);
  const dados = new TextEncoder().encode(JSON.stringify(corpo));
  const cab = `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}\r\nAuthorization: ${auth}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: ${dados.length}\r\nConnection: close\r\n\r\n`;
  const con = await Deno.connectTls({ hostname: u.hostname, port: 443 });
  await con.write(new TextEncoder().encode(cab)); await con.write(dados);
  const partes: Uint8Array[] = []; const buf = new Uint8Array(65536);
  while (true) { const n = await con.read(buf); if (n === null) break; partes.push(buf.slice(0, n)); }
  try { con.close(); } catch (_) {}
  const tudo = new Uint8Array(partes.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of partes) { tudo.set(p, o); o += p.length; }
  let fim = 0; for (let i = 0; i < tudo.length - 3; i++) if (tudo[i] === 13 && tudo[i+1] === 10 && tudo[i+2] === 13 && tudo[i+3] === 10) { fim = i; break; }
  const cabResp = new TextDecoder().decode(tudo.slice(0, fim));
  let corpoB = tudo.slice(fim + 4);
  if (/transfer-encoding:\s*chunked/i.test(cabResp)) {
    const out: Uint8Array[] = []; let p = 0;
    while (p < corpoB.length) {
      let e = p; while (e < corpoB.length - 1 && !(corpoB[e] === 13 && corpoB[e+1] === 10)) e++;
      const tam = parseInt(new TextDecoder().decode(corpoB.slice(p, e)).trim(), 16);
      if (!tam) break; out.push(corpoB.slice(e + 2, e + 2 + tam)); p = e + 2 + tam + 2;
    }
    const t = new Uint8Array(out.reduce((s, x) => s + x.length, 0)); let q = 0; for (const x of out) { t.set(x, q); q += x.length; } corpoB = t;
  }
  return { status: parseInt(cabResp.split(" ")[1] || "0"), texto: new TextDecoder().decode(corpoB) };
}
Deno.serve(async (req) => {
  const [{ valor }] = await sql`select valor from ixc.config where chave = 'carga_direta_chave'`;
  if (!valor || req.headers.get("x-carga-chave") !== valor) return new Response("nao autorizado", { status: 401 });
  const [s] = await sql`select decrypted_secret t from vault.decrypted_secrets where name = 'opa_token' limit 1`;
  const tok = String(s?.t ?? "").trim();
  const out: any[] = [];
  for (const auth of ["Bearer {t}", "{t}"]) {
    try {
      const r = await getComCorpo("https://opa.hilink.com.br/api/v1/etiqueta/", auth.replace("{t}", tok), { filter: { empresa: "5bf73d1c186f7d2b0d647a5f" }, options: { limit: 3 } });
      out.push({ auth: auth.replace("{t}", "TOKEN"), status: r.status, inicio: r.texto.slice(0, 200) });
    } catch (e) { out.push({ auth, erro: String(e) }); }
  }
  return Response.json(out);
});
