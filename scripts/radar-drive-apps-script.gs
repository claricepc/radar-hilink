/**
 * Radar Hilink -> Google Drive (obrigações mensais).
 * Recebe arquivos enviados pelo Radar (via Supabase) e grava na pasta do mês.
 * Só grava dentro das pastas raiz abaixo. Publicado como app da Web (executar como: eu).
 */
var PASTAS = {
  dici: { raiz: '1KCkKL-92qb5-clkeUv9PbX_VM2Ggc_3d', nome: function (a, m) { return pad(m) + ' - DICI SCM ' + MESES[m - 1] + '/' + String(a).slice(2); } }
};
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
    var raiz = DriveApp.getFolderById(cfg.raiz);
    var nomePasta = cfg.nome(ano, mes);
    var it = raiz.searchFolders('title = "' + nomePasta.replace(/"/g, '') + '" and trashed = false');
    var pasta = it.hasNext() ? it.next() : raiz.createFolder(nomePasta);
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
function autorizar() { DriveApp.getFolderById(PASTAS.dici.raiz).getName(); }
