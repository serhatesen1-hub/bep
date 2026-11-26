// Web sürümü: oturum ve verileri sunucudan eşzamanlı yükler (uygulama açılmadan önce).
(function () {
  window.BEP_API = 'api';
  function call(url) {
    try {
      var r = new XMLHttpRequest(); r.open('GET', url, false); r.setRequestHeader('X-BEP', '1'); r.send(null);
      return { s: r.status, j: JSON.parse(r.responseText) };
    } catch (e) { return null; }
  }
  var me = call('api/me.php');
  if (me && me.j && me.j.user) {
    var u = me.j.user, key = 'bep_sistemi_v1_u' + u.id;
    window.BEP_USER = u; window.BEP_STORE_KEY = key;
    var d = call('api/data.php');
    if (d && d.s === 200) {
      window.BEP_REV = d.j.rev || 0;
      var data = d.j.data || { students: [], profile: { firstName: u.firstName, lastName: u.lastName, branch: u.branch } };
      try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
    }
  }
})();
