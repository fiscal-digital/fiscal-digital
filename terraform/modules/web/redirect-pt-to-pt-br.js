function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Catch /pt and /pt/anything (mas NÃO /pt-br ou /pt-anything-else)
  // Padrão estrito: começo de string, "pt", seguido de "/" ou final.
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
