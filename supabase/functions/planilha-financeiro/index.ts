import postgres from "npm:postgres@3.4.4";

// Recebe do Apps Script da Clarice as abas de 2026 das planilhas financeiras (somente leitura nas planilhas)
// e grava em fin.planilha_linha. Autenticacao: token OAuth do Google do proprio script; o e-mail do dono
// (informado pelo Google) precisa estar em fin.planilha_remetente. Nenhum segredo compartilhado.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

const MESES: Record<string, number> = { JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12 };
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const up = (s: unknown) => norm(s).toUpperCase();

function competencia(aba: string): string | null {
  const m = up(aba).replace(/[^A-Z0-9/ ]/g, "").trim().match(/^([A-Z]+)\s*\/?\s*(2026|26)$/);
  if (!m || !MESES[m[1]]) return null;
  return `2026-${String(MESES[m[1]]).padStart(2, "0")}-01`;
}
function dinheiro(s: unknown): number | null {
  const t = String(s ?? "").trim();
  if (!/\d/.test(t) || /[a-zA-Z]{3,}/.test(t.replace(/R\$/g, ""))) return null;
  let v = t.replace(/R\$|\s/g, "");
  const neg = v.startsWith("-") || v.startsWith("(");
  v = v.replace(/[^0-9.,]/g, "");
  const pc = v.lastIndexOf(","), pp = v.lastIndexOf(".");
  let dec = -1;
  if (pc >= 0 && pp >= 0) dec = Math.max(pc, pp);
  else if (pc >= 0 || pp >= 0) { const p = Math.max(pc, pp); const sep = v[p]; if (v.split(sep).length === 2 && v.length - p - 1 <= 2) dec = p; }
  const n = dec >= 0 ? parseFloat(v.slice(0, dec).replace(/[.,]/g, "") + "." + v.slice(dec + 1)) : parseFloat(v.replace(/[.,]/g, ""));
  return isFinite(n) ? (neg ? -n : n) : null;
}
function dataVenc(comp: string, dia: number | null): string | null {
  if (!dia) return null;
  const [a, m] = comp.split("-").map(Number);
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${String(m).padStart(2, "0")}-${String(Math.min(dia, ult)).padStart(2, "0")}`;
}

type Linha = Record<string, unknown>;
function parseAba(filial: string, nome: string, comp: string, rows: string[][]): Linha[] {
  const out: Linha[] = [];
  let bloco: "saida" | "retirada" | null = null, secao: string | null = null, viuCabecalho = false;
  rows.forEach((r, i) => {
    const c = [0, 1, 2, 3, 4].map((k) => String(r[k] ?? "").trim());
    const a = up(c[0]);
    if (!a && !c[2] && !c[3]) return;
    if (!viuCabecalho) { if (up(c[1]) === "VENC") { viuCabecalho = true; bloco = "saida"; } return; }
    if (a.startsWith("TOTAL DAS SAIDAS")) { bloco = null; return; }
    if (a.startsWith("REEMBOLSOS E RETIRADAS")) { bloco = "retirada"; secao = "REEMBOLSOS E RETIRADAS"; return; }
    if (bloco === "retirada" && a === "DESCRICAO") return;
    if (bloco === "retirada" && (a.startsWith("DEBITO/CREDITO") || a.startsWith("TOTAL DEBITO") || a.startsWith("RESULTADO") || a.startsWith("SALDO A PAGAR") || a.startsWith("BATIMENTO"))) { bloco = null; return; }
    if (!bloco || !c[0]) return;
    const dia = /^\d{1,2}$/.test(c[1]) && +c[1] >= 1 && +c[1] <= 31 ? +c[1] : null;
    const prev = dinheiro(c[2]), real = dinheiro(c[3]);
    if (dia === null && prev === null && real === null && !c[2] && !c[3]) { secao = c[0]; return; }
    if (bloco === "saida" && dia === null && dinheiro(c[1]) !== null && !c[2] && !c[3]) { secao = c[0]; return; }
    out.push({
      filial, competencia: comp, linha: i + 1, aba: nome, bloco, secao, descricao: c[0].replace(/\s+/g, " "),
      venc_dia: dia, data_vencimento: dataVenc(comp, dia), previsto: prev, realizado: bloco === "retirada" ? null : real,
      previsto_txt: prev === null && c[2] ? c[2].slice(0, 60) : null,
      realizado_txt: real === null && c[3] ? c[3].slice(0, 200) : null,
      info: (bloco === "retirada" ? c[3] : c[4]).slice(0, 500) || null,
    });
  });
  return out;
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, erro: "use POST" }, 405);
  const tok = req.headers.get("x-google-token") ?? "";
  if (!tok) return json({ ok: false, erro: "nao autorizado" }, 401);
  // Quem e o dono do token: a propria API do Drive informa o e-mail (o script ja tem permissao de Drive).
  const ab = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", { headers: { Authorization: "Bearer " + tok } });
  const corpoGoogle = await ab.text();
  let info: any = {}; try { info = JSON.parse(corpoGoogle); } catch { /* */ }
  if (!ab.ok) console.error("google about", ab.status, corpoGoogle.slice(0, 300));
  const email = String(info?.user?.emailAddress ?? "").toLowerCase();
  if (!email) return json({ ok: false, erro: "nao autorizado (google " + ab.status + ")" }, 401);
  const [perm] = await sql`select 1 ok from fin.planilha_remetente where lower(email) = ${email}`;
  if (!perm) return json({ ok: false, erro: "nao autorizado" }, 403);

  let corpo: any;
  try { corpo = await req.json(); } catch { return json({ ok: false, erro: "corpo invalido" }, 400); }
  const filial = up(corpo.filial);
  const [fonte] = await sql`select filial from fin.planilha_fonte where filial = ${filial} and ativo`;
  if (!fonte) return json({ ok: false, erro: "filial invalida" }, 400);
  try {
    if (corpo.erro) throw new Error(String(corpo.erro).slice(0, 400));
    const linhas: Linha[] = []; const comps = new Set<string>();
    for (const aba of (corpo.abas ?? [])) {
      const comp = competencia(String(aba.nome ?? ""));
      if (!comp || !Array.isArray(aba.linhas)) continue;
      if (comps.has(comp)) continue;
      comps.add(comp);
      linhas.push(...parseAba(filial, String(aba.nome), comp, aba.linhas));
    }
    if (!comps.size) throw new Error("nenhuma aba de 2026 reconhecida");
    await sql.begin(async (t) => {
      await t`delete from fin.planilha_linha where filial = ${filial} and competencia = any(${[...comps]}::date[])`;
      for (let i = 0; i < linhas.length; i += 500) await t`insert into fin.planilha_linha ${t(linhas.slice(i, i + 500))}`;
      await t`insert into fin.planilha_leitura (filial, ok, abas, linhas, modificado_em, modificado_por)
              values (${filial}, true, ${comps.size}, ${linhas.length}, ${corpo.modificado_em ?? null}, ${corpo.modificado_por ?? null})`;
    });
    return json({ ok: true, filial, abas: comps.size, linhas: linhas.length });
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 400);
    await sql`insert into fin.planilha_leitura (filial, ok, erro) values (${filial}, false, ${msg})`;
    return json({ ok: false, erro: msg }, 500);
  }
});
