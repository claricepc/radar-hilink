import postgres from "npm:postgres@3.4.4";
import * as XLSX from "npm:xlsx@0.18.5";

// Recebe a planilha de validação da premiação (xlsx em base64) e grava em ixc.premiacao_planilha.
// Modo principal: o banco chama com x-carga-chave e a função baixa a planilha do Google sozinha (ixc.config planilha_premiacao_id).
// Também aceita receber o arquivo: x-planilha-chave (segredo planilha_chave do cofre) ou o antigo x-hilink-key.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const MESES: Record<string, number> = { janeiro:1, fevereiro:2, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12,
  january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
const RX = new RegExp("(" + Object.keys(MESES).join("|") + ")\\s*(?:-|de|/)?\\s*(20\\d\\d)");
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const money = (s: unknown) => { const t = String(s ?? "").replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."); const n = parseFloat(t); return isFinite(n) ? n : null; };

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function autorizado(req: Request) {
  const pl = req.headers.get("x-planilha-chave") ?? "";
  if (pl) {
    const [s] = await sql`select decrypted_secret t from vault.decrypted_secrets where name = 'planilha_chave' limit 1`;
    const v = String(s?.t ?? "").trim();
    return !!v && pl.trim() === v;
  }
  const chave = req.headers.get("x-hilink-key") ?? "";
  const [{ valor }] = await sql`select valor from ixc.config where chave = 'ingest_key_sha256'`;
  return (await sha256(chave)) === valor;
}

function compDe(cells: string[], rawCells: any[]): string | null {
  const m = norm(cells.join(" ")).toLowerCase().match(RX);
  if (m) return `${m[2]}-${String(MESES[m[1]]).padStart(2, "0")}-01`;
  const nonEmpty = rawCells.filter((c) => c !== "" && c !== null && c !== undefined);
  if (nonEmpty.length >= 1 && nonEmpty.length <= 2 && typeof nonEmpty[0] === "number" && nonEmpty[0] > 40000 && nonEmpty[0] < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(nonEmpty[0]) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    let bin: Uint8Array;
    const cc = req.headers.get("x-carga-chave") ?? "";
    if (cc) {
      // modo busca: o próprio Supabase baixa a planilha do Google (compartilhada como "qualquer pessoa com o link pode ver")
      const [{ valor }] = await sql`select valor from ixc.config where chave = 'carga_direta_chave'`;
      if (!valor || cc !== valor) return new Response("nao autorizado", { status: 401 });
      const [{ id }] = await sql`select valor id from ixc.config where chave = 'planilha_premiacao_id'`;
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: "follow" });
      if (!r.ok || !(r.headers.get("content-type") || "").includes("spreadsheet")) throw new Error(`Google nao entregou a planilha (HTTP ${r.status}). Confira se o link esta liberado.`);
      bin = new Uint8Array(await r.arrayBuffer());
    } else {
      if (!(await autorizado(req))) return new Response("nao autorizado", { status: 401 });
      let txt = (await req.text()).trim();
      if (txt.startsWith("{")) { try { txt = JSON.parse(txt).arquivo ?? txt; } catch {} }
      bin = Uint8Array.from(atob(txt.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    }
    const wb = XLSX.read(bin, { type: "array" });
    const out: any[] = [];
    const amostra: string[] = [];
    for (const aba of wb.SheetNames) {
      const ws = wb.Sheets[aba];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      let comp: string | null = null;
      rows.forEach((r, i) => {
        const cells = r.map((c) => String(c ?? "").trim());
        const id = (cells[3] || "").match(/^\D{0,3}(\d{2,7})\b/);
        if (!id) {
          const c = compDe(cells, rawRows[i] || []);
          if (c) comp = c;
          else if (amostra.length < 12 && cells.some((x) => x) && cells.filter((x) => x).length <= 2) amostra.push(aba + ": " + cells.filter((x) => x).join(" | ") + " raw=" + JSON.stringify((rawRows[i] || []).filter((x) => x !== "").slice(0, 2)));
          return;
        }
        if (norm(cells[0]).toUpperCase() === "COLABORADOR") return;
        out.push({ aba: aba.trim(), linha: i + 1, competencia: comp, colaborador: (cells[0] || aba).trim().toUpperCase(),
          servico: norm(cells[1]).toUpperCase(), filial: cells[2], id_cliente: Number(id[1]), id_texto: cells[3], cliente: cells[4].replace(/\s+/g, " "),
          ultimo_mes: cells[5], valor_antigo: money(cells[6]), valor_atualizado: money(cells[7]), valor_receber: money(cells[8]), pago: norm(cells[9]).toUpperCase() });
      });
    }
    const semComp = out.filter((x) => !x.competencia).length;
    await sql.begin(async (tx) => {
      await tx`delete from ixc.premiacao_planilha`;
      for (let i = 0; i < out.length; i += 500) {
        await tx`insert into ixc.premiacao_planilha ${tx(out.slice(i, i + 500), "aba","linha","competencia","colaborador","servico","filial","id_cliente","id_texto","cliente","ultimo_mes","valor_antigo","valor_atualizado","valor_receber","pago")}`;
      }
      await tx`insert into ixc.log_carga (tipo, snapshot, pagina, registros, erro) values ('planilha_premiacao', current_date, '1', ${out.length}, ${semComp ? "sem competencia: " + semComp + " | " + amostra.join(" || ") : null})`;
    });
    return Response.json({ ok: true, abas: wb.SheetNames.length, linhas: out.length, sem_competencia: semComp });
  } catch (e) {
    try { await sql`insert into ixc.log_carga (tipo, snapshot, pagina, registros, erro) values ('planilha_premiacao', current_date, '1', 0, ${String(e)})`; } catch {}
    return Response.json({ ok: false, erro: String(e) }, { status: 500 });
  }
});
