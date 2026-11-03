import postgres from "npm:postgres@3.4.4";
// Leitura do OPA feita pelo próprio Supabase (substitui o cenário "HILINK - Leitura OPA" do Make).
// Token: segredo opa_token no cofre (Vault) do Supabase. Quem chama manda x-carga-chave = ixc.config 'carga_direta_chave'.
// A API do OPA lê o filtro no corpo de um GET; o fetch não permite isso, então a requisição é montada à mão (HTTP/1.1 sobre TLS).
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const OPA = "opa.hilink.com.br";

async function opaGet(caminho: string, auth: string, corpo: unknown | null): Promise<any> {
  const dados = new TextEncoder().encode(corpo == null ? "" : JSON.stringify(corpo));
  const cab = `GET ${caminho} HTTP/1.1\r\nHost: ${OPA}\r\nAuthorization: ${auth}\r\nAccept: application/json\r\n` +
    (corpo == null ? "" : `Content-Type: application/json\r\nContent-Length: ${dados.length}\r\n`) + `Connection: close\r\n\r\n`;
  const con = await Deno.connectTls({ hostname: OPA, port: 443 });
  await con.write(new TextEncoder().encode(cab)); if (dados.length) await con.write(dados);
  const partes: Uint8Array[] = []; const buf = new Uint8Array(65536);
  while (true) { const n = await con.read(buf); if (n === null) break; partes.push(buf.slice(0, n)); }
  try { con.close(); } catch (_) {}
  const junta = (ps: Uint8Array[]) => { const t = new Uint8Array(ps.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of ps) { t.set(p, o); o += p.length; } return t; };
  const tudo = junta(partes);
  let fim = 0; for (let i = 0; i < tudo.length - 3; i++) if (tudo[i] === 13 && tudo[i+1] === 10 && tudo[i+2] === 13 && tudo[i+3] === 10) { fim = i; break; }
  const cabResp = new TextDecoder().decode(tudo.slice(0, fim));
  let b = tudo.slice(fim + 4);
  if (/transfer-encoding:\s*chunked/i.test(cabResp)) {
    const out: Uint8Array[] = []; let p = 0;
    while (p < b.length) {
      let e = p; while (e < b.length - 1 && !(b[e] === 13 && b[e+1] === 10)) e++;
      const tam = parseInt(new TextDecoder().decode(b.slice(p, e)).trim(), 16);
      if (!tam) break; out.push(b.slice(e + 2, e + 2 + tam)); p = e + 2 + tam + 2;
    }
    b = junta(out);
  }
  const txt = new TextDecoder().decode(b).trim();
  try { return JSON.parse(txt.slice(txt.indexOf("{"))); } catch (_) { return { status: "error", description: "resposta ilegivel: " + cabResp.split("\r\n")[0] }; }
}
const idDe = (v: any) => (v && typeof v === "object") ? String(v._id ?? "") : String(v ?? "");
async function log(etapa: string, registros: number, erro: string | null = null) {
  await sql`insert into ixc.opa_log (etapa, registros, erro) values (${etapa}, ${registros}, ${erro})`;
}
const erroDe = (j: any) => String(j?.data?.message || j?.description || "erro OPA");

async function gravarAtendimentos(lista: any[]) {
  const rows = lista.map((a: any) => ({
    id: String(a._id), protocolo: a.protocolo ?? "", status: a.status ?? "", canal: a.canal ?? "", canal_cliente: a.canal_cliente ?? "",
    id_cliente: idDe(a.id_cliente), id_atendente: idDe(a.id_atendente), setor: idDe(a.setor),
    abertura: a.date || null, fim: a.fim || null,
    tags: (a.tags || []).map((t: any) => idDe(t.id_tag)).filter(Boolean),
    motivos: (a.motivos || []).map((m: any) => ({ id: idDe(m.idMotivo), atendente: idDe(m.idAtendente), departamento: idDe(m.idDepartamento), data: m.data || null })),
    avaliacoes: a.evaluations || [], origem: a?.origem?.tipo ?? "",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const lote = rows.slice(i, i + 500);
    await sql`insert into ixc.opa_atendimentos (id, protocolo, status, canal, canal_cliente, id_cliente, id_atendente, setor, abertura, fim, tags, motivos, avaliacoes, origem, atualizado_em)
      select e->>'id', e->>'protocolo', e->>'status', e->>'canal', e->>'canal_cliente', e->>'id_cliente', nullif(e->>'id_atendente',''), nullif(e->>'setor',''),
             nullif(e->>'abertura','')::timestamptz, nullif(e->>'fim','')::timestamptz,
             array(select jsonb_array_elements_text(e->'tags')), e->'motivos', e->'avaliacoes', e->>'origem', now()
      from jsonb_array_elements(${sql.json(lote)}::jsonb) e
      on conflict (id) do update set protocolo = excluded.protocolo, status = excluded.status, canal = excluded.canal, canal_cliente = excluded.canal_cliente,
        id_cliente = excluded.id_cliente, id_atendente = excluded.id_atendente, setor = excluded.setor, abertura = excluded.abertura, fim = excluded.fim,
        tags = excluded.tags, motivos = excluded.motivos, avaliacoes = excluded.avaliacoes, origem = excluded.origem, atualizado_em = now()`;
  }
  return rows.length;
}

Deno.serve(async (req) => {
  const [{ valor }] = await sql`select valor from ixc.config where chave = 'carga_direta_chave'`;
  if (!valor || req.headers.get("x-carga-chave") !== valor) return new Response("nao autorizado", { status: 401 });
  const b = await req.json().catch(() => ({}));
  const de = String(b.de ?? ""), ate = String(b.ate ?? "");
  const paginas = Math.min(Math.max(Number(b.paginas ?? 4), 1), 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return Response.json({ ok: false, erro: "datas invalidas" }, { status: 400 });
  const [s] = await sql`select decrypted_secret t from vault.decrypted_secrets where name = 'opa_token' limit 1`;
  const tok = String(s?.t ?? "").trim();
  if (!tok) { await log("leitura", 0, "Falta o segredo opa_token no cofre do Supabase"); return Response.json({ ok: false, erro: "sem opa_token" }, { status: 500 }); }
  const auth = "Bearer " + tok;
  const res: any = { ok: true };
  try {
    // 1) etiquetas
    const empresa = (await sql`select valor from ixc.config where chave='opa_empresa'`)[0]?.valor ?? "";
    const et = await opaGet("/api/v1/etiqueta/", auth, { filter: { empresa }, options: { limit: 1000 } });
    if (et?.status === "success") {
      const rows = (et.data || []).map((e: any) => ({ id: String(e._id), nome: String(e.nome || "") }));
      if (rows.length) await sql`insert into ixc.opa_ref (tipo, id, nome, em)
        select 'etiqueta', e->>'id', e->>'nome', now() from jsonb_array_elements(${sql.json(rows)}::jsonb) e
        on conflict (tipo, id) do update set nome = excluded.nome, em = now()`;
      await log("etiquetas", rows.length); res.etiquetas = rows.length;
    } else await log("etiquetas", 0, erroDe(et));
    // 2) atendimentos do período, de 1000 em 1000
    let total = 0;
    for (let p = 1; p <= paginas; p++) {
      const j = await opaGet("/api/v1/atendimento", auth, { filter: { dataInicialAbertura: de, dataFinalAbertura: ate }, options: { limit: 1000, skip: (p - 1) * 1000 } });
      if (j?.status !== "success") { await log("atendimentos", 0, erroDe(j)); break; }
      const lista = Array.isArray(j.data) ? j.data : [];
      if (!lista.length) break;
      const n = await gravarAtendimentos(lista); total += n; await log("atendimentos", n);
      if (lista.length < 1000) break;
    }
    res.atendimentos = total;
    // 3) nomes de atendentes e motivos ainda sem nome (busca o detalhe de um atendimento de exemplo)
    const pop = await sql`
      with faltam as (
        (select distinct on (a.id_atendente) a.id from ixc.opa_atendimentos a
        where a.id_atendente is not null and not exists (select 1 from ixc.opa_ref r where r.tipo='atendente' and r.id=a.id_atendente)
        order by a.id_atendente, a.abertura desc)
        union
        (select distinct on (m->>'id') a.id from ixc.opa_atendimentos a, jsonb_array_elements(a.motivos) m
        where coalesce(m->>'id','') <> '' and not exists (select 1 from ixc.opa_ref r where r.tipo='motivo' and r.id=m->>'id')
        order by m->>'id', a.abertura desc))
      select id from faltam limit 40`;
    let nomes = 0;
    for (const p of pop) {
      const j = await opaGet("/api/v1/atendimento/" + encodeURIComponent(p.id), auth, null);
      if (j?.status !== "success") continue;
      const a = j.data || {}; const ref: any[] = [];
      if (a.id_atendente && a.id_atendente._id) ref.push({ tipo: "atendente", id: a.id_atendente._id, nome: a.id_atendente.nome || "" });
      for (const m of (a.motivos || [])) if (m.idMotivo && m.idMotivo._id) ref.push({ tipo: "motivo", id: m.idMotivo._id, nome: m.idMotivo.motivo || "" });
      if (ref.length) await sql`insert into ixc.opa_ref (tipo, id, nome, em)
        select e->>'tipo', e->>'id', e->>'nome', now() from jsonb_array_elements(${sql.json(ref)}::jsonb) e
        on conflict (tipo, id) do update set nome = excluded.nome, em = now()`;
      nomes += ref.length;
    }
    res.nomes = nomes;
    return Response.json(res);
  } catch (e) {
    await log("leitura", 0, String(e).slice(0, 500));
    return Response.json({ ok: false, erro: String(e) }, { status: 500 });
  }
});
