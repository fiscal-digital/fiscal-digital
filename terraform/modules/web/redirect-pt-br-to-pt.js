// CloudFront viewer-request function — responsabilidade única (pós-PT-prefix removal):
//
// Redirect 301 /pt-br/* → /pt/* (preserva backlinks Reddit/X anteriores ao cutover).
//
// Histórico:
// - INF-WEB-001 (2026-05-03): step 2 (rewrite de diretório → index.html) removido.
//   Lambda ISR resolve trailing-slash internamente.
// - PT-prefix removal (2026-05-04): direção do redirect INVERTIDA.
//   Antes: /pt → /pt-br (BCP-47 explícito como locale)
//   Agora: /pt-br → /pt (locale simplificado, alinhado com next-intl 4)
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  var match = uri.match(/^\/pt-br(\/.*)?$/);
  if (match) {
    var rest = match[1] || '';
    var newUri = '/pt' + rest;
    var qs = '';
    if (request.querystring && Object.keys(request.querystring).length > 0) {
      var parts = [];
      for (var key in request.querystring) {
        var v = request.querystring[key];
        if (v.multiValue) {
          for (var i = 0; i < v.multiValue.length; i++) {
            parts.push(key + '=' + v.multiValue[i].value);
          }
        } else {
          parts.push(key + '=' + v.value);
        }
      }
      qs = '?' + parts.join('&');
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: newUri + qs },
        'cache-control': { value: 'public, max-age=3600' },
      },
    };
  }

  return request;
}
