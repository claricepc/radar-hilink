import postgres from "npm:postgres@3.4.4";

// Carga do Radar lendo o IXC direto (sem passar pelo Make, sem gastar a cota de dados do Make).
// Credencial do IXC: secret IXC_TOKEN = "id_usuario:token" do IXC, cadastrado pela gestão no Supabase (nunca no código).
// Quem chama precisa mandar o header x-carga-chave igual a ixc.config 'carga_direta_chave'.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const IXC = "https://ixc.hilink.com.br/webservice/v1";

const CAMPOS: Record<string, string[]> = {
  contratos_todos: ["id","id_cliente","status","status_internet","id_vd_contrato","contrato","id_filial","data","data_ativacao","data_assinatura","id_vendedor","id_vendedor_ativ","id_responsavel","id_motivo_inclusao","motivo_inclusao","data_acesso_desativado","data_cancelamento","motivo_cancelamento","obs_cancelamento","data_desistencia","motivo_desistencia","isentar_contrato","fidelidade","pago_ate_data","tipo_cobranca","id_tipo_documento","id_carteira_cobranca","renovacao_automatica","endereco_padrao_cliente","endereco","numero","complemento","bairro","cep","cidade","tipo","contrato_suspenso","ultima_atualizacao"],
  clientes_cadastro: ["id","razao","fantasia","cnpj_cpf","tipo_pessoa","ativo","filial_id","fone","telefone_celular","telefone_comercial","whatsapp","email","endereco","numero","complemento","bairro","cidade","uf","cep","referencia","data_cadastro","id_vendedor"],
  receber_periodo: ["id","id_cliente","id_contrato","id_contrato_principal","id_contrato_avulso","filial_id","data_emissao","data_vencimento","valor","valor_aberto","valor_recebido","valor_cancelado","status","pagamento_data","pagamento_valor","baixa_data","credito_data","data_cancelamento","id_mot_cancelamento","tipo_recebimento","id_carteira_cobranca","nparcela","numero_parcela_recorrente","parcela_proporcional","liberado","titulo_renegociado"],
  logins: ["id","id_contrato","id_cliente","login","ativo","online","ultima_conexao_inicial","ultima_conexao_final","tempo_conectado","motivo_desconexao","count_desconexao","mac","onu_mac","ip","id_concentrador","concentrador","interface","id_caixa_ftth","ftth_porta","id_df_projeto","latitude","longitude","id_filial","autenticacao","tipo_conexao","id_grupo"],
  alteracoes_plano: ["id","id_contrato","data_hora_alteracao","tipo_alteracao","valor_atual","valor_novo","id_tipo_plano_atual","id_tipo_plano_novo","altera_tipo_cobranca","altera_plano","id_vd_contrato_novo","id_vd_contrato_atual","status","id_vendedor","id_operador"],
  planos_venda: ["id","nome","descricao","valor_contrato","Ativo","id_filial","tipo","fidelidade","tipo_pessoa"],
};
const ROTA: Record<string, string> = { contratos_todos: "cliente_contrato", clientes_cadastro: "cliente", logins: "radusuarios", alteracoes_plano: "cliente_contrato_alt_plano", planos_venda: "vd_contratos", receber_periodo: "fn_areceber" };
const ORDEM = ["contratos_todos", "receber_periodo", "clientes_cadastro", "logins", "alteracoes_plano", "planos_venda"];

function corpoIxc(tipo: string, pagina: number, de: string, ate: string) {
  const t = ROTA[tipo];
  if (tipo === "receber_periodo") return { qtype: "fn_areceber.data_vencimento", query: de, oper: ">=", page: String(pagina), rp: "3000", sortname: "fn_areceber.id", sortorder: "asc", grid_param: JSON.stringify([{ TB: "fn_areceber.data_vencimento", OP: "<=", P: ate }]) };
  return { qtype: `${t}.id`, query: "0", oper: ">", page: String(pagina), rp: "1000", sortname: `${t}.id`, sortorder: "asc" };
}

async function gravar(tipo: string, pagina: number, regs: any[], total: number, lote: string) {
  const campos = CAMPOS[tipo];
  const linhas = regs.map((r) => { const d: any = {}; for (const c of campos) if (c in r) d[c] = r[c]; return { id: String(r.id), dados: d }; });
  await sql.begin(async (tx) => {
    if (pagina === 1) await tx`delete from ixc.radar_carga where tipo = ${tipo}`;
    for (let i = 0; i < linhas.length; i += 500) {
      const l = linhas.slice(i, i + 500);
      await tx`insert into ixc.radar_carga (tipo, id, dados)
        select ${tipo}, x.id, x.dados from jsonb_to_recordset(${tx.json(l)}::jsonb) as x(id text, dados jsonb)
        on conflict (tipo, id) do update set dados = excluded.dados, carregado_em = now()`;
    }
    await tx`insert into ixc.radar_carga_log (tipo, pagina, registros, total_ixc, lote) values (${tipo}, ${String(pagina)}, ${linhas.length}, ${total}, ${lote})`;
  });
  return linhas.length;
}

Deno.serve(async (req) => {
  const cfg = await sql`select valor from ixc.config where chave = 'carga_direta_chave'`;
  const valor = cfg[0]?.valor ?? "";
  const chave = req.headers.get("x-carga-chave") ?? "";
  if (!valor || chave !== valor) return new Response("nao autorizado", { status: 401 });
  const tk = Deno.env.get("IXC_TOKEN") ?? "";
  const auth = Deno.env.get("IXC_BASIC") ?? (tk ? btoa(tk.trim()) : "");
  const b = await req.json().catch(() => ({}));
  const lote = String(b.lote ?? "");
  const de = String(b.venc_de ?? ""), ate = String(b.venc_ate ?? "");
  let fila: string[] = Array.isArray(b.fila) && b.fila.length ? b.fila : ORDEM;
  let pagina = Number(b.pagina ?? 1);
  if (!auth) {
    await sql`insert into ixc.radar_carga_log (tipo, pagina, registros, erro, lote) values (${fila[0]}, ${String(pagina)}, 0, 'Falta cadastrar o secret IXC_TOKEN no Supabase', ${lote})`;
    return Response.json({ ok: false, erro: "sem IXC_TOKEN" }, { status: 500 });
  }
  const inicio = Date.now();
  try {
    while (fila.length && Date.now() - inicio < 110000) {
      const tipo = fila[0];
      const r = await fetch(`${IXC}/${ROTA[tipo]}`, { method: "POST", headers: { Authorization: `Basic ${auth}`, ixcsoft: "listar", "Content-Type": "application/json" }, body: JSON.stringify(corpoIxc(tipo, pagina, de, ate)) });
      const txt = await r.text();
      let corpo: any; try { corpo = JSON.parse(txt); } catch { corpo = { type: "error", message: `HTTP ${r.status}: ` + txt.slice(0, 150) }; }
      if (corpo?.type === "error") {
        await sql`insert into ixc.radar_carga_log (tipo, pagina, registros, erro, lote) values (${tipo}, ${String(pagina)}, 0, ${String(corpo.message)}, ${lote})`;
        fila = fila.slice(1); pagina = 1; continue;
      }
      const regs: any[] = corpo?.registros ?? [];
      const total = Number(corpo?.total ?? 0);
      const rp = tipo === "receber_periodo" ? 3000 : 1000;
      const n = regs.length ? await gravar(tipo, pagina, regs, total, lote) : 0;
      if (!n || pagina * rp >= total) { fila = fila.slice(1); pagina = 1; } else pagina++;
    }
    if (fila.length) {
      // continua em outra chamada (limite de tempo da função)
      const prox = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ixc-carga-direta`, { method: "POST", headers: { "x-carga-chave": chave, "Content-Type": "application/json" }, body: JSON.stringify({ lote, venc_de: de, venc_ate: ate, fila, pagina }) });
      // @ts-ignore EdgeRuntime existe no Supabase
      EdgeRuntime.waitUntil(prox);
      return Response.json({ ok: true, continua: fila[0], pagina });
    }
    return Response.json({ ok: true, concluido: true });
  } catch (e) {
    await sql`insert into ixc.radar_carga_log (tipo, pagina, registros, erro, lote) values (${fila[0] ?? ''}, ${String(pagina)}, 0, ${String(e).slice(0, 400)}, ${lote})`;
    return Response.json({ ok: false, erro: String(e) }, { status: 500 });
  }
});
