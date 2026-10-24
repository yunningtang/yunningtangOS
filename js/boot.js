// Apply the saved theme before first paint so there is no flash.
try {
  var s = JSON.parse(localStorage.getItem('ytos.v1') || '{}');
  var t = (s.settings && s.settings.theme) || 'auto';
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  var sk = (s.settings && s.settings.skin) || 'glass'; if (sk === 'win95') sk = 'xp'; document.documentElement.dataset.skin = sk;
} catch (e) {}
