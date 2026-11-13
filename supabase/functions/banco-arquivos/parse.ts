// Leitura dos arquivos do banco (Santander): extrato OFX, extrato Excel/CSV e francesinha (aviso de movimentacao da carteira).
// Funcoes puras: recebem bytes e devolvem dados. A biblioteca de planilha (SheetJS) entra como parametro.

export type Mov = { data: string; valor: number; historico: string; fit_id?: string | null };
export type Extrato = { tipo: "extrato"; formato: string; conta_num: string | null; agencia: string | null; inicio: string | null; fim: string | null; movs: Mov[] };
export type Titulo = {
  tipo: "liquidacao" | "baixa" | "entrada"; pagador: string; seu_numero: string; nosso_numero: string;
  vencimento: string | null; data_pagamento?: string | null; valor_titulo: number; juros?: number; desconto?: number; valor_pago?: number; tarifa: number; evento: string;
};
export type Aviso = {
  conta_num: string; agencia: string; data_movimento: string; no_aviso: string;
  creditos: { data: string; historico: string; valor: number }[]; titulos: Titulo[];
  saldo_carteira: number | null; titulos_vencidos: number | null;
};
export type Francesinha = { tipo: "francesinha"; avisos: Aviso[] };
export type Resultado = Extrato | Francesinha | { tipo: "desconhecido"; motivo: string };

const br = (s: string) => Number(String(s).replace(/\./g, "").replace(",", "."));
const iso = (d: string, m: string, a: string) => `${a.length === 2 ? "20" + a : a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

export function tipoPorConteudo(bytes: Uint8Array, nome: string): "ofx" | "francesinha" | "planilha" | "texto" {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "planilha"; // xlsx (zip)
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return "planilha"; // xls antigo
  const cab = new TextDecoder("latin1").decode(bytes.slice(0, 4000)).toUpperCase();
  if (cab.includes("<OFX>") || cab.includes("OFXHEADER")) return "ofx";
  if (cab.includes("AVISO DE MOVIMENTACAO DA CARTEIRA")) return "francesinha";
  if (/\.(csv|xls|xlsx|xlsm)$/i.test(nome)) return "planilha";
  return "texto";
}

// ---------------- OFX ----------------
export function lerOFX(texto: string): Extrato {
  const tag = (bloco: string, t: string) => { const m = bloco.match(new RegExp("<" + t + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : null; };
  const dt = (s: string | null) => (s && /^\d{8}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
  const movs: Mov[] = [];
  for (const b of texto.split(/<STMTTRN>/i).slice(1)) {
    const bloco = b.split(/<\/STMTTRN>/i)[0];
    const data = dt(tag(bloco, "DTPOSTED"));
    const v = tag(bloco, "TRNAMT");
    if (!data || v == null) continue;
    const valor = Number(v.includes(",") && !v.includes(".") ? v.replace(",", ".") : v.replace(/,/g, ""));
    if (!isFinite(valor)) continue;
    const memo = tag(bloco, "MEMO") ?? "", nm = tag(bloco, "NAME") ?? "";
    const historico = (memo && nm && !memo.includes(nm) ? nm + " " + memo : memo || nm).replace(/\s+/g, " ").trim();
    movs.push({ data, valor: Math.round(valor * 100) / 100, historico, fit_id: tag(bloco, "FITID") });
  }
  return { tipo: "extrato", formato: "ofx", conta_num: tag(texto, "ACCTID"), agencia: tag(texto, "BRANCHID"),
    inicio: dt(tag(texto, "DTSTART")), fim: dt(tag(texto, "DTEND")), movs };
}

// ---------------- Planilha (Excel do internet banking / planilha conciliada da Caroline) ----------------
function dataCelula(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const m = String(v).trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) return iso(m[1], m[2], m[3]);
  const m2 = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m2 ? `${m2[1]}-${m2[2]}-${m2[3]}` : null;
}
function numCelula(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/R\$|\s/g, "");
  const neg = /^-|^\(|D$/i.test(s); s = s.replace(/[()DC-]/gi, "");
  if (!/\d/.test(s)) return null;
  const n = s.includes(",") ? br(s) : Number(s);
  return isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
}
const sem = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

export function lerPlanilha(XLSX: any, bytes: Uint8Array): Extrato {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  let melhor: Extrato | null = null;
  for (const nomeAba of wb.SheetNames) {
    const linhas: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: true, defval: "" });
    let agencia: string | null = null, conta: string | null = null;
    for (const r of linhas.slice(0, 12)) {
      r.forEach((c, i) => {
        const t = sem(c);
        if (t.startsWith("AGENCIA") && !agencia) agencia = String(r[i + 1] ?? "").replace(/\D/g, "") || (t.match(/\d{4}/)?.[0] ?? null);
        if (t.startsWith("CONTA") && !conta) conta = String(r[i + 1] ?? "").replace(/\D/g, "") || (t.match(/\d{6,}/)?.[0] ?? null);
      });
    }
    const iCab = linhas.findIndex((r) => r.some((c) => sem(c) === "DATA") && r.some((c) => /^VALOR|^CREDITO|^DEBITO/.test(sem(c))));
    if (iCab < 0) continue;
    const cab = linhas[iCab].map(sem);
    const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
    const cData = cab.indexOf("DATA"), cHist = col(/^HISTORICO|^DESCRICAO|^LANCAMENTO/), cDoc = col(/^DOCUMENTO/);
    const cValor = col(/^VALOR/), cCred = col(/^CREDITO/), cDeb = col(/^DEBITO/);
    const movs: Mov[] = [];
    for (const r of linhas.slice(iCab + 1)) {
      const data = dataCelula(r[cData]);
      if (!data) continue;
      const hist = String(r[cHist] ?? "").replace(/\s+/g, " ").trim();
      if (/^SALDO/i.test(sem(hist))) continue;
      let valor = cValor >= 0 ? numCelula(r[cValor]) : null;
      if (valor == null && (cCred >= 0 || cDeb >= 0)) {
        const c = cCred >= 0 ? numCelula(r[cCred]) : null, d = cDeb >= 0 ? numCelula(r[cDeb]) : null;
        valor = (c ?? 0) - Math.abs(d ?? 0);
      }
      if (valor == null || valor === 0) continue;
      const doc = cDoc >= 0 ? String(r[cDoc] ?? "").trim() : "";
      movs.push({ data, valor: Math.round(valor * 100) / 100, historico: hist + (doc && doc !== "0" ? " DOC " + doc : "") });
    }
    if (!melhor || movs.length > melhor.movs.length) {
      const datas = movs.map((m) => m.data).sort();
      melhor = { tipo: "extrato", formato: "planilha", conta_num: conta, agencia, inicio: datas[0] ?? null, fim: datas[datas.length - 1] ?? null, movs };
    }
  }
  return melhor ?? { tipo: "extrato", formato: "planilha", conta_num: null, agencia: null, inicio: null, fim: null, movs: [] };
}

// ---------------- Francesinha ----------------
export function lerFrancesinha(texto: string): Francesinha {
  const avisos = new Map<string, Aviso>();
  let atual: Aviso | null = null, secao = "", esperaCab = false;
  const N = "([\\d.]+,\\d{2})";
  const reLiq = new RegExp(`^\\s(.+?)\\s+(\\d{3,})\\s+(\\d{10,})\\s+(\\d{6})\\s+(\\d{6})\\s+${N}\\s+${N}\\s+${N}\\s+${N}\\s+${N}([TC])?\\s*(.*?)\\s*$`);
  const reBx = new RegExp(`^\\s(.+?)\\s+(\\d{3,})\\s+(\\d{10,})\\s+(\\d{2}/\\d{2}/\\d{4})\\s+${N}\\s+${N}([TC])?\\s*(.*?)\\s*$`);
  const d6 = (s: string) => iso(s.slice(0, 2), s.slice(2, 4), s.slice(4, 6));
  const dBR = (s: string) => { const [d, m, a] = s.split("/"); return iso(d, m, a); };
  for (const linha of texto.split(/\r?\n/)) {
    if (/NOME DO CLIENTE\s+BANCO\s+AGENCIA/.test(linha)) { esperaCab = true; continue; }
    if (esperaCab) {
      esperaCab = false;
      const m = linha.match(/\s(\d{3})\s+(\d{4})\.\d\s+(\d{6,})\s+\S+\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s*$/);
      if (m) {
        const chave = `${m[3]}|${m[4]}|${m[5]}`;
        atual = avisos.get(chave) ?? { conta_num: m[3], agencia: m[2], data_movimento: dBR(m[4]), no_aviso: m[5], creditos: [], titulos: [], saldo_carteira: null, titulos_vencidos: null };
        avisos.set(chave, atual);
      }
      continue;
    }
    if (!atual) continue;
    const sec = linha.match(/^\s*-{5,}\s*([A-Z ]+?)\s*-{5,}/);
    if (sec) { secao = sec[1].trim(); continue; }
    if (/LANCAMENTOS A SEREM EFETUADOS/.test(linha)) { secao = "LANCAMENTOS"; continue; }
    if (/^\s*TOTAL\s/.test(linha)) continue;
    if (secao === "LANCAMENTOS") {
      const m = linha.match(/^\s(\d{2})\/(\d{2})\s+(.+?)\s{2,}(\d{9,})\s+(?:(\d{9,})\s+)?([\d.]+,\d{2})/);
      if (m) {
        const ano = atual.data_movimento.slice(0, 4);
        let data = iso(m[1], m[2], ano);
        if (data < atual.data_movimento && atual.data_movimento.slice(5, 7) === "12" && m[2] === "01") data = iso(m[1], m[2], String(+ano + 1));
        const posConta = linha.indexOf(m[4]);
        const debito = posConta > 55;
        atual.creditos.push({ data, historico: m[3].trim(), valor: debito ? -br(m[6]) : br(m[6]) });
      }
      continue;
    }
    if (secao.startsWith("RESUMO")) {
      const s = linha.match(/^\s*SALDO ATUAL\s+[\d.]+\s+([\d.]+,\d{2})/); if (s) atual.saldo_carteira = br(s[1]);
      const v = linha.match(/\sTITULOS\s+(\d+)\s+([\d.]+,\d{2})/); if (v) atual.titulos_vencidos = br(v[2]);
      continue;
    }
    if (secao === "LIQUIDACOES") {
      const m = linha.match(reLiq);
      if (m) atual.titulos.push({ tipo: "liquidacao", pagador: m[1].trim(), seu_numero: m[2], nosso_numero: m[3], vencimento: d6(m[4]), data_pagamento: d6(m[5]),
        valor_titulo: br(m[6]), juros: br(m[7]), desconto: br(m[8]), valor_pago: br(m[9]), tarifa: br(m[10]), evento: m[12].trim() });
      continue;
    }
    if (secao === "BAIXAS" || secao === "ENTRADAS") {
      const m = linha.match(reBx);
      if (m) atual.titulos.push({ tipo: secao === "BAIXAS" ? "baixa" : "entrada", pagador: m[1].trim(), seu_numero: m[2], nosso_numero: m[3],
        vencimento: dBR(m[4]), valor_titulo: br(m[5]), tarifa: br(m[6]), evento: m[8].trim() });
    }
  }
  return { tipo: "francesinha", avisos: [...avisos.values()] };
}

export function ler(XLSX: any, bytes: Uint8Array, nome: string): Resultado {
  const t = tipoPorConteudo(bytes, nome);
  if (t === "planilha") return lerPlanilha(XLSX, bytes);
  const texto = new TextDecoder("latin1").decode(bytes);
  if (t === "ofx") return lerOFX(texto);
  if (t === "francesinha") return lerFrancesinha(texto);
  if (/^\s*Data[;,\t]/im.test(texto)) return lerPlanilha(XLSX, new TextEncoder().encode(texto));
  return { tipo: "desconhecido", motivo: "não reconheci como extrato (OFX/Excel) nem francesinha do Santander" };
}

// Conta pelo nome do arquivo, quando o conteudo nao traz (ex.: "EXTRATO SANTANDER HILINK IBURA NOVEMBRO 2026.xlsx")
export function contaPeloNome(nome: string): string | null {
  const n = sem(nome);
  const m = n.match(/(\d{4})-(\d{9})/); if (m) return m[2];
  if (/CARTAO|FATURA|CREDIT|VISA|MASTER|ELO\b/.test(n)) return null; // fatura de cartao nao e extrato da conta
  if (/NANDONET/.test(n)) return "130041763";
  if (/RECIFE/.test(n)) return "130021175";
  if (/JOABOATAO|JABOATAO/.test(n)) return "130011846";
  if (/ITAPI?S+UMA/.test(n)) return "130030876";
  if (/IBURA|COHAB|\bIG\b/.test(n)) return "130038865";
  if (/MADALENA/.test(n)) return "130027881";
  return null;
}
