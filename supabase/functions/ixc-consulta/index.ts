import postgres from "npm:postgres@3.4.4";

// Consulta pontual ao IXC, SOMENTE LEITURA (ixcsoft: listar), para auditoria de casos (ex.: titulo nao liberado).
// Rotas permitidas fixas abaixo. Nao cria, nao altera, nao apaga nada no IXC.
// Quem chama precisa mandar x-carga-chave igual a ixc.config 'carga_direta_chave' (chamada interna do banco).
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const IXC = "https://ixc.hilink.com.br/webservice/v1";
const ROTAS = new Set(["fn_areceber", "vd_saida", "cliente_contrato", "cliente", "fn_areceber_baixas"]);

Deno.serve(async (req) => {
  const [cfg] = await sql`select valor from ixc.config where chave = 'carga_direta_chave'`;
  if (!cfg?.valor || req.headers.get("x-carga-chave") !== cfg.valor) return new Response("nao autorizado", { status: 401 });
  const tk = Deno.env.get("IXC_TOKEN") ?? "";
  const auth = Deno.env.get("IXC_BASIC") ?? (tk ? btoa(tk.trim()) : "");
  const b = await req.json().catch(() => ({}));
  const rota = String(b.rota ?? "");
  if (!ROTAS.has(rota)) return Response.json({ ok: false, erro: "rota nao permitida" }, { status: 400 });
  const campo = String(b.campo ?? "id").replace(/[^a-z_]/gi, "");
  const corpo = { qtype: `${rota}.${campo}`, query: String(b.valor ?? ""), oper: String(b.oper ?? "="), page: "1", rp: String(Math.min(Number(b.rp ?? 200), 500)), sortname: `${rota}.id`, sortorder: "asc" };
  const r = await fetch(`${IXC}/${rota}`, { method: "POST", headers: { Authorization: `Basic ${auth}`, ixcsoft: "listar", "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const txt = await r.text();
  let j: any; try { j = JSON.parse(txt); } catch { return Response.json({ ok: false, status: r.status, erro: txt.slice(0, 300) }); }
  return Response.json({ ok: true, total: j.total, registros: j.registros ?? [], mensagem: j.message ?? j.mensagem ?? null });
});
