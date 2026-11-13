import postgres from "npm:postgres@3.4.4";
import * as XLSX from "npm:xlsx@0.18.5";
import { contaPeloNome, ler, type Aviso, type Extrato } from "./parse.ts";

// Arquivos do banco (extratos e francesinhas do Santander).
// Dois caminhos de entrada:
//  - Radar (tela Extratos do banco): usuario com acesso a Contas a pagar envia o arquivo; o Radar le, grava e
//    coloca na fila para o script do Google guardar no Drive com nome padrao.
//  - Script do Google da Clarice (token OAuth no corpo, e-mail conferido em fin.planilha_remetente):
//    pergunta quais arquivos do Drive ainda nao foram lidos, manda o conteudo, e busca a fila para gravar no Drive.
// So le e grava no banco do Radar. Nada vai para o IXC nem para clientes.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const resp = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const b64dec = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("-") : "");
const MAX_BYTES = 8 * 1024 * 1024;

async function quemGoogle(tok: string): Promise<string | null> {
  const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", { headers: { Authorization: "Bearer " + tok } });
  if (!r.ok) return null;
  const email = String((await r.json())?.user?.emailAddress ?? "").toLowerCase();
  if (!email) return null;
  const [ok] = await sql`select 1 from fin.planilha_remetente where lower(email) = ${email}`;
  return ok ? email : null;
}
async function quemRadar(auth: string): Promise<string | null> {
  if (!auth) return null;
  const u = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY")! } });
  if (!u.ok) return null;
  const email = String((await u.json())?.email ?? "").toLowerCase();
  const [ok] = await sql`select 1 from fin.acesso where lower(email) = ${email}`;
  return ok ? email : null;
}

async function contaDe(num: string | null, nome: string): Promise<{ conta: string; drive_nome: string } | null> {
  for (const n of [num, contaPeloNome(nome)]) {
    if (!n) continue;
    const [c] = await sql`select c.conta, c.drive_nome from fin.conta_bancaria c where c.conta = fin.conta_por_numero(${n})`;
    if (c) return c as any;
  }
  return null;
}

type Arq = { id?: string; nome: string; base64: string; modificado?: string; mime?: string };

async function processar(a: Arq, quem: string, origem: "drive" | "radar") {
  const bytes = b64dec(a.base64);
  if (bytes.length > MAX_BYTES) return { nome: a.nome, ok: false, erro: "arquivo maior que 8 MB" };
  const r = ler(XLSX, bytes, a.nome);
  if (r.tipo === "desconhecido") return { nome: a.nome, ok: false, tipo: "ignorado", erro: r.motivo };
  if (r.tipo === "extrato") {
    const e = r as Extrato;
    const c = await contaDe(e.conta_num, a.nome);
    if (!c) return { nome: a.nome, ok: false, tipo: "extrato", erro: "não achei a conta do extrato (agência/conta)" };
    if (!e.movs.length) return { nome: a.nome, ok: false, tipo: "extrato", conta: c.conta, erro: "nenhum movimento no arquivo" };
    const [{ r: g }] = await sql`select fin.extrato_gravar(${c.conta}, ${a.nome}, ${e.formato}, ${e.inicio}::date, ${e.fim}::date,
      ${sql.json(e.movs as any)}, ${origem}, ${quem}, ${a.id ?? null}) r`;
    let drive: string | null = null;
    if (origem === "radar" && g?.inicio) {
      const ext = e.formato === "ofx" ? "ofx" : (a.nome.match(/\.(xlsx|xlsm|xls|csv)$/i)?.[1] ?? "xlsx").toLowerCase();
      drive = `EXTRATO_${c.drive_nome}_${c.conta.replace("/", "-")}_${br(g.inicio)}_a_${br(g.fim)}.${ext}`;
      await sql`insert into fin.banco_upload (tipo, conta, nome_drive, ano, mime, base64, enviado_por)
                values ('extrato', ${c.conta}, ${drive}, ${+String(g.fim).slice(0, 4)}, ${a.mime ?? null}, ${a.base64}, ${quem})`;
    }
    return { nome: a.nome, ok: true, tipo: "extrato", conta: c.conta, drive_nome: drive, ...g };
  }
  // francesinha: um arquivo pode trazer mais de um aviso
  const avisos: any[] = [];
  let conta: string | null = null, drive: string | null = null;
  for (const av of (r.avisos as Aviso[])) {
    const c = await contaDe(av.conta_num, a.nome);
    if (!c) { avisos.push({ aviso: av.no_aviso, ok: false, erro: "conta de cobrança não cadastrada: " + av.conta_num }); continue; }
    conta = c.conta;
    const [{ r: g }] = await sql`select fin.francesinha_gravar(${c.conta}, ${a.nome}, ${sql.json(av as any)}, ${quem}, ${a.id ?? null}) r`;
    avisos.push(g);
    if (origem === "radar" && !drive && !g?.ignorado) {
      drive = `FRANCESINHA_${c.drive_nome}_${c.conta.replace("/", "-")}_${br(av.data_movimento)}_aviso${av.no_aviso}.txt`;
      await sql`insert into fin.banco_upload (tipo, conta, nome_drive, ano, mime, base64, enviado_por)
                values ('francesinha', ${c.conta}, ${drive}, ${+av.data_movimento.slice(0, 4)}, 'text/plain', ${a.base64}, ${quem})`;
    }
  }
  if (!avisos.length) return { nome: a.nome, ok: false, tipo: "francesinha", erro: "francesinha sem aviso reconhecido" };
  return { nome: a.nome, ok: avisos.some((x) => x?.ok), tipo: "francesinha", conta, drive_nome: drive, avisos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resp({ ok: false, erro: "use POST" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return resp({ ok: false, erro: "corpo invalido" }, 400); }
  try {
    const tok = String(b?.token ?? ""); delete b.token;
    const google = tok ? await quemGoogle(tok) : null;
    const radar = google ? null : await quemRadar(req.headers.get("Authorization") ?? "");
    const quem = google ?? radar;
    if (!quem) return resp({ ok: false, erro: "nao autorizado" }, 401);
    const acao = String(b.acao ?? "gravar");

    if (acao === "quais") {
      if (!google) return resp({ ok: false, erro: "so o script do Google" }, 403);
      const lista: { id: string; modificado?: string }[] = Array.isArray(b.arquivos) ? b.arquivos : [];
      const ids = lista.map((x) => String(x.id));
      const tem = ids.length ? await sql`select drive_id, modificado_em from fin.banco_arquivo where drive_id = any(${ids})` : [];
      const mapa = new Map(tem.map((t: any) => [t.drive_id, t.modificado_em ? new Date(t.modificado_em).getTime() : 0]));
      const faltam = lista.filter((x) => !mapa.has(String(x.id)) || (x.modificado && new Date(x.modificado).getTime() > (mapa.get(String(x.id)) ?? 0) + 1000)).map((x) => x.id);
      return resp({ ok: true, faltam });
    }

    if (acao === "gravar") {
      const arqs: Arq[] = Array.isArray(b.arquivos) ? b.arquivos : [];
      if (!arqs.length || arqs.length > 20) return resp({ ok: false, erro: "mande de 1 a 20 arquivos" }, 400);
      const out: any[] = [];
      for (const a of arqs) {
        if (!a?.nome || !a?.base64) { out.push({ nome: a?.nome, ok: false, erro: "arquivo vazio" }); continue; }
        let res: any;
        try { res = await processar(a, quem, google ? "drive" : "radar"); } catch (e) { res = { nome: a.nome, ok: false, erro: String((e as Error).message ?? e).slice(0, 300) }; }
        if (google && a.id) {
          await sql`insert into fin.banco_arquivo (drive_id, nome, tipo, conta, modificado_em, resultado)
                    values (${a.id}, ${a.nome}, ${res.tipo ?? "ignorado"}, ${res.conta ?? null}, ${a.modificado ?? null}, ${sql.json(res)})
                    on conflict (drive_id) do update set nome = excluded.nome, tipo = excluded.tipo, conta = excluded.conta,
                      modificado_em = excluded.modificado_em, resultado = excluded.resultado, lido_em = now()`;
        }
        out.push(res);
      }
      return resp({ ok: true, arquivos: out });
    }

    if (acao === "pendentes") {
      if (!google) return resp({ ok: false, erro: "so o script do Google" }, 403);
      const rows = await sql`select u.id, u.tipo, u.nome_drive, u.ano, u.mime, u.base64, c.drive_nome
        from fin.banco_upload u join fin.conta_bancaria c on c.conta = u.conta
        where u.drive_id is null and u.erro is null order by u.id limit 10`;
      return resp({ ok: true, pendentes: rows });
    }

    if (acao === "feito") {
      if (!google) return resp({ ok: false, erro: "so o script do Google" }, 403);
      for (const f of (Array.isArray(b.feitos) ? b.feitos : [])) {
        const [u] = await sql`update fin.banco_upload set drive_id = ${f.drive_id ?? null}, drive_url = ${f.url ?? null},
            no_drive_em = case when ${f.drive_id ?? null}::text is not null then now() end, erro = ${f.erro ?? null},
            base64 = case when ${f.drive_id ?? null}::text is not null then null else base64 end
          where id = ${f.id} returning tipo, conta, nome_drive`;
        if (u && f.drive_id) {
          await sql`insert into fin.banco_arquivo (drive_id, nome, tipo, conta, modificado_em, resultado)
                    values (${f.drive_id}, ${u.nome_drive}, ${u.tipo}, ${u.conta}, now(), ${sql.json({ ok: true, origem: "radar" })})
                    on conflict (drive_id) do nothing`;
        }
      }
      return resp({ ok: true });
    }
    return resp({ ok: false, erro: "acao invalida" }, 400);
  } catch (e) {
    return resp({ ok: false, erro: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
