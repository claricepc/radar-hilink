/**
 * Radar Hilink -> Google Drive (obrigações mensais).
 * Recebe arquivos enviados pelo Radar (via Supabase) e grava na pasta do mês.
 * Só grava dentro das pastas raiz abaixo. Publicado como app da Web (executar como: eu).
 */
var PASTAS = {
  dici: { raiz: '1KCkKL-92qb5-clkeUv9PbX_VM2Ggc_3d', nome: function (a, m) { return pad(m) + ' - DICI SCM ' + MESES[m - 1] + '/' + String(a).slice(2); } },
  // Extratos bancários: HILINK - Documentos / {FILIAL} / EXTRATO / {ANO} / EXTRATO_{FILIAL}_{agencia-conta}_{dd-mm-aaaa}_a_{dd-mm-aaaa}.ofx
  extrato: { raiz: '1qGM7UDxgUnqkuJ0a_kwsUxXpdsV-geOo', caminho: function (a, m, b) { return [String(b.filial || 'PENDENTE_IDENTIFICACAO').toUpperCase(), 'EXTRATO', String(a)]; } }
};
var FILIAIS_EXTRATO = ['RECIFE','MADALENA','JABOATAO','ITAPISSUMA','COHAB','CAMARAGIBE','NANDONET','PENDENTE_IDENTIFICACAO'];
function subpasta(pai, nome) {
  var it = pai.searchFolders('title = "' + String(nome).replace(/"/g, '') + '" and trashed = false');
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}
var MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
function pad(n) { return (n < 10 ? '0' : '') + n; }

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);
    var cfg = PASTAS[b.tipo];
    if (!cfg) return saida({ ok: false, erro: 'tipo invalido' });
    var p = String(b.competencia || '').split('-'), ano = +p[0], mes = +p[1];
    if (!ano || !mes || mes < 1 || mes > 12) return saida({ ok: false, erro: 'competencia invalida' });
    var nomeArq = String(b.nome || '').replace(/[\\\/:*?"<>|]/g, '_').slice(0, 150);
    if (!nomeArq) return saida({ ok: false, erro: 'nome vazio' });
    var raiz = DriveApp.getFolderById(cfg.raiz), pasta, nomePasta;
    if (cfg.caminho) {
      if (b.tipo === 'extrato' && FILIAIS_EXTRATO.indexOf(String(b.filial || '').toUpperCase()) < 0) return saida({ ok: false, erro: 'filial invalida' });
      var partes = cfg.caminho(ano, mes, b); pasta = raiz;
      for (var i = 0; i < partes.length; i++) pasta = subpasta(pasta, partes[i]);
      nomePasta = partes.join(' / ');
    } else {
      nomePasta = cfg.nome(ano, mes);
      pasta = subpasta(raiz, nomePasta);
    }
    var velhos = pasta.searchFiles('title = "' + nomeArq.replace(/"/g, '') + '" and trashed = false');
    while (velhos.hasNext()) velhos.next().setTrashed(true);
    var blob = Utilities.newBlob(Utilities.base64Decode(b.base64), b.mime || 'application/octet-stream', nomeArq);
    var f = pasta.createFile(blob);
    return saida({ ok: true, id: f.getId(), url: f.getUrl(), pasta: nomePasta, pastaUrl: pasta.getUrl() });
  } catch (err) {
    return saida({ ok: false, erro: String(err) });
  }
}
function doGet() { return saida({ ok: true, servico: 'radar-drive' }); }
function saida(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
/** Rode uma vez para autorizar o acesso ao Drive. */
function autorizar() { DriveApp.getFolderById(PASTAS.dici.raiz).getName(); DriveApp.getFolderById(PASTAS.extrato.raiz).getName(); }
