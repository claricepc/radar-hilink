import postgres from "npm:postgres@3.4.4";
// Radar -> Google Drive. Recebe um arquivo do Radar (só a gestão/admin) e repassa ao script do Google
// "Radar Hilink - Drive" da conta da Clarice, que grava na pasta do mês. O endereço do script fica em ixc.config 'drive_webapp_url'.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const resp = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const u = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY")! } });
    if (!u.ok) return resp({ ok: false, erro: "login necessario" }, 401);
    const email = String((await u.json())?.email ?? "").toLowerCase();
    const [{ valor: admins }] = await sql`select valor from ixc.config where chave = 'radar_admins'`;
    if (!String(admins ?? "").toLowerCase().split(",").map((s) => s.trim()).includes(email)) return resp({ ok: false, erro: "sem permissao" }, 403);
    const b = await req.json();
    const tipo = String(b.tipo ?? ""), comp = String(b.competencia ?? ""), nome = String(b.nome ?? "");
    if (tipo !== "dici" || !/^\d{4}-\d{2}$/.test(comp) || !nome || !b.base64) return resp({ ok: false, erro: "parametros invalidos" }, 400);
    const cfg = await sql`select valor from ixc.config where chave = 'drive_webapp_url'`;
    const url = cfg[0]?.valor;
    if (!url) return resp({ ok: false, erro: "O envio para o Drive ainda não foi ligado." }, 500);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo, competencia: comp, nome, mime: b.mime, base64: b.base64 }), redirect: "follow" });
    const txt = await r.text();
    let j: any; try { j = JSON.parse(txt); } catch { j = { ok: false, erro: "resposta do Google ilegivel: " + txt.slice(0, 120) }; }
    if (!j.ok) return resp({ ok: false, erro: j.erro || "falha no Google Drive" }, 502);
    await sql`insert into ixc.obrigacoes_arquivos (tipo, competencia, filial, categoria, nome, drive_url, detalhe, enviado_por)
      values (${tipo}, ${comp}, ${b.filial ?? null}, ${String(b.categoria ?? "arquivo")}, ${nome}, ${j.url}, ${sql.json({ pasta: j.pasta, pastaUrl: j.pastaUrl, ...(b.detalhe ?? {}) })}, ${email})`;
    return resp({ ok: true, url: j.url, pasta: j.pasta, pastaUrl: j.pastaUrl });
  } catch (e) {
    return resp({ ok: false, erro: String(e).slice(0, 300) }, 500);
  }
});
