// CloudFront viewer-request function — responsabilidade única (pós-ISR):
//
// 1. Redirect 301 /pt/* → /pt-br/* (BCP 47 explícito; preserva backlinks).
//
// Passo (2) foi REMOVIDO em INF-WEB-001 (2026-05-03).
// Antes: reescrevia URI de diretório → index.html para static export S3.
// Agora: Lambda ISR (via @opennextjs/aws) resolve trailing-slash e subdir
// internamente — reescrever aqui causaria double-rewrite e 404s na Lambda.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // (1) Redirect /pt → /pt-br
  var match = uri.match(/^\/pt(\/.*)?$/);
  if (match) {
    var rest = match[1] || '';
    var newUri = '/pt-br' + rest;
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
