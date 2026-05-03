// CloudFront viewer-request function — duas responsabilidades:
//
// 1. Redirect 301 /pt/* → /pt-br/* (BCP 47 explícito; preserva backlinks).
// 2. Reescrever URI de diretório → index.html (Next.js static export +
//    trailingSlash:true gera /alertas/index.html, mas CloudFront com
//    default_root_object só funciona na raiz; subdirs caem em 404 e o
//    custom_error_response servia a HOME por engano).
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

  // (2) Diretório → index.html
  // - Termina em '/' → append index.html
  // - Sem extensão e não termina em '/' → append /index.html
  // - Com extensão (.html, .pdf, .ico, .xml, .json, etc.) → não toca
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!/\.[a-zA-Z0-9]+$/.test(uri)) {
    request.uri = uri + '/index.html';
  }

  return request;
}
